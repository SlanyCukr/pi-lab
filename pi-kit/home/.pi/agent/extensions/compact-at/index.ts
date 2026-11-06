// Compacts the MAIN session when context crosses a share of the active model's window (default 40%).
//
// Why an extension: pi 0.85.1 has one global `compaction.reserveTokens` (trigger = contextWindow - reserve),
// which cannot express a percentage across 1M and 272K models. `compaction.modelOverrides` exists upstream
// but is not in 0.85.1 (SettingsManager.getCompactionSettings ignores it; checked 2026-09-20).
//
// Why main session only: ctx.compact() aborts the running agent loop. The main session can be re-prompted
// to continue; a sub-agent whose loop is aborted is reported to its parent as finished. Children keep pi's
// native behaviour (threshold / overflow compaction).
//
// Why interactive and RPC only: in print/JSON mode (`pi -p`, no UI) the abort ends the one-shot run, since
// nothing re-prompts it; the find-gaps skeptic (GPT-6 Astra, 272K window) died at ~108K twice (2026-09-28).
// pi's native compaction still applies there.
//
// Why never while sub-agents run: aborting the parent loop makes @gotgenes/pi-subagents stop its running
// background children ("stopped - user request"; reproduced 2026-09-20). Compaction is deferred until the
// running set is empty. If a terminal event were ever missed the set would stay non-empty and this extension
// would simply stay quiet, which is the safe direction.
//
// Compact on return (harness review 2026-11-05): a user message after more than PI_COMPACT_IDLE_MIN (65) minutes idle
// finds the 1 h prompt cache expired, so its turn re-writes the whole context at the 1 h write price (2x input).
// 40 such turns over 150k tokens in 30 days cost $87.53 (11-04 09:45: 371,751 tokens, $3.01). When the context
// is over PI_COMPACT_IDLE_TOKENS (150k), the message waits for a compaction first: pi serializes the older history
// with tool output cut short (test: 1,459 summary input tokens for a 49k context, no cache write), and the turn and
// the turns after it carry the summary plus the last ~20k tokens instead of the whole history.
// Each return after the idle limit leaves a `compact-at-idle` custom entry in the session (never sent to the model):
// idle minutes, tokens, and compacted / skipped with the reason / failed with the error (harness review 2026-11-06:
// on 11-05 a 22 h return at 389k tokens re-wrote the cache for $3.15 and left no trace of why it did not compact).
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PERCENT = Number(process.env.PI_COMPACT_AT_PERCENT ?? 40);
const FIXED_TOKENS = process.env.PI_COMPACT_AT_TOKENS ? Number(process.env.PI_COMPACT_AT_TOKENS) : undefined; // test hook
const DEBUG = !!process.env.PI_COMPACT_AT_DEBUG;
const IDLE_MS = Number(process.env.PI_COMPACT_IDLE_MIN ?? 65) * 60_000;
const IDLE_TOKENS = Number(process.env.PI_COMPACT_IDLE_TOKENS ?? 150_000);

const INSTRUCTIONS = [
	"Preserve exactly: the user's goal and standing instructions; decisions made and the reason for each;",
	"work finished, work in progress and work still open; identifiers (branch names, worktree paths, PR and run numbers,",
	"sub-agent ids with what each was asked and whether its result was already collected); the commands that verified",
	"results and what they printed; file:line evidence already gathered. Drop raw command output, file dumps and",
	"sub-agent report bodies once their conclusion is recorded.",
].join(" ");

const CONTINUE =
	"Context was compacted automatically to keep the session small. The task is not finished: continue from the summary without asking. If a todo list exists, run `todo list` first to see what is done and what is left.";

