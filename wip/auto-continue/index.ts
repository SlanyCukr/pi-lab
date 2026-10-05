import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Auto mode (2026-09-26). 40 of 212 user messages in a week were "continue / keep going / do it",
// and on Opus 5.5 most followed a final message that offered work instead of doing it
// ("Should I …? My pick is …", "say X and I'll …"). With auto mode on, such an ending gets one
// extra model request ("go with your pick") through pi's agent_before_settle continuation, which
// stays on the same system prompt and tools, so the prompt cache holds.
//
// On by default in interactive sessions since 2026-09-30: a replay eval of 36 real decision points
// (~/pi-lab/wip/pi-eval) raised rule-following from 68% to 85% (train) and 71% to 79% (held-out),
// 21 continuations, 0 made worse; three prompt rewrites gained nothing held-out. When the user's
// message was a question and auto mode was not asked for, the nudge is read-only (look, then answer).
// Explicit on: `/auto`, or a user message like "keep going", "don't stop", "max autonomy".
// Off: `/auto off` (this session), PI_AUTO_CONTINUE=manual (off until asked), PI_AUTO_CONTINUE=0
// (extension disabled). Headless runs (`pi -p`, no UI) and sub-agents stay off unless asked.
// At most MAX_PER_PROMPT continuations per user message. Never continues when the ending mentions
// production, deletion, money, secrets, merges or publishing: those decisions stay with the user.

const MAX_PER_PROMPT = 3;
const LOG = join(dirname(fileURLToPath(import.meta.url)), "auto-continue.jsonl");

const NUDGE =
	"Auto mode: go with your pick and do it now. Stop only for a production write, an irreversible or destructive action, spending money, or input only the user has; then end with that one decision.";
const NUDGE_QUESTION =
	"Auto mode: the user asked a question, so do only the read-only part of your pick now (look, check, measure, search) and then answer. Do not change files or state; if a fix is needed, name it in the answer.";

// A user message that asks rather than instructs: ends with "?" or opens with a question word.
const QUESTION = /\?\s*$|^(why|what|how|where|when|which|who|is|are|do|does|did|can|could|should|would|will|isn'?t|aren'?t|don'?t|doesn'?t)\b/i;

