/**
 * Loops for bg-bash: Claude Code's `/loop` and `ScheduleWakeup`, on bg-bash's wake-up queue.
 *
 * - `/loop <interval> <prompt>`: the prompt runs now and then every interval (minimum 60 s), for at
 *   most PI_LOOP_MAX_DAYS (7) days.
 * - `/loop <prompt>`: self-paced. The prompt runs now; at the end of each turn the model calls
 *   `schedule_wakeup` to set the next run, or `schedule_wakeup {stop: true}` to end it. The loop
 *   keeps one id across its runs, so `/loop stop <id>` works at any point.
 * - `/loop` lists, `/loop stop <id|all>` cancels. The model has the same through the `loop` tool.
 *
 * A tick goes out as a user message with prompt templates expanded, so `/command` and `/skill:name`
 * prompts work. It is queued like any bg-bash wake-up and only sent while pi is idle; a tick that
 * comes due while the previous one is still waiting is skipped. Everything lives in memory and ends
 * with the session. Main session only: a sub-agent's run is over before a tick could reach it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MIN_INTERVAL_MS = 60_000;
const MAX_DAYS = Number(process.env.PI_LOOP_MAX_DAYS ?? 7);
const MAX_LOOPS = 10;
const MIN_DELAY_S = 60;
const MAX_DELAY_S = 3600;
// setTimeout overflows past 2^31-1 ms; longer waits are chained
const MAX_TIMER_MS = 2_000_000_000;

export type LoopHost = {
	/** Queue a user-message tick; `render` runs when it is sent and returns the text ("" = nothing). `owner` is compared by identity only. */
	enqueueTick: (owner: unknown, render: () => string) => void;
	/** Drop anything still queued for this owner. */
	dequeue: (owner: unknown) => void;
	/** Show a message and keep it for the model's next turn, without starting one. */
	note: (text: string) => void;
	isChild: () => boolean;
};

type Loop = {
	id: string;
	kind: "interval" | "wakeup"; // a self-paced loop is a chain of wake-ups sharing one id
	prompt: string;
	intervalMs?: number;
	reason?: string;
	nextAt?: number;
	expiresAt?: number;
	timer?: ReturnType<typeof setTimeout>;
	queued: boolean;
	fired: number;
	missed: number;
};

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseInterval(text: string): number | undefined {
	const m = /^(\d+)\s*(s|m|h|d)$/i.exec(text.trim());
	if (!m) return undefined;
	return Number(m[1]) * UNITS[m[2].toLowerCase()];
}

function human(ms: number): string {
	for (const [unit, size] of [
		["d", 86_400_000],
		["h", 3_600_000],
		["m", 60_000],
	] as const) {
		if (ms % size === 0) return `${ms / size}${unit}`;
	}
	return `${Math.round(ms / 1000)}s`;
}

function clock(at: number): string {
	return new Date(at).toTimeString().slice(0, 5);
}

const PACED_RULES =
	"This is a self-paced loop. Do the task now. Before you end your turn, call schedule_wakeup with the same prompt, " +
	"a delaySeconds matched to how fast the thing you wait on changes (60-3600; about 1200-1800 when there is nothing specific to watch), " +
	"and a one-sentence reason. Call schedule_wakeup with stop: true instead when the task is done, or when it cannot move on without the user. " +
	"Do not schedule short wake-ups to poll a background command or monitor of yours: they wake you themselves.";

// `loop` and `schedule_wakeup` were never called outside /loop (0 calls in a week), so they
// stay out of the tool set until /loop starts a loop (2026-09-24). On models with native
// mid-conversation tool changes (Opus 5.5) pi adds them without invalidating the prompt
// cache. PI_LOOP_TOOLS=always keeps them on from the start.
const LOOP_TOOLS = ["loop", "schedule_wakeup"];
const DEFER_LOOP_TOOLS = process.env.PI_LOOP_TOOLS !== "always";