export default function (pi: ExtensionAPI) {
	let isChild = false;
	let running = false;
	// After a compaction, stay quiet until context has grown well past what compaction left behind,
	// so a summary that is itself above the limit cannot cause a loop.
	let suppressBelow = 0;
	// Time of the last provider response, for the idle check; 0 until this process saw a turn (then read from the session).
	let lastTurnAt = 0;

	const log = (msg: string) => DEBUG && console.error(`[compact-at] ${msg}`);

	const runningAgents = new Set<string>();
	for (const name of ["subagents:created", "subagents:started", "subagents:resuming"]) {
		pi.events.on(name, (data: any) => data?.id && runningAgents.add(String(data.id)));
	}
	for (const name of ["subagents:completed", "subagents:failed", "subagents:resumed"]) {
		pi.events.on(name, (data: any) => data?.id && runningAgents.delete(String(data.id)));
	}

	pi.on("before_agent_start", (event: any) => {
		isChild = typeof event?.systemPrompt === "string" && event.systemPrompt.includes("<active_agent name=");
	});

	// Two independent child checks: the fork's <active_agent name=...> tag (before_agent_start above), and the
	// ask_parent/notify_parent tools it installs in every child session.
	const checkChild = () => {
		if (isChild) return true;
		try {
			const active = pi.getActiveTools();
			if (active.includes("notify_parent") || active.includes("ask_parent")) isChild = true;
		} catch (e: any) {
			log(`getActiveTools failed: ${e?.message}`); // best effort: the systemPrompt check still applies
		}
		return isChild;
	};

	const lastAssistantAt = (ctx: ExtensionContext) => {
		const branch = ctx.sessionManager.getBranch();
		for (let k = branch.length - 1; k >= 0; k--) {
			const e: any = branch[k];
			if (e?.type === "message" && e.message?.role === "assistant") return Date.parse(e.timestamp) || 0;
		}
		return 0;
	};

	pi.on("input", async (event: any, ctx: ExtensionContext) => {
		if (event?.source === "extension" || !ctx.hasUI || checkChild()) return { action: "continue" };
		const last = lastTurnAt || lastAssistantAt(ctx);
		const idle = last ? Date.now() - last : 0;
		if (idle <= IDLE_MS) return { action: "continue" };
		const tokens = ctx.getContextUsage()?.tokens;
		const record = (outcome: string, extra: Record<string, unknown> = {}) => {
			log(`input: idle=${Math.round(idle / 1000)}s tokens=${tokens} ${outcome}`);
			try {
				pi.appendEntry("compact-at-idle", { idleMin: Math.round(idle / 60_000), tokens, outcome, ...extra });
			} catch (e: any) {
				log(`appendEntry failed: ${e?.message}`);
			}
		};
		const skip = event?.streamingBehavior ? "agent running" : running ? "compaction running" : tokens == null ? "context size unknown"
			: tokens <= IDLE_TOKENS ? "under the token limit" : runningAgents.size > 0 ? "sub-agents running" : "";
		if (skip) {
			record(`skipped: ${skip}`);
			return { action: "continue" };
		}
		running = true;
		try {
			try {
				ctx.ui.notify(`Compacting first: ${Math.round(tokens! / 1000)}k tokens after ${Math.round(idle / 60_000)} min idle (the prompt cache expired)`, "info");
			} catch (e: any) {
				log(`notify failed: ${e?.message}`);
			}
			await new Promise<void>((resolve) =>
				ctx.compact({
					customInstructions: INSTRUCTIONS,
					onComplete: (result: any) => {
						const after = result?.estimatedTokensAfter ?? result?.tokensAfter;
						if (typeof after === "number") suppressBelow = Math.floor(after * 1.5);
						record("compacted", { tokensAfter: after });
						resolve();
					},
					onError: (error: any) => {
						// the message still goes out, on the full context; say so, since that turn re-writes the whole cache
						record("failed", { error: String(error?.message ?? error) });
						try {
							ctx.ui.notify(`Compacting first failed (${error?.message}); your message goes out on the full context`, "warning");
						} catch (e: any) {
							log(`notify failed: ${e?.message}`);
						}
						resolve();
					},
				}),
			);
		} catch (e: any) {
			record("failed", { error: String(e?.message ?? e) }); // ctx.compact threw before starting
		} finally {
			running = false; // a throw must not leave the 40 % trigger disabled for the rest of the session
		}
		return { action: "continue" };
	});

	pi.on("turn_end", (event: any, ctx: ExtensionContext) => {
		lastTurnAt = Date.now();
		if (checkChild()) {
			log("child session: inert");
			return;
		}
		if (!ctx.hasUI) {
			log("print/json mode: inert");
			return;
		}
		if (running) return;
		const usage = ctx.getContextUsage();
		const tokens = usage?.tokens;
		const limit = FIXED_TOKENS ?? (usage?.contextWindow ? Math.floor((usage.contextWindow * PERCENT) / 100) : undefined);
		log(`tokens=${tokens} limit=${limit} suppress=${suppressBelow} stop=${event?.message?.stopReason}`);
		if (tokens == null || limit == null || tokens <= limit || tokens <= suppressBelow) return;
		if (runningAgents.size > 0) {
			log(`deferred: ${runningAgents.size} sub-agent(s) running`);
			return;
		}

		const midTask = event?.message?.stopReason === "toolUse";
		const resume = (text: string) => {
			if (!midTask) return;
			try {
				pi.sendMessage({ customType: "compact-at", content: text, display: true }, { triggerTurn: true });
			} catch (e: any) {
				log(`continue failed: ${e?.message}`);
			}
		};
		running = true;
		try {
			if (ctx.hasUI) ctx.ui.notify(`Compacting: ${tokens} tokens is over ${PERCENT}% of the window`, "info");
		} catch (e: any) {
			log(`notify failed: ${e?.message}`); // the notice is cosmetic; compaction goes ahead
		}
		ctx.compact({
			customInstructions: INSTRUCTIONS,
			onComplete: (result: any) => {
				running = false;
				const after = result?.estimatedTokensAfter ?? result?.tokensAfter;
				suppressBelow = Math.floor((typeof after === "number" ? after : limit) * 1.5);
				log(`done after=${after} suppressBelow=${suppressBelow} midTask=${midTask}`);
				resume(CONTINUE);
			},
			onError: (error: any) => {
				running = false;
				suppressBelow = Math.floor((tokens ?? 0) * 1.25); // do not hammer a failing compaction every turn
				log(`error: ${error?.message}`);
				// ctx.compact() already aborted the running loop, so the work must be restarted even though compaction failed.
				resume("An automatic compaction attempt interrupted you and then failed, so the context is unchanged. The task is not finished: continue where you left off without asking.");
			},
		});
	});
}