const TRIGGER = /\b(keep (going|working|at it)|don'?t stop|do not stop|carry on|max(imum)? autonomy|full autonomy|be autonomous|work autonomously)\b/i;

// The last paragraph offers work or asks the user to pick between the agent's own options.
const OFFERS = [
	/\b(should|shall|may) I\b[^?]*\?/i,
	/\b(do you want|would you like|want) me to\b[^?]*\?/i,
	/\b(my pick|i'?d pick|i would pick|i'?d (go with|start with)|i recommend|i suggest)\b[\s\S]*\?|\?[\s\S]*\b(my pick|i'?d pick|i'?d (go with|start with))\b/i,
	/\b(say|reply|type)\s+(the word|["“'`(][^"”'`)\n]{1,40}["”'`)])\s*(,\s*)?(and I\b|to (test|start|run|apply|do|have me|make me)\b)/i,
	// "If you want the real answer, I can look on disk", "If yes, I'll draft it" (eval 2026-09-30)
	/\bif (you('d)? (want|like|prefer)|yes|so)\b[^.?\n]{0,120}?,?\s*I('ll| will| can| could)\b/i,
];

// An explicit pick of the agent's own option (not "skip"/"leave it"). It outranks a weekday in the
// alternative: "Should I fix it now, or wait for Monday's run? I'd pick the fix."
const PICK = /\b(my pick|i'?d pick|i would pick|i'?d (go with|start with))\b(?!:?\s*(is\s+)?(no|skip|to skip|leave|to leave|not|neither)\b)/i;

// Endings that look like offers but cannot be continued now: waiting for an outside event,
// or the agent's own pick is to do nothing.
const NOT_NOW = [
	/\b(when|once|after|until)\b[^.?\n]{0,40}\b(lands?|finish\w*|pass\w*|arriv\w*|is done|completes?|reopen\w*|restart\w*)\b/i,
	/\bpick( is)?:?\s+(no|skip|to skip|leave|to leave|not|neither)\b/i,
];
const LATER_DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|next week)\b/i;

// Decisions that stay with the user even in auto mode.
const USER_ONLY =
	/\b(prod(uction)?|deploy\w*|delet\w*|drop|remov\w* (the )?data|irreversibl\w*|destructiv\w*|force[- ]?push|merge\w*|publish\w*|releas\w*|re-?queue\w*|pay|paid|spend\w*|billing|credits?|password|secrets?|api key|log ?in|sign ?in|email|contact\w*|legal|pric(e|es|ing)|per (month|year))\b|[$€£]\s?\d|\d\s?([$€£]|(eur|euros?|usd|dollars?|czk|gbp)\b|k[čc](?![a-z]))|\/\s?(month|mo|year|yr)\b/i;

const lastAssistant = (messages: any[]): any => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role === "assistant") return m;
		if (m?.role === "user") return undefined;
	}
	return undefined;
};

const textOf = (message: any): string =>
	(Array.isArray(message?.content) ? message.content : [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => c.text)
		.join("\n")
		.trim();

// Last paragraph: the lines after the final blank line (at most the last 3 non-empty lines).
// A short closing status line ("Your stash is intact.") does not hide an offer just above it,
// so a last paragraph under 160 characters without a question mark also takes in the one before.
const tailOf = (text: string): string => {
	const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
	const lines = (p: string | undefined) => (p ?? "").split("\n").filter((l) => l.trim());
	const last = paragraphs[paragraphs.length - 1];
	const short = (last ?? "").length < 160 && !(last ?? "").includes("?");
	return [...(short ? lines(paragraphs[paragraphs.length - 2]).slice(-3) : []), ...lines(last).slice(-3)].join("\n");
};

export function classifyEnding(text: string): "offer" | "user-only" | "none" {
	const tail = tailOf(text);
	if (!OFFERS.some((re) => re.test(tail)) || NOT_NOW.some((re) => re.test(tail))) return "none";
	if (LATER_DAY.test(tail) && !PICK.test(tail)) return "none";
	return USER_ONLY.test(tail) ? "user-only" : "offer";
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_AUTO_CONTINUE === "0") return;
	const manual = process.env.PI_AUTO_CONTINUE === "manual";
	let on = false;
	let explicit = false; // turned on by /auto or "keep going", not just the default
	let asked = false; // the current user message is a question
	let used = 0;
	let lastTail = ""; // the ending already answered with a continuation in this run

	const isChild = () => {
		try {
			const active = pi.getActiveTools();
			return active.includes("notify_parent") || active.includes("ask_parent");
		} catch {
			return true;
		}
	};
	const show = (ctx: any) => {
		if (ctx?.hasUI) ctx.ui.setStatus("auto", on ? "auto ▶" : undefined);
	};
	const log = (entry: Record<string, unknown>) => {
		try {
			appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
		} catch {
			// logging is best-effort; auto mode works without it
		}
	};

	pi.on("session_start", (_event: any, ctx: any) => {
		on = !manual && Boolean(ctx?.hasUI); // sub-agents are excluded again at settle time
		explicit = false;
		used = 0;
		show(ctx);
	});

	pi.registerCommand("auto", {
		description: "Auto mode: when an answer ends by offering work, continue with the agent's pick (/auto, /auto off)",
		handler: async (args: string, ctx: any) => {
			const arg = (args ?? "").trim().toLowerCase();
			on = arg === "off" ? false : arg === "status" ? on : true;
			if (arg !== "status") explicit = on;
			show(ctx);
			const message = on
				? `Auto mode on: answers that end by offering work continue with the agent's pick (at most ${MAX_PER_PROMPT} times per message). Production, deletion, money and similar decisions still stop. /auto off to stop.`
				: "Auto mode off.";
			if (ctx?.hasUI) ctx.ui.notify(message, "info");
			else console.log(message);
		},
	});

	pi.on("input", (event: any, ctx: any) => {
		if (event?.source === "extension") return;
		used = 0;
		lastTail = "";
		const text = typeof event?.text === "string" ? event.text.trim() : "";
		asked = QUESTION.test(text);
		if (!explicit && text && !text.startsWith("/") && TRIGGER.test(text) && !isChild()) {
			on = true;
			explicit = true;
			show(ctx);
			log({ event: "on", by: event.text.slice(0, 80) });
		}
	});

	pi.on("agent_before_settle", (event: any) => {
		if (!on || event.outcome !== "completed" || event.continue || used >= MAX_PER_PROMPT || isChild()) return;
		const message = lastAssistant(event.context?.contextMessages ?? []);
		if (!message || message.stopReason !== "stop") return;
		const text = textOf(message);
		const kind = classifyEnding(text);
		if (kind === "none") return;
		const tail = tailOf(text).slice(-200);
		// Same question again after "go with your pick": the model thinks it needs the user. Let it stop.
		if (tail === lastTail) {
			log({ event: "skip-repeated", tail });
			return;
		}
		lastTail = tail;
		const readOnly = asked && !explicit;
		log({ event: kind === "offer" ? (readOnly ? "continue-read-only" : "continue") : "skip-user-only", n: used + (kind === "offer" ? 1 : 0), tail });
		if (kind !== "offer") return;
		used++;
		return {
			entries: [
				{
					type: "custom_message",
					customType: "auto-continue",
					content: readOnly ? NUDGE_QUESTION : NUDGE,
					display: true,
				},
			],
			continue: true,
		};
	});
}