export function registerLoops(pi: ExtensionAPI, host: LoopHost) {
	const loops = new Map<string, Loop>();
	let counter = 0;
	const setLoopTools = (on: boolean) => {
		const active = pi.getActiveTools();
		const next = on ? [...active, ...LOOP_TOOLS.filter((name) => !active.includes(name))] : active.filter((name) => !LOOP_TOOLS.includes(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	};
	pi.on("session_start", () => {
		if (DEFER_LOOP_TOOLS && loops.size === 0) setLoopTools(false);
	});
	// The self-paced loop's id while one is on (at most one). It stays set between a run and the
	// schedule_wakeup that run makes, so the next wake-up keeps the id and gets the pacing rules.
	let pacedId: string | undefined;
	let pacedPrompt = "";
	let pacedRuns = 0; // runs of the self-paced loop so far (each wake-up is a new Loop object)
	// Bumped whenever the self-paced loop starts, stops or is replaced. `runGen` is the generation of
	// the paced tick that started the current run (until agent_end): a run of a loop stopped or
	// replaced meanwhile must not re-arm it or touch its successor.
	let pacedGen = 0;
	let runGen: number | undefined;
	const setPaced = (id: string | undefined) => {
		pacedId = id;
		pacedGen++;
		pacedRuns = 0;
	};
	const staleRun = () => runGen !== undefined && runGen !== pacedGen;
	// A paced tick owns the run its own input starts. pi runs an extension /command before any input
	// event and starts no run for it; other input goes through `input` with its raw text, then runs.
	// So: the tick's exact text in `input` marks the next agent_start; any other input clears the
	// mark. Ownership lasts through retries and continuations, until the agent settles.
	let sentGen: { gen: number; text: string } | undefined;
	let ownerPending: number | undefined;
	pi.on("input", (event: any) => {
		// `includes`: another extension's input handler may have wrapped the text. One that rewrites it
		// entirely leaves the run unowned, so only the stop-mid-run guard is lost for that run.
		ownerPending = sentGen && typeof event?.text === "string" && event.text.includes(sentGen.text) ? sentGen.gen : undefined;
		sentGen = undefined;
		return undefined;
	});
	pi.on("agent_start", () => {
		if (ownerPending !== undefined) runGen = ownerPending;
		ownerPending = undefined;
	});
	pi.on("agent_settled", () => {
		runGen = undefined;
	});
	// the self-paced loop holds a slot between its runs too
	const slots = () => loops.size + (pacedId && !loops.has(pacedId) ? 1 : 0);

	const clearTimer = (loop: Loop) => {
		if (loop.timer) clearTimeout(loop.timer);
		loop.timer = undefined;
	};

	const cancel = (loop: Loop) => {
		clearTimer(loop);
		host.dequeue(loop);
		loop.queued = false;
		loops.delete(loop.id);
	};

	const expired = (loop: Loop) => loop.expiresAt !== undefined && Date.now() >= loop.expiresAt;

	const tickText = (loop: Loop): string => {
		const paced = loop.id === pacedId;
		// a slash command must stay first to be expanded: no label in front of it, and the pacing
		// rules go out just before it as a note
		if (loop.prompt.startsWith("/")) {
			if (paced) host.note(`[${loop.id}, self-paced] ${PACED_RULES}`);
			return loop.prompt;
		}
		if (loop.kind === "interval") return `[${loop.id}, every ${human(loop.intervalMs!)}] ${loop.prompt}`;
		if (paced) return `[${loop.id}, self-paced${loop.reason ? `: ${loop.reason}` : ""}] ${loop.prompt}\n\n${PACED_RULES}`;
		return `[${loop.id} wake-up${loop.reason ? `: ${loop.reason}` : ""}] ${loop.prompt}`;
	};

	const queueTick = (loop: Loop) => {
		if (loop.queued) {
			loop.missed++;
			return;
		}
		loop.queued = true;
		host.enqueueTick(loop, () => {
			loop.queued = false;
			if (loops.get(loop.id) !== loop || expired(loop)) return "";
			loop.fired++;
			if (loop.id === pacedId) {
				pacedRuns = loop.fired;
			}
			// a wake-up is spent once sent; the model schedules the next one
			if (loop.kind === "wakeup") loops.delete(loop.id);
			const text = tickText(loop);
			if (loop.id === pacedId) sentGen = { gen: pacedGen, text };
			return text;
		});
	};

	const expire = (loop: Loop) => {
		cancel(loop);
		host.note(`Loop ${loop.id} expired after ${MAX_DAYS} days (${loop.fired} runs). Start it again if it is still needed.`);
	};

	const arm = (loop: Loop) => {
		clearTimer(loop);
		if (loop.nextAt === undefined) return;
		const due = loop.expiresAt !== undefined ? Math.min(loop.nextAt, loop.expiresAt) : loop.nextAt;
		loop.timer = setTimeout(
			() => {
				loop.timer = undefined;
				if (loops.get(loop.id) !== loop) return;
				if (expired(loop)) return expire(loop);
				if (Date.now() < loop.nextAt!) return arm(loop); // a chained long wait
				queueTick(loop);
				if (loop.kind === "interval") {
					// skip past runs missed while the machine slept; never fire twice in a row
					const now = Date.now();
					do loop.nextAt! += loop.intervalMs!;
					while (loop.nextAt! <= now);
					arm(loop);
				} else {
					loop.nextAt = undefined;
				}
			},
			Math.min(Math.max(0, due - Date.now()), MAX_TIMER_MS),
		);
		loop.timer.unref?.();
	};

	const create = (kind: Loop["kind"], prompt: string, opts: { intervalMs?: number; delayMs?: number; reason?: string; id?: string }): Loop => {
		// re-arming the self-paced loop reuses its slot; anything else needs a free one
		if (!(opts.id && opts.id === pacedId) && slots() >= MAX_LOOPS) throw new Error(`${MAX_LOOPS} loops are already scheduled. Cancel one first (loop action: "cancel").`);
		if (/^\/loop\b/.test(prompt)) throw new Error("A loop's prompt cannot be /loop itself.");
		// Only a loop that really starts adds the tools; /loop list and /loop stop leave the tool set (and cache) alone.
		setLoopTools(true);
		const now = Date.now();
		const loop: Loop = { id: opts.id ?? `loop${++counter}`, kind, prompt, queued: false, fired: 0, missed: 0, reason: opts.reason };
		if (kind === "interval") {
			loop.intervalMs = opts.intervalMs;
			loop.nextAt = now + opts.intervalMs!;
			loop.expiresAt = now + MAX_DAYS * 86_400_000;
		} else if (opts.delayMs !== undefined) {
			loop.nextAt = now + opts.delayMs;
		}
		loops.set(loop.id, loop);
		arm(loop);
		return loop;
	};

	const describe = (loop: Loop): string => {
		const next = loop.queued ? "due now (waiting for pi to be idle)" : loop.nextAt ? `next at ${clock(loop.nextAt)}` : "running now";
		const what =
			loop.kind === "interval"
				? `every ${human(loop.intervalMs!)}, expires ${new Date(loop.expiresAt!).toISOString().slice(0, 10)}`
				: `${loop.id === pacedId ? "self-paced" : "wake-up"}${loop.reason ? `: ${loop.reason}` : ""}`;
		const missed = loop.missed ? `, ${loop.missed} skipped while busy` : "";
		return `${loop.id} (${what}; ${next}; ${loop.fired} runs${missed}): ${loop.prompt.slice(0, 120)}`;
	};

	const list = (): string => {
		const lines = [...loops.values()].map(describe);
		if (pacedId && !loops.has(pacedId)) lines.push(`${pacedId} (self-paced; running now, next run not scheduled yet): ${pacedPrompt.slice(0, 120)}`);
		return lines.length ? lines.join("\n") : "No loops scheduled.";
	};

	const stopPaced = (): boolean => {
		if (!pacedId) return false;
		const pending = loops.get(pacedId);
		if (pending) cancel(pending);
		setPaced(undefined);
		return true;
	};

	const cancelById = (id: string): string => {
		if (id === "all") {
			const n = loops.size + (pacedId && !loops.has(pacedId) ? 1 : 0);
			for (const loop of [...loops.values()]) cancel(loop);
			if (pacedId) setPaced(undefined);
			return n ? `Cancelled ${n} loop(s).` : "No loops scheduled.";
		}
		if (id && id === pacedId) {
			stopPaced();
			return `Stopped the self-paced loop ${id}.`;
		}
		const loop = loops.get(id);
		if (!loop) throw new Error(`No loop ${id}. Scheduled: ${loops.size ? [...loops.keys()].join(", ") : "none"}.`);
		cancel(loop);
		return `Cancelled ${id} after ${loop.fired} runs.`;
	};

	const mainOnly = () => {
		if (host.isChild()) throw new Error("Loops and wake-ups work in the main session only: a sub-agent's run ends before they could fire.");
	};

	pi.registerCommand("loop", {
		description: "Run a prompt on an interval (/loop 5m <prompt>), self-paced (/loop <prompt>), list (/loop), or stop (/loop stop <id|all>)",
		handler: async (args: string, ctx: any) => {
			const text = (args ?? "").trim();
			const say = (message: string, level: "info" | "warning" | "error" = "info") => {
				if (ctx?.hasUI) ctx.ui.notify(message, level);
				else console.log(message);
			};
			try {
				mainOnly();
				if (!text || text === "list") return say(list());
				const stop = /^(stop|cancel)(?:\s+(\S+))?$/i.exec(text);
				if (stop) return say(cancelById(stop[2] ?? "all"));
				const first = text.split(/\s+/, 1)[0];
				const intervalMs = parseInterval(first);
				if (intervalMs !== undefined) {
					const prompt = text.slice(first.length).trim();
					if (!prompt) return say("Usage: /loop 5m <prompt>", "warning");
					if (intervalMs < MIN_INTERVAL_MS) return say("The shortest interval is 60s.", "warning");
					const loop = create("interval", prompt, { intervalMs });
					queueTick(loop);
					return say(`${loop.id}: runs now, then every ${human(intervalMs)} until ${new Date(loop.expiresAt!).toISOString().slice(0, 10)} or /loop stop ${loop.id}. Each run is a full turn.`);
				}
				// one self-paced loop at a time, as in Claude Code; validate before replacing the old one
				if (/^\/loop\b/.test(text)) throw new Error("A loop's prompt cannot be /loop itself.");
				const replaced = pacedId;
				stopPaced();
				const loop = create("wakeup", text, {});
				setPaced(loop.id);
				pacedPrompt = text;
				queueTick(loop);
				return say(`${loop.id}: self-paced, runs now; the model schedules each next run. Stop with /loop stop ${loop.id}.${replaced ? ` (Replaced ${replaced}.)` : ""}`);
			} catch (err) {
				say(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerTool({
		name: "schedule_wakeup",
		label: "Schedule wake-up",
		description:
			"Wake yourself later with a prompt, e.g. to continue a self-paced /loop or to re-check external state no command of yours can report (a CI run, a deploy, a review). " +
			"delaySeconds is clamped to 60-3600. One wake-up is pending at a time: a new call replaces it. stop: true cancels it and ends the self-paced loop. " +
			"Pick the delay from how fast the state changes (a CI run of ~8 min: one check at ~480 s, not eight at 60 s); with nothing specific to watch, 1200-1800 s. " +
			"Each wake-up is a full turn that re-reads the conversation. Do not use it to poll your own background commands or monitors: they wake you themselves.",
		parameters: Type.Object({
			delaySeconds: Type.Optional(Type.Number({ description: "Seconds from now, 60-3600." })),
			prompt: Type.Optional(Type.String({ description: "What to do when woken; for a self-paced /loop, the same task text each time." })),
			reason: Type.Optional(Type.String({ description: "One short sentence: what you are waiting for (shown to the user)." })),
			stop: Type.Optional(Type.Boolean({ description: "Cancel the pending wake-up and end the self-paced loop. Omit the other fields." })),
		}),
		async execute(_id, params: any) {
			mainOnly();
			if (staleRun()) {
				const text = "The self-paced loop this run belonged to was stopped or replaced meanwhile, so nothing was changed. End your turn.";
				return { content: [{ type: "text", text }], details: undefined as any };
			}
			const pending = [...loops.values()].filter((l) => l.kind === "wakeup");
			if (params.stop) {
				const wasPaced = Boolean(pacedId);
				for (const loop of pending) cancel(loop);
				if (pacedId) setPaced(undefined);
				const text = wasPaced ? "Self-paced loop stopped: no further wake-ups." : pending.length ? "Wake-up cancelled." : "Nothing was scheduled.";
				return { content: [{ type: "text", text }], details: undefined as any };
			}
			if (typeof params.delaySeconds !== "number" || !Number.isFinite(params.delaySeconds) || !params.prompt?.trim()) {
				throw new Error("Give delaySeconds and prompt, or stop: true.");
			}
			const delay = Math.min(MAX_DELAY_S, Math.max(MIN_DELAY_S, Math.round(params.delaySeconds)));
			// models tend to copy the "[loopN ...]" label of the tick they got; it is added again on firing
			const prompt = params.prompt.trim().replace(/^(\[loop\d+[^\]]*\]\s*)+/, "") || params.prompt.trim();
			for (const loop of pending) cancel(loop);
			// inside a self-paced loop the wake-up continues it under the same id
			const loop = create("wakeup", prompt, { delayMs: delay * 1000, reason: params.reason?.trim(), id: pacedId });
			if (loop.id === pacedId) loop.fired = pacedRuns;
			return {
				content: [{ type: "text", text: `Wake-up ${loop.id} in ${delay}s (about ${clock(loop.nextAt!)}). End your turn now; the prompt arrives then.` }],
				details: undefined as any,
			};
		},
	});

	pi.registerTool({
		name: "loop",
		label: "Loop",
		description:
			'Recurring prompts in this session. action create: run `prompt` every `interval` (e.g. "10m", "2h"; minimum 60s; ends after 7 days or on cancel), first run after one interval unless runNow. ' +
			'action list: show scheduled loops and wake-ups. action cancel: stop one by `id`, or "all". ' +
			"Each run is a full turn that re-reads the conversation, so prefer the longest interval that still works, and prefer a bash monitor when a command can report the event itself.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("cancel")]),
			interval: Type.Optional(Type.String({ description: 'For create: e.g. "5m", "1h", "1d".' })),
			prompt: Type.Optional(Type.String({ description: "For create: the prompt each run receives. A leading /command or /skill:name is expanded." })),
			runNow: Type.Optional(Type.Boolean({ description: "For create: also run once right after this turn." })),
			id: Type.Optional(Type.String({ description: 'For cancel: a loop id, or "all".' })),
		}),
		async execute(_id, params: any) {
			mainOnly();
			let text: string;
			if (params.action === "list") text = list();
			else if (params.action === "cancel") text = cancelById(params.id ?? "");
			else {
				const intervalMs = parseInterval(params.interval ?? "");
				if (intervalMs === undefined) throw new Error('interval must look like "30m", "2h" or "1d".');
				if (intervalMs < MIN_INTERVAL_MS) throw new Error("The shortest interval is 60s.");
				if (!params.prompt?.trim()) throw new Error("prompt is required for create.");
				const loop = create("interval", params.prompt.trim(), { intervalMs });
				if (params.runNow) queueTick(loop);
				text = `Created ${loop.id}: every ${human(intervalMs)}${params.runNow ? ", first run right after this turn" : `, first run at ${clock(loop.nextAt!)}`}; ends ${new Date(loop.expiresAt!).toISOString().slice(0, 10)}.`;
			}
			return { content: [{ type: "text", text }], details: undefined as any };
		},
	});

	return {
		active: () => loops.size > 0,
		cancelById,
		stopAll: () => {
			for (const loop of [...loops.values()]) cancel(loop);
			if (pacedId) setPaced(undefined);
		},
	};
}
