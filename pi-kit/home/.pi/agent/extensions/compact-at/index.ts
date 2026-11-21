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
// Size after failed retries (harness review 2026-11-11): pi omits each failed request (a 429, an overload) with a
// context_edit entry, and any context_edit after the last response makes getContextUsage() drop that response's real
// count for a chars/4 estimate of every message, which misses Fable's redacted thinking (11-11: 112,190 read against
// a real 220,929). contextTokens() takes the larger of the two while every edit since the response only omits a
// failed or aborted request; a compaction or any other edit leaves pi's number as it is.
//
// No compaction around an expired prompt cache (removed 2026-11-21, the user: "completely delete the autocompact
// feature"). From 11-05 to 11-21 a session idle for 65+ min at 150k+ tokens was compacted on the user's return, before
// a bg-bash wake-up and by a timer. The timer never ran for a session started outside pi-web, so the user's message
// waited for the summary instead; and it does not happen often. A cold return re-writes the whole context once
// (about $3 at 370k tokens); `/compact` before leaving a big session avoids that.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PERCENT = Number(process.env.PI_COMPACT_AT_PERCENT ?? 40);
const FIXED_TOKENS = process.env.PI_COMPACT_AT_TOKENS ? Number(process.env.PI_COMPACT_AT_TOKENS) : undefined; // test hook
const DEBUG = !!process.env.PI_COMPACT_AT_DEBUG;

const INSTRUCTIONS = [
	"Preserve exactly: the user's goal and standing instructions; decisions made and the reason for each;",
	"work finished, work in progress and work still open; identifiers (branch names, worktree paths, PR and run numbers,",
	"sub-agent ids with what each was asked and whether its result was already collected; background commands, monitors",
	"and loops still running, with their id and what each is for); the commands that verified",
	"results and what they printed; file:line evidence already gathered. Drop raw command output, file dumps and",
	"sub-agent report bodies once their conclusion is recorded.",
].join(" ");

const CONTINUE =
	"Context was compacted automatically to keep the session small. The task is not finished: continue from the summary without asking.";

export default function (pi: ExtensionAPI) {
	let isChild = false;
	let running = false;
	// After a compaction, stay quiet until context has grown well past what compaction left behind,
	// so a summary that is itself above the limit cannot cause a loop.
	let suppressBelow = 0;

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

	const lastResponseTokens = (ctx: ExtensionContext): number | undefined => {
		const branch: any[] = ctx.sessionManager.getBranch();
		const failed = (e: any) =>
			e?.type === "message" && e.message?.role === "assistant" && (e.message.stopReason === "error" || e.message.stopReason === "aborted");
		for (let k = branch.length - 1; k >= 0; k--) {
			const e = branch[k];
			if (e?.type === "compaction") return undefined;
			if (e?.type === "context_edit" && (e.replacement != null || !failed(branch.find((t) => t?.id === e.targetId)))) return undefined;
			if (e?.type === "message" && e.message?.role === "assistant" && !failed(e)) {
				const u = e.message.usage ?? {};
				const total = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.output ?? 0);
				if (total > 0) return total;
			}
		}
		return undefined;
	};
	const contextTokens = (ctx: ExtensionContext) => {
		const usage = ctx.getContextUsage();
		const real = usage?.tokens == null ? undefined : lastResponseTokens(ctx);
		return { usage, tokens: real && usage?.tokens != null ? Math.max(usage.tokens, real) : usage?.tokens };
	};

	pi.on("turn_end", (event: any, ctx: ExtensionContext) => {
		if (checkChild()) {
			log("child session: inert");
			return;
		}
		if (!ctx.hasUI) {
			log("print/json mode: inert");
			return;
		}
		if (running) return;
		const { usage, tokens } = contextTokens(ctx);
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
