/**
 * bg-bash — the stock bash tool, plus a way for a running command to stop blocking.
 *
 * Main session: `background: true` starts the command and returns at once; when it
 * exits, a follow-up message (exit code, duration, tail of the log) wakes the agent.
 * Messages that arrive while pi is busy are queued. Everything else is stock bash,
 * delegated unchanged.
 *
 * Sub-agents run on a 5-minute prompt cache, and a command that blocks longer than
 * that costs the child its whole cached context. So in a sub-agent a command still
 * running after PI_BG_BASH_AUTO_SECONDS (default 240) is handed off: the tool call
 * returns with the output so far, the model's next request keeps the cache warm, and
 * the child keeps waiting with `pi-bg-wait <id>`, which blocks for up to another
 * 240 s and returns the new output. (`pi-bg-wait` is not a program: the tool answers
 * it itself.) The fork collects a child's result when its loop ends, so a follow-up
 * message could never reach it: `background: true` is ignored there, and a command
 * still running when the child's run ends is killed.
 *
 * Handed-off commands go through pi's own bash tool as well (schema, rendering,
 * truncation, environment); only the process handling underneath is ours
 * (`operations.exec`), with the output also going to a log file.
 *
 * Monitors (`monitor: true`, main session): a background command whose stdout lines are events.
 * Lines are batched (1 s) into one queued message per monitor, rendered when it is sent, so they
 * keep batching while pi is busy. More than MONITOR_FLOOD_LINES lines in a minute stop it. It
 * expires after `timeout` (default 300 s, max 3600 s) unless `persistent: true`. `pi-bg-stop <id>`
 * (answered by the tool, like `pi-bg-wait`) stops a monitor, background command or loop quietly.
 * Being part of `bash`, monitors stay under the permission policy's bash rules.
 *
 * Loops (loop.ts): `/loop`, `schedule_wakeup` and the `loop` tool, on the same queue. Their ticks
 * are user messages, sent one per idle moment and never in the same flush as other messages.
 *
 * pi-web evicts a session after 10 idle minutes; while a handed-off command runs or a loop is
 * scheduled, this extension holds the session through pi-web's session-liveness registry.
 *
 * Known limit: a job that finishes in the instant between a prompt being submitted and
 * this extension's `input` handler running (another extension's async input handler
 * is awaiting) can start a turn first; pi then rejects the prompt with "Agent is
 * already processing" and it has to be sent again. Closing that needs a busy state
 * inside pi.
 *
 * Env: PI_BG_BASH_AUTO_SECONDS (240, 0 = never), PI_BG_BASH_MAX_JOBS (8),
 * PI_BG_BASH_TAIL_BYTES (6000), PI_LOOP_MAX_DAYS (7).
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, statSync, unlinkSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { createBashToolDefinition, type ExtensionAPI, getAgentDir, getShellConfig } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerLoops } from "./loop.ts";
import { splitMixed } from "./mixed.ts";

const AUTO_MS = Number(process.env.PI_BG_BASH_AUTO_SECONDS ?? 240) * 1000;
const MAX_JOBS = Number(process.env.PI_BG_BASH_MAX_JOBS ?? 8);
const TAIL_BYTES = Number(process.env.PI_BG_BASH_TAIL_BYTES ?? 6000);
const KEEP_MS = Number(process.env.PI_BG_BASH_KEEP_SECONDS ?? 600) * 1000; // a finished job stays waitable this long after its result is out
const KILL_GRACE_MS = 2000;
// output can still arrive after the shell exits; how long to wait for it (as stock does)
const EXIT_STDIO_GRACE_MS = 100;
// how long a submitted prompt counts as "about to run" before agent_start confirms it
const INPUT_RESERVATION_MS = 60_000;
// a compaction that never reports back must not block wake-ups for ever
const COMPACTION_RESERVATION_MS = 300_000;
const MAX_TIMEOUT_SECONDS = 2_147_483; // setTimeout overflows past 2^31-1 ms and fires at once
// An optional leading `cd <dir> &&` (or `;`) is allowed: prompts that ask for it on every command (the find-gaps
// reviewer) otherwise sent `cd … && pi-bg-wait bg4` to bash, which has no such program (2026-09-29).
const CD_PREFIX = String.raw`^\s*(?:cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*)?`;
// A bare number means bgN: find-gaps reviewers sent `pi-bg-wait 13` 33 times in a day (2026-10-01), each a
// "command not found" from bash.
const WAIT_COMMAND = new RegExp(CD_PREFIX + String.raw`pi-bg-wait\s+(?:bg)?(\d+)\s*$`);
const STOP_COMMAND = new RegExp(CD_PREFIX + String.raw`pi-bg-stop\s+(bg\d+|\d+|loop\d+)\s*$`);
const jobId = (id: string) => (/^\d+$/.test(id) ? `bg${id}` : id);
// Several waits chained with && (`pi-bg-wait bg1 && pi-bg-wait bg2`, 8 times in the reviews of 2026-10-01): wait for
// each in turn. Waits and stops mixed with other commands run first, then the rest goes to bash (mixed.ts); a mix
// that cannot be split safely is refused here with a message saying how to split it.
const WAIT_CHAIN = new RegExp(CD_PREFIX + String.raw`(pi-bg-wait\s+(?:bg)?\d+(?:\s*&&\s*pi-bg-wait\s+(?:bg)?\d+)+)\s*$`);
// only in command position with an id, so `grep pi-bg-wait index.ts` or `echo 'pi-bg-wait bg1'` still run
const MIXED_WAIT = /(^|&&|\|\||;|\|)\s*pi-bg-(wait|stop)\s+(bg|loop)?\d+\b/;
// monitors: batching, flood stop, line and buffer caps, expiry
const MONITOR_BATCH_MS = 1000;
const MONITOR_FLOOD_LINES = 120; // per rolling minute
const MONITOR_LINE_CHARS = 500;
const MONITOR_BUFFER_LINES = 100;
const MONITOR_DEFAULT_S = 300;
const MONITOR_MAX_S = 3600;

type Monitor = {
	persistent: boolean;
	decoder: StringDecoder;
	partial: string;
	skipping?: boolean; // inside an overlong line, after its first MONITOR_LINE_CHARS
	skippedText?: boolean; // the dropped part of that line had non-whitespace
	lines: string[]; // waiting to be delivered
	dropped: number; // lines pushed out of the buffer since the last delivery
	delivered: number;
	window: number[]; // arrival times within the last minute
	batch?: ReturnType<typeof setTimeout>;
	queued: boolean;
	flooded?: boolean;
};

type Job = {
	id?: string; // set at hand-off
	command: string;
	pgid: number;
	log: string;
	fd?: number;
	startedAt: number;
	timeout?: number;
	timer?: ReturnType<typeof setTimeout>;
	timedOut?: boolean;
	aborted?: boolean;
	terminating?: boolean;
	afterKill?: () => void;
	handedOff?: boolean;
	monitor?: Monitor;
	stopped?: boolean; // by pi-bg-stop: ends without a message
	reportedBytes: number; // how much of the log a hand-off notice or wait has shown
	waiters: number;
	result?: string; // the final report, once finished
	onDone: Array<() => void>;
};

// The shell settings pi hands to the stock bash tool, from the user's own settings file
// only: a project's .pi/settings.json is subject to pi's trust decision, which an
// extension cannot see, so a project-level shellPath / shellCommandPrefix is not honoured.
function shellOptions(): { commandPrefix?: string; shellPath?: string } {
	try {
		const settings = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8").replace(/^\uFEFF/, ""));
		let shellPath: string | undefined = typeof settings.shellPath === "string" ? settings.shellPath.trim() : undefined;
		// the normalisation SettingsManager.getShellPath applies
		if (shellPath?.startsWith("file://")) shellPath = fileURLToPath(shellPath);
		else if (shellPath === "~" || shellPath?.startsWith("~/")) shellPath = join(homedir(), shellPath.slice(1));
		return {
			commandPrefix: typeof settings.shellCommandPrefix === "string" ? settings.shellCommandPrefix : undefined,
			shellPath: shellPath || undefined,
		};
	} catch {
		return {};
	}
}

function killGroup(pgid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pgid, signal);
	} catch {
		// already gone
	}
}

function groupAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch {
		return false;
	}
}

// The last `limit` bytes of the log from `from` on, cut at character and line boundaries.
function readLog(path: string, from = 0, limit = TAIL_BYTES): { text: string; bytes: number; cut: boolean } {
	try {
		const bytes = statSync(path).size;
		const available = Math.max(0, bytes - from);
		const len = Math.min(available, limit);
		const cut = available > len;
		const buf = Buffer.alloc(len);
		const fd = openSync(path, "r");
		try {
			readSync(fd, buf, 0, len, bytes - len);
		} finally {
			closeSync(fd);
		}
		// a cut tail can start mid-character: skip UTF-8 continuation bytes
		let start = 0;
		if (cut) while (start < len && (buf[start] & 0xc0) === 0x80) start++;
		let text = buf.toString("utf8", start);
		// and mid-line: drop the partial first line unless it is all there is
		if (cut) {
			const rest = text.slice(text.indexOf("\n") + 1);
			if (rest.trim()) text = rest;
		}
		return { text: text.trimEnd(), bytes, cut };
	} catch {
		return { text: "", bytes: 0, cut: false };
	}
}

export default function (pi: ExtensionAPI) {
	const stock = createBashToolDefinition(process.cwd());
	// handed-off commands, by id; finished ones stay for a while so a late wait finds them
	const jobs = new Map<string, Job>();
	// every command of ours that is running, handed off or not
	const running = new Set<Job>();
	// process groups we may still have to signal, by group id. A job leaves when its
	// command exits on its own; one we terminated stays until the SIGKILL went out,
	// because a worker that ignores SIGTERM can outlive the shell that led the group.
	const groups = new Map<number, Job>();
	let logDir: string | undefined;
	// `render` runs when the entry is sent (a monitor's lines keep collecting until then); "" sends nothing.
	// `tick` entries are loop ticks: user messages, sent alone.
	const queued: Array<{ owner: unknown; render: () => string; tick?: boolean }> = [];
	let counter = 0;
	let sequence = 0;
	let agentRunning = false;
	let reservedUntil = 0;
	let consumedReservation = 0;
	let compactingUntil = 0;
	let lastCtx: any;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let shuttingDown = false;

	const isChild = () => {
		try {
			const active = pi.getActiveTools();
			return active.includes("notify_parent") || active.includes("ask_parent");
		} catch {
			return false;
		}
	};

	const send = (content: string) => {
		if (shuttingDown) return;
		try {
			pi.sendMessage({ customType: "bg-bash", content, display: true }, { deliverAs: "followUp", triggerTurn: true });
		} catch {
			// session is gone; the log file still has the output
		}
	};
	// Shown and kept for the model's next turn, without starting one; pi defers it to the end of a running turn.
	const note = (content: string) => {
		if (shuttingDown) return;
		try {
			pi.sendMessage({ customType: "bg-bash", content, display: true }, { triggerTurn: false });
		} catch {
			// session is gone
		}
	};
	const sendTick = (text: string) => {
		if (shuttingDown) return;
		try {
			pi.sendUserMessage(text, { deliverAs: "followUp", expandPromptTemplates: true });
		} catch {
			// session is gone
		}
	};

	// A turn triggered while a request is in flight can race it (seen upstream as
	// "No tool call found for function call output"), so results that arrive
	// mid-run wait for agent_end.
	// pi's own view as well: it covers states no event announces. A stale ctx throws.
	const piBusy = () => {
		try {
			return lastCtx?.isIdle?.() === false;
		} catch {
			return false;
		}
	};
	const busy = () => agentRunning || Date.now() < reservedUntil || Date.now() < compactingUntil || piBusy();

	const flush = () => {
		if (retry) clearTimeout(retry);
		retry = undefined;
		if (shuttingDown || queued.length === 0) return;
		if (busy()) {
			// not every busy state ends in an event we see, so look again shortly
			(retry = setTimeout(flush, 1000)).unref?.();
			return;
		}
		// Messages first, all in one; a loop tick waits for the next idle moment, since both
		// start a run. Entries that render to nothing (a stopped monitor) just drop out.
		const messages = queued.filter((entry) => !entry.tick);
		if (messages.length) {
			for (const entry of messages) queued.splice(queued.indexOf(entry), 1);
			const content = messages
				.map((entry) => entry.render())
				.filter(Boolean)
				.join("\n\n");
			if (content) return send(content);
		}
		while (queued.length) {
			const text = queued.shift()!.render();
			if (text) {
				sendTick(text);
				// a tick that runs a command without starting a turn brings no agent_end: look again
				if (queued.length) (retry = setTimeout(flush, 1000)).unref?.();
				return;
			}
		}
	};

	const enqueue = (owner: unknown, render: () => string, tick = false) => {
		if (shuttingDown) return;
		queued.push({ owner, render, tick });
		flush();
	};
	const dequeue = (owner: unknown) => {
		for (let i = queued.length - 1; i >= 0; i--) if (queued[i].owner === owner) queued.splice(i, 1);
	};
	const deliver = (job: Job, content: string) => enqueue(job, () => content);
	// a wait that hands the final result to the model makes the queued message redundant
	const collected = (job: Job): string => {
		dequeue(job);
		return job.result ?? "";
	};

	// A monitor's buffered lines as one message, taken at send time.
	const takeLines = (job: Job): string => {
		const m = job.monitor!;
		m.queued = false;
		const lines = m.lines.splice(0);
		const dropped = m.dropped;
		m.dropped = 0;
		if (!lines.length && !dropped) return "";
		m.delivered += lines.length;
		const gap = dropped ? ` (${dropped} earlier lines skipped; full output: ${job.log})` : "";
		return `Monitor ${job.id} \`${job.command.slice(0, 80)}\`, ${lines.length} new line${lines.length === 1 ? "" : "s"}${gap}:\n${lines.join("\n")}`;
	};
	const queueLines = (job: Job) => {
		const m = job.monitor!;
		m.batch = undefined;
		if (m.queued || !m.lines.length || job.stopped || job.result) return;
		m.queued = true;
		enqueue(job, () => takeLines(job));
	};
	// Split stdout into lines; the first new line arms the batch timer.
	const feed = (job: Job, chunk: Buffer | undefined) => {
		const m = job.monitor!;
		if (m.flooded || job.stopped) return;
		let text = chunk ? m.decoder.write(chunk) : m.decoder.end();
		// Inside an overlong line: `partial` holds its first MONITOR_LINE_CHARS, the rest is dropped
		// until the line ends (newline or EOF); then that prefix counts as the one line.
		if (m.skipping) {
			const nl = text.indexOf("\n");
			if (/\S/.test(nl < 0 ? text : text.slice(0, nl))) m.skippedText = true;
			if (nl < 0 && chunk) return;
			m.skipping = false;
			// an all-whitespace line stays blank, and blank lines are no events
			const marker = m.skippedText || /\S/.test(m.partial) ? "\u2026" : "";
			m.skippedText = false;
			text = `${m.partial}${marker}${nl < 0 ? "" : text.slice(nl)}`;
		} else text = m.partial + text;
		const parts = text.split("\n");
		m.partial = chunk ? parts.pop()! : "";
		// a line that never ends must not grow for ever
		if (m.partial.length > MONITOR_LINE_CHARS) {
			if (/\S/.test(m.partial.slice(MONITOR_LINE_CHARS))) m.skippedText = true;
			m.partial = m.partial.slice(0, MONITOR_LINE_CHARS);
			m.skipping = true;
		}
		const now = Date.now();
		for (const raw of parts) {
			const line = raw.replace(/\r$/, "");
			if (!line.trim()) continue;
			m.window.push(now);
			while (m.window.length && m.window[0] <= now - 60_000) m.window.shift();
			if (m.window.length > MONITOR_FLOOD_LINES) {
				m.flooded = true;
				terminate(job);
				return;
			}
			m.lines.push(line.length > MONITOR_LINE_CHARS ? `${line.slice(0, MONITOR_LINE_CHARS)}\u2026` : line);
			if (m.lines.length > MONITOR_BUFFER_LINES) {
				m.lines.shift();
				m.dropped++;
			}
		}
		// also at EOF: a process may close stdout and keep running (a finish merges and clears this)
		if (m.lines.length && !m.queued && !m.batch) (m.batch = setTimeout(() => queueLines(job), MONITOR_BATCH_MS)).unref?.();
	};

	// SIGTERM now, SIGKILL to whatever is left of the group after the grace period.
	// The ownership check stops a late timer from hitting a newer job that got the
	// same id. An unrelated group could only get it if the kernel wrapped through the
	// whole pid space within the grace period.
	const terminate = (job: Job) => {
		if (job.terminating || groups.get(job.pgid) !== job) return;
		job.terminating = true;
		killGroup(job.pgid, "SIGTERM");
		setTimeout(() => {
			if (groups.get(job.pgid) !== job) return;
			groups.delete(job.pgid);
			killGroup(job.pgid, "SIGKILL");
			job.afterKill?.();
		}, KILL_GRACE_MS).unref?.();
	};

	// Stops every running command and forgets it: nothing is announced afterwards.
	const stopAll = () => {
		for (const job of running) {
			if (job.timer) clearTimeout(job.timer);
			if (job.id) jobs.delete(job.id);
			terminate(job);
			// a pending pi-bg-wait must not sit out its window and then call the job alive
			job.result ??= `Background command ${job.id} was stopped because the session or the sub-agent's run ended.`;
			for (const wake of job.onDone.splice(0)) wake();
		}
		running.clear();
	};

	// Busy from the moment a prompt is submitted: a wake-up sent while pi prepares
	// that prompt (input handlers, auth, compaction, before_agent_start) would start a
	// run the user's own prompt then collides with. `input` is the earliest signal and
	// does not say whether a run follows, hence a reservation that expires.
	pi.on("input", () => {
		reservedUntil = Date.now() + INPUT_RESERVATION_MS;
		return undefined;
	});
	pi.on("before_agent_start", (_event, ctx) => {
		lastCtx = ctx;
		agentRunning = true;
	});
	pi.on("agent_start", (_event, ctx) => {
		lastCtx = ctx;
		agentRunning = true;
		consumedReservation = reservedUntil;
	});
	// A turn started while pi compacts (manual /compact, or compact-at between runs)
	// would have its messages replaced under it.
	pi.on("session_before_compact", () => {
		compactingUntil = Date.now() + COMPACTION_RESERVATION_MS;
		return undefined;
	});
	for (const done of ["session_compact", "session_compact_failed"] as const) {
		pi.on(done as any, () => {
			compactingUntil = 0;
			setImmediate(flush).unref?.();
		});
	}
	pi.on("agent_end", (_event, ctx) => {
		lastCtx = ctx;
		agentRunning = false;
		// a sub-agent's result is collected now; nothing it left running can report back
		if (isChild()) stopAll();
		// a prompt submitted during this run holds a newer reservation: leave it alone
		if (reservedUntil === consumedReservation) reservedUntil = 0;
		// let pi finish unwinding the turn; flush re-checks for a run begun meanwhile
		setImmediate(flush).unref?.();
	});

	// pi may exit before a grace timer fires; nothing that ignored SIGTERM outlives it.
	// One exit listener per process, however often the extension is reloaded.
	const registry: Set<Map<number, Job>> = ((globalThis as any)[Symbol.for("bg-bash.groups")] ??= (() => {
		const all = new Set<Map<number, Job>>();
		process.once("exit", () => {
			for (const owned of all) for (const pgid of owned.keys()) killGroup(pgid, "SIGKILL");
		});
		return all;
	})());
	registry.add(groups);

	const loops = registerLoops(pi, { enqueueTick: (owner, render) => enqueue(owner, render, true), dequeue, note, isChild });

	// pi-web evicts a session after its idle timeout; hold it while something of ours is pending.
	let releaseLiveness: (() => void) | undefined;
	const holdSession = (ctx: any) => {
		releaseLiveness?.();
		releaseLiveness = undefined;
		const liveness = (globalThis as any)[Symbol.for("@agegr/pi-web/session-liveness/v1")];
		if (liveness?.version !== 1) return;
		try {
			const sessionId = ctx.sessionManager.getSessionId();
			if (!sessionId) return;
			releaseLiveness = liveness.register({
				name: "bg-bash",
				sessionId,
				sessionFile: ctx.sessionManager.getSessionFile() || undefined,
				isActive: () => [...running].some((job) => job.handedOff) || loops.active(),
			});
		} catch {
			// pi-web rejected the registration: eviction stays as it was
		}
	};

	pi.on("session_start", (_event, ctx) => {
		lastCtx = ctx;
		shuttingDown = false;
		registry.add(groups);
		holdSession(ctx);
	});
	pi.on("session_shutdown", () => {
		shuttingDown = true;
		queued.length = 0;
		if (retry) clearTimeout(retry);
		releaseLiveness?.();
		releaseLiveness = undefined;
		loops.stopAll();
		stopAll();
		// once the escalations are through this instance owns nothing any more
		setTimeout(() => {
			if (groups.size === 0) registry.delete(groups);
		}, KILL_GRACE_MS + 500).unref?.();
	});

	const report = (job: Job, how: string): string => {
		const seconds = Math.round((Date.now() - job.startedAt) / 1000);
		const { text, bytes, cut } = readLog(job.log);
		const note = cut ? ` Last ${TAIL_BYTES} of ${bytes} bytes shown; full output: ${job.log}` : "";
		return `Background command ${job.id} finished: ${how}, ran ${seconds}s.${note}\n$ ${job.command}\n${text || "(no output)"}`;
	};

	// A monitor's last message: lines not yet delivered, then why it ended.
	const monitorReport = (job: Job, how: string, failed: boolean): { text: string; quiet: boolean } => {
		const m = job.monitor!;
		// a forced finish can come before stdout's end event: take the unterminated last line now
		feed(job, undefined);
		if (m.batch) clearTimeout(m.batch);
		m.batch = undefined;
		dequeue(job);
		// after a flood the lines are noise: a sample is enough
		if (m.flooded && m.lines.length > 10) m.dropped += m.lines.splice(0, m.lines.length - 10).length;
		const rest = takeLines(job);
		const seconds = Math.round((Date.now() - job.startedAt) / 1000);
		let end: string;
		if (m.flooded) {
			end = `Monitor ${job.id} was stopped: more than ${MONITOR_FLOOD_LINES} lines in a minute. Start it again with a tighter filter (e.g. grep --line-buffered for just the lines you would act on).`;
		} else if (job.timedOut) {
			end = `Monitor ${job.id} expired after ${job.timeout}s with ${m.delivered} lines delivered. Start it again if you still need the watch${m.persistent ? "" : " (persistent: true runs until stopped)"}.`;
		} else {
			end = `Monitor ${job.id} ended: ${how}, ran ${seconds}s, ${m.delivered} lines delivered.\n$ ${job.command}`;
			if (failed) {
				const { text } = readLog(job.log, 0, 1500);
				if (text) end += `\nLast output (stdout and stderr):\n${text}`;
			}
		}
		const quiet = !rest && !failed && !m.flooded && !job.timedOut;
		return { text: rest ? `${rest}\n\n${end}` : end, quiet };
	};

	// `pi-bg-stop <id>`: end a background command, monitor or loop without a message.
	const stop = (id: string): string => {
		if (id.startsWith("loop")) return loops.cancelById(id);
		const job = jobs.get(id);
		if (!job) throw new Error(`No background command ${id} in this session (finished long ago, or never started).`);
		if (job.result) return `${id} had already finished.`;
		job.stopped = true;
		if (job.monitor?.batch) clearTimeout(job.monitor.batch);
		dequeue(job);
		terminate(job);
		const lines = job.monitor ? `, after ${job.monitor.delivered} delivered lines` : "";
		return `Stopped ${id}${lines}. Nothing more will arrive from it.`;
	};

	const handOffNotice = (job: Job, immediate: boolean): string => {
		const lead = immediate
			? `Started in the background as ${job.id} (process group ${job.pgid}).`
			: `Still running after ${Math.round(AUTO_MS / 1000)}s, so it now runs in the background as ${job.id} (process group ${job.pgid}); its output so far is above.`;
		const next = isChild()
			? `To keep waiting for it, run the bash command \`pi-bg-wait ${job.id}\`: it returns when the command exits, or after another ${Math.round(AUTO_MS / 1000)}s with the new output. The command is killed if you end your turn while it runs.`
			: `Its result will arrive as a message when it exits, so do not wait for it with sleep or poll it: carry on with other work, or end your turn if there is none.`;
		return `${lead} ${next}\nProgress if needed: tail -n 20 ${job.log}\nStop it: kill -- -${job.pgid}`;
	};

	/**
	 * The process handling under the stock tool: stock's local exec (pi 0.85
	 * core/tools/bash.ts) plus the log file and the hand-off. `call.job` tells the
	 * caller that the promise resolved because of a hand-off, not an exit.
	 */
	const exec = (
		call: { background: boolean; autoMs: number; job?: Job; monitor?: boolean; persistent?: boolean; label?: string },
		command: string,
		cwd: string,
		{ onData, signal, timeout, env }: { onData: (data: Buffer) => void; signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv },
	): Promise<{ exitCode: number | null }> => {
		if (timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0 && timeout <= MAX_TIMEOUT_SECONDS)) {
			throw new Error(`Invalid timeout ${timeout}: give a number of seconds between 1 and ${MAX_TIMEOUT_SECONDS}, or none.`);
		}
		if (signal?.aborted) throw new Error("aborted");
		if (!existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
		if (call.background && [...running].filter((job) => job.handedOff).length >= MAX_JOBS) {
			throw new Error(`${MAX_JOBS} background commands are already running. Wait for one to finish or kill one.`);
		}

		// private per-process directory (0700), exclusive create: output can hold secrets
		logDir ??= mkdtempSync(join(tmpdir(), "pi-bg-bash-"));
		const log = join(logDir, `cmd-${++sequence}.log`);
		const { shell, args } = getShellConfig(shellOptions().shellPath); // throws on a bad shellPath: before the fd exists
		const fd = openSync(log, "wx", 0o600);
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(shell, [...args, command], { cwd, env: env ?? process.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
		} catch (err) {
			closeSync(fd);
			throw err;
		}

		return new Promise((resolve, reject) => {
			let settled = false; // the promise
			let finished = false; // the job
			// a failed spawn reports through an async 'error' event, which must have a listener
			child.on("error", (err) => {
				if (settled) return;
				settled = true;
				closeSync(fd);
				reject(err);
			});
			if (!child.pid) return;
			const pgid = child.pid;
			// shown in messages: the model's own command, without the settings' shellCommandPrefix
			const job: Job = { command: call.label ?? command, pgid, log, fd, startedAt: Date.now(), timeout, reportedBytes: 0, waiters: 0, onDone: [] };
			if (call.monitor) {
				job.monitor = {
					persistent: Boolean(call.persistent),
					decoder: new StringDecoder("utf8"),
					partial: "",
					lines: [],
					dropped: 0,
					delivered: 0,
					window: [],
					queued: false,
				};
				child.stdout?.on("data", (chunk: Buffer) => feed(job, chunk));
				child.stdout?.on("end", () => feed(job, undefined));
			}
			running.add(job);
			groups.set(pgid, job);

			let written = 0;
			const onChunk = (chunk: Buffer) => {
				try {
					written += writeSync(fd, chunk);
				} catch {
					// log unwritable (disk full): the command itself carries on
				}
				if (!job.handedOff) onData(chunk);
			};
			child.stdout?.on("data", onChunk);
			child.stderr?.on("data", onChunk);

			let autoTimer: ReturnType<typeof setTimeout> | undefined;
			const onAbort = () => {
				if (job.handedOff) return;
				job.aborted = true;
				if (autoTimer) clearTimeout(autoTimer);
				killGroup(pgid, "SIGKILL"); // as stock: the whole tree, at once
			};
			signal?.addEventListener("abort", onAbort, { once: true });

			const handOff = () => {
				// a command we are already killing answers as stock does, it is not handed off
				if (settled || finished || job.handedOff || job.aborted || job.timedOut || job.terminating) return;
				job.handedOff = true;
				job.id = `bg${++counter}`;
				job.reportedBytes = written;
				jobs.set(job.id, job);
				signal?.removeEventListener("abort", onAbort);
				call.job = job;
				settled = true;
				resolve({ exitCode: 0 });
			};

			if (timeout !== undefined) {
				job.timer = setTimeout(() => {
					job.timedOut = true;
					if (autoTimer) clearTimeout(autoTimer);
					if (job.handedOff) terminate(job);
					else killGroup(pgid, "SIGKILL");
				}, timeout * 1000);
				job.timer.unref?.();
			}
			if (!call.background && call.autoMs > 0) (autoTimer = setTimeout(handOff, call.autoMs)).unref?.();

			const finish = (code: number | null, exitSignal: NodeJS.Signals | null) => {
				if (!job.terminating && groups.get(pgid) === job) groups.delete(pgid);
				if (finished) return;
				// terminated by us and the SIGKILL is still to come: a worker that ignores
				// SIGTERM may be running, so the job is not over and must not be announced yet
				if (job.terminating && groups.get(pgid) === job) {
					if (groupAlive(pgid)) {
						job.afterKill = () => finish(code, exitSignal);
						return;
					}
					groups.delete(pgid);
				}
				finished = true;
				if (job.timer) clearTimeout(job.timer);
				if (autoTimer) clearTimeout(autoTimer);
				signal?.removeEventListener("abort", onAbort);
				child.stdout?.destroy();
				child.stderr?.destroy();
				try {
					closeSync(fd);
				} catch {
					// closed already
				}
				job.fd = undefined;
				const known = running.delete(job);

				if (!job.handedOff) {
					// an ordinary foreground command: answer exactly as stock does
					try {
						unlinkSync(log);
					} catch {
						// nothing to remove
					}
					if (settled) return;
					settled = true;
					if (job.aborted || signal?.aborted) reject(new Error("aborted"));
					else if (job.timedOut) reject(new Error(`timeout:${timeout}`));
					else resolve({ exitCode: code });
					return;
				}
				if (!known) return; // stopped by shutdown or by the end of a sub-agent's run

				const how = job.timedOut ? `killed after the ${timeout}s timeout` : exitSignal ? `killed by ${exitSignal}` : `exit code ${code}`;
				// a monitor that ended cleanly with every line delivered needs no turn of its own
				let quiet = false;
				if (job.monitor) {
					const ended = monitorReport(job, how, code !== 0 || Boolean(exitSignal));
					job.result = ended.text;
					quiet = ended.quiet;
				} else job.result = report(job, how);
				const waited = job.waiters > 0;
				for (const wake of job.onDone.splice(0)) wake();
				// a waiter hands the result to the model itself; a sub-agent has no other way
				if (!waited && !isChild() && !job.stopped) {
					if (quiet) note(job.result);
					else deliver(job, job.result);
				}
				// Keep the record for a late pi-bg-wait, not for ever; and never while its result message is still
				// queued behind a long run (2026-10-02, find-gaps: a job that ended at 07:12 was forgotten at 07:22,
				// `pi-bg-wait bg2` failed at 07:26, and its message only arrived at 07:27).
				const expire = () => {
					if (!job.id || jobs.get(job.id) !== job) return;
					if (queued.some((entry) => entry.owner === job)) setTimeout(expire, KEEP_MS).unref?.();
					else jobs.delete(job.id);
				};
				setTimeout(expire, KEEP_MS).unref?.();
			};

			// As stock's waitForChildProcess: done when the shell has exited and both pipes
			// have ended, or when output stops arriving shortly after the exit (a detached
			// descendant can hold the pipes open for ever).
			let exited: { code: number | null; exitSignal: NodeJS.Signals | null } | undefined;
			let ended = 0;
			let drain: ReturnType<typeof setTimeout> | undefined;
			const maybeFinish = (force = false) => {
				if (!exited) return;
				if (force || ended === 2) {
					if (drain) clearTimeout(drain);
					finish(exited.code, exited.exitSignal);
				}
			};
			const armDrain = () => {
				if (drain) clearTimeout(drain);
				drain = setTimeout(() => maybeFinish(true), EXIT_STDIO_GRACE_MS);
			};
			for (const stream of [child.stdout, child.stderr]) {
				stream?.on("end", () => {
					ended++;
					maybeFinish();
				});
				stream?.on("data", () => exited && armDrain());
			}
			child.on("exit", (code, exitSignal) => {
				exited = { code, exitSignal };
				// The shell of a handed-off command was killed from outside (the advertised
				// `kill`, or the user): what it was waiting on is interrupted work, not a
				// daemon left on purpose. Now, not in finish: a worker that keeps writing
				// would keep the drain timer alive.
				if (exitSignal && job.handedOff && !job.terminating && groups.get(pgid) === job) {
					groups.delete(pgid);
					killGroup(pgid, "SIGKILL");
				}
				armDrain();
				// A command we or someone else killed is over: do not wait on a descendant that
				// keeps writing. A normal exit keeps stock's behaviour (idle timer only), so a
				// finite descendant still gets all its output in.
				if (exitSignal || job.terminating || job.timedOut || job.aborted) setTimeout(() => maybeFinish(true), 1000).unref?.();
				maybeFinish();
			});

			if (call.background) handOff();
		});
	};

	// `pi-bg-wait <id>`: block on a handed-off command for one more window.
	const waitFor = async (id: string, signal?: AbortSignal, timeout?: number): Promise<string> => {
		if (timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0 && timeout <= MAX_TIMEOUT_SECONDS)) {
			throw new Error(`Invalid timeout ${timeout}: give a number of seconds between 1 and ${MAX_TIMEOUT_SECONDS}, or none.`);
		}
		const windowMs = Math.min(AUTO_MS > 0 ? AUTO_MS : 240_000, timeout !== undefined ? timeout * 1000 : Number.POSITIVE_INFINITY);
		const job = jobs.get(id);
		if (!job) throw new Error(`No background command ${id} in this session (finished long ago, or never started).`);
		if (job.result) return collected(job);
		job.waiters++;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		try {
			await new Promise<void>((resolve, reject) => {
				job.onDone.push(resolve);
				timer = setTimeout(resolve, windowMs);
				onAbort = () => reject(new Error("aborted"));
				if (signal?.aborted) onAbort();
				else signal?.addEventListener("abort", onAbort, { once: true });
			});
		} finally {
			job.waiters--;
			if (timer) clearTimeout(timer);
			if (onAbort) signal?.removeEventListener("abort", onAbort);
		}
		if (job.result) return collected(job);
		const { text, bytes, cut } = readLog(job.log, job.reportedBytes);
		job.reportedBytes = bytes;
		const seconds = Math.round((Date.now() - job.startedAt) / 1000);
		return (
			`${id} is still running after ${seconds}s.${cut ? ` Last ${TAIL_BYTES} bytes of the new output shown; full output: ${job.log}` : ""}\n` +
			`${text || "(no new output)"}\n\nRun \`pi-bg-wait ${id}\` again to keep waiting, or stop it: kill -- -${job.pgid}`
		);
	};

	// The tool-groups extension, when loaded, draws bash rows too (grouped summaries in the TUI). The
	// two find each other on this session's event bus; whichever loads second completes the handshake
	// (see tool-groups' READY/BASH). pi spreads this definition per row, after every extension has
	// loaded, so the getter sees the result.
	const description =
		`${stock.description} Set background: true for a command you would otherwise sit waiting on ` +
		`(a CI watch, a long build or test run, a deploy): the call returns at once and the result arrives as a message when the command exits. ` +
		`In a sub-agent, background is ignored; instead a command still running after ${Math.round(AUTO_MS / 1000)}s returns with its output so far and you keep waiting with the command \`pi-bg-wait <id>\`. ` +
		`Main session: monitor: true starts a watch instead, where every stdout line of the command reaches you as a message (batched about 1 s) while you carry on; ` +
		`it expires after timeout (default ${MONITOR_DEFAULT_S}s, max ${MONITOR_MAX_S}s) unless persistent: true, which runs until \`pi-bg-stop <id>\` or the session ends. ` +
		`\`pi-bg-stop <id>\` also stops a background command or a loop without a message.`;
	let toolGroups: any;
	const peer = {
		description,
		connect: (renderer: any) => {
			toolGroups = renderer;
		},
	};
	pi.events.on("tool-groups:ready", (renderer: any) => {
		toolGroups = renderer;
		renderer.adoptBash(peer);
	});
	pi.events.emit("tool-groups:bash", peer);

	pi.registerTool({
		...stock,
		get renderShell() {
			return toolGroups ? "self" : (stock as any).renderShell;
		},
		renderCall: (value: any, theme: any, context: any) =>
			toolGroups?.render("call", "bash", stock, value, theme, context) ?? (stock as any).renderCall(value, theme, context),
		renderResult: (value: any, options: any, theme: any, context: any) =>
			toolGroups?.render("result", "bash", stock, value, theme, context, options) ??
			(stock as any).renderResult(value, options, theme, context),
		description,
		promptGuidelines: [
			...(stock.promptGuidelines ?? []),
			"To wait for something slow (CI, a long build, a deploy), run one blocking command with bash background: true, e.g. `gh run watch <id> --exit-status`, instead of a sleep-and-check loop. You are woken with its output when it exits.",
			`Use bash monitor: true to react to a stream of events (new review comments, CI state changes, errors in a log): the command prints one line per event and each line wakes you. Print only lines you would act on, failures included (grep --line-buffered, jq, a small poll-and-diff loop), never raw logs; more than ${MONITOR_FLOOD_LINES} lines a minute stops the monitor. Make output line-buffered (grep --line-buffered, stdbuf -oL, python -u). For a single "tell me when X is ready", use background: true with a command that exits then, e.g. \`until grep -q Ready app.log; do sleep 2; done\`.`,
		],
		parameters: Type.Object({
			...(stock.parameters as any).properties,
			background: Type.Optional(
				Type.Boolean({ description: "Main session only (ignored in sub-agents): start the command and return at once; its output arrives as a message when it exits." }),
			),
			monitor: Type.Optional(
				Type.Boolean({ description: "Main session only: run as a watch; each stdout line reaches you as a message. Expires after timeout (default 300, max 3600 s) unless persistent." }),
			),
			persistent: Type.Optional(
				Type.Boolean({ description: "With monitor: no expiry; runs until `pi-bg-stop <id>` or the session ends. For session-long watches (PR comments, CI, chats)." }),
			),
		}),
		async execute(toolCallId, params: any, signal, onUpdate, ctx) {
			const { background, monitor, persistent, ...rest } = params;
			const options = shellOptions();
			const child = isChild();

			const wait = WAIT_COMMAND.exec(rest.command ?? "");
			if (wait) return { content: [{ type: "text", text: await waitFor(jobId(wait[1]), signal, rest.timeout) }], details: undefined as any };
			const stopId = STOP_COMMAND.exec(rest.command ?? "");
			if (stopId) return { content: [{ type: "text", text: stop(jobId(stopId[1])) }], details: undefined as any };
			const chain = WAIT_CHAIN.exec(rest.command ?? "");
			if (chain) {
				const parts: string[] = [];
				for (const m of chain[1].matchAll(/pi-bg-wait\s+((?:bg)?\d+)/g)) {
					const id = jobId(m[1].replace(/^bg/, ""));
					let text: string;
					try {
						text = await waitFor(id, signal, rest.timeout);
					} catch (e) {
						text = e instanceof Error ? e.message : String(e);
					}
					parts.push(`== ${id}\n${text}`);
				}
				return { content: [{ type: "text", text: parts.join("\n\n") }], details: undefined as any };
			}
			// Text of the waits and stops lifted out of a mixed command, put before the rest's result.
			let lead = "";
			const mixed = MIXED_WAIT.test(rest.command ?? "") ? splitMixed(rest.command ?? "") : "plain";
			if (!mixed || (monitor && mixed !== "plain")) {
				throw new Error(
					"pi-bg-wait and pi-bg-stop are answered by this tool, not by bash: they run first when joined to other commands with && or ;, but not after a pipe, || or &, in a subshell, in a monitor, or in a command with a heredoc. Send them as their own call, or joined with && or ;.",
				);
			}
			if (mixed !== "plain") {
				const parts: string[] = [];
				for (const op of mixed.ops) {
					let text: string;
					try {
						text = op.kind === "wait" ? await waitFor(op.id, signal, rest.timeout) : stop(op.id);
					} catch (e) {
						text = e instanceof Error ? e.message : String(e);
					}
					parts.push(`== pi-bg-${op.kind} ${op.id}\n${text}`);
				}
				if (!mixed.rest) return { content: [{ type: "text", text: parts.join("\n\n") }], details: undefined as any };
				lead = `${parts.join("\n\n")}\n\n== then: ${mixed.rest}\n`;
				rest.command = mixed.rest;
			}
			const withLead = async (run: () => Promise<any>) => {
				if (!lead) return run();
				try {
					const result = await run();
					return { ...result, content: [{ type: "text", text: lead }, ...(result.content ?? [])] };
				} catch (e) {
					throw new Error(lead + (e instanceof Error ? e.message : String(e)));
				}
			};

			if (monitor) {
				if (child) throw new Error("monitor works in the main session only: a sub-agent's run ends before its events could arrive.");
				if (process.platform === "win32") throw new Error("monitor needs POSIX process groups.");
				if (rest.timeout === undefined && !persistent) rest.timeout = MONITOR_DEFAULT_S;
				else if (rest.timeout !== undefined && !persistent && rest.timeout > MONITOR_MAX_S) rest.timeout = MONITOR_MAX_S;
				const call = { background: true, autoMs: 0, monitor: true, persistent: Boolean(persistent), label: rest.command } as {
					background: boolean;
					autoMs: number;
					job?: Job;
					monitor: boolean;
					persistent: boolean;
					label: string;
				};
				const tool = createBashToolDefinition(ctx.cwd, { ...options, operations: { exec: (command, cwd, o) => exec(call, command, cwd, o) } });
				const result = await tool.execute(toolCallId, rest, signal, onUpdate, ctx);
				if (!call.job) return result; // it ended before it could be handed off
				const job = call.job;
				const expiry = rest.timeout !== undefined ? `expires in ${rest.timeout}s` : "persistent: runs until stopped or the session ends";
				return {
					...result,
					content: [
						{
							type: "text",
							text: `Monitor ${job.id} started (${expiry}). Each stdout line will reach you as a message; carry on or end your turn.\nStop it: pi-bg-stop ${job.id}\nFull output: ${job.log}`,
						},
					],
				};
			}

			// Plain stock bash for a main-session foreground command, and on Windows
			// (process groups and the hand-off are POSIX).
			if (process.platform === "win32" || (!child && !background)) {
				return withLead(() => createBashToolDefinition(ctx.cwd, options).execute(toolCallId, rest, signal, onUpdate, ctx));
			}

			const call: { background: boolean; autoMs: number; job?: Job; label?: string } = {
				background: Boolean(background) && !child,
				autoMs: child ? AUTO_MS : 0,
				label: rest.command,
			};
			const tool = createBashToolDefinition(ctx.cwd, { ...options, operations: { exec: (command, cwd, o) => exec(call, command, cwd, o) } });
			return withLead(async () => {
				const result = await tool.execute(toolCallId, rest, signal, onUpdate, ctx);
				if (!call.job) return result;

				const notice = handOffNotice(call.job, call.background);
				if (call.background) return { ...result, content: [{ type: "text", text: notice }] };
				return { ...result, content: [...result.content, { type: "text", text: `\n${notice}` }] };
			});
		},
	});
}
