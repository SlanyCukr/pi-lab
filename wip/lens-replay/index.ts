// Keeps pi-lens's retained findings in a session that continues in a new process, so its prompt cache still hits.
//
// With `contextInjection.retain` (on since 2026-11-10) pi-lens re-sends each finding it injected, unchanged and at the
// same place, in every later request of the session. That list lives in the pi-lens process only. A session continued
// by another process (`pi --session`, `pi -c`, pi-web after a restart, the find-gaps fix round) is built from the
// session file, which holds none of those messages: the request differs from the first finding on, the cache read
// falls to the tools+system head, and Anthropic drops every thinking block after that point
// (`thinking_dropped`, reason `prefix_binding_mismatch`).
// Seen 2026-11-13 00:44: the fix round of loop cycle 517 continued a 341,216-token session 33 s after its last turn
// and read 14,647 cached tokens; 288,999 were written again ($4.64 on Fable 5.2) and 94 thinking blocks dropped.
//
// What it does, on Anthropic-shaped requests of the main session:
// - records each retained pi-lens message as a `lens-replay` session entry: the id of the tool result it follows, its
//   position there, its text. pi-lens messages are user messages that start with "[pi-lens automated "; the ones
//   sent in one request form a group, and a retained group ends with the snapshot label;
// - in a process that did not see them made, puts the recorded messages back after their tool result when pi-lens
//   has not sent them itself.
// Not covered: a finding pi-lens appends to a user prompt's own text (it has no message of its own), and messages
// that follow something other than a tool result.
// PI_LENS_REPLAY=0 turns it off. Test: node wip/lens-replay/test.mjs
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MARK = "[pi-lens automated ";
const SNAPSHOT = "[pi-lens snapshot:";
const ENTRY = "lens-replay";

export type Kept = { after: string; n: number; content: string };

const textOf = (message: any): string | undefined => {
	if (message?.role !== "user") return undefined;
	const c = message.content;
	if (typeof c === "string") return c;
	if (Array.isArray(c) && c.length > 0 && c.every((b: any) => b?.type === "text" && typeof b.text === "string")) return c.map((b: any) => b.text).join("");
	return undefined;
};
const isLens = (message: any): boolean => textOf(message)?.startsWith(MARK) === true;
const toolResultId = (message: any): string | undefined => {
	if (message?.role !== "user" || !Array.isArray(message.content)) return undefined;
	const last = message.content[message.content.length - 1];
	return last?.type === "tool_result" && typeof last.tool_use_id === "string" ? last.tool_use_id : undefined;
};
export const keyOf = (k: Kept): string => `${k.after}#${k.n}`;

/** The retained pi-lens messages of a request, each with the tool result it follows. */
export function collect(messages: any[]): Kept[] {
	const out: Kept[] = [];
	messages.forEach((message, i) => {
		const after = toolResultId(message);
		if (!after) return;
		// the pi-lens messages right after the tool result, up to the last one that carries the snapshot label
		let end = i;
		for (let j = i + 1; j < messages.length && isLens(messages[j]); j++) if (textOf(messages[j])!.includes(SNAPSHOT)) end = j;
		for (let j = i + 1; j <= end; j++) out.push({ after, n: j - i - 1, content: textOf(messages[j])! });
	});
	return out;
}

/** The request with the recorded messages put back where pi-lens has not sent them; undefined when nothing is missing. */
export function replay(messages: any[], kept: Kept[]): any[] | undefined {
	if (kept.length === 0) return undefined;
	const byAnchor = new Map<string, Kept[]>();
	for (const k of kept) byAnchor.set(k.after, [...(byAnchor.get(k.after) ?? []), k]);
	let changed = false;
	const out: any[] = [];
	messages.forEach((message, i) => {
		out.push(message);
		const id = toolResultId(message);
		const list = id ? byAnchor.get(id) : undefined;
		if (!list) return;
		const present = new Set<string>();
		for (let j = i + 1; j < messages.length && isLens(messages[j]); j++) present.add(textOf(messages[j])!);
		for (const k of [...list].sort((a, b) => a.n - b.n)) {
			if (present.has(k.content)) continue;
			out.push({ role: "user", content: k.content });
			changed = true;
		}
	});
	return changed ? out : undefined;
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_LENS_REPLAY === "0") return;
	const debug = (text: string) => {
		if (process.env.PI_LENS_REPLAY_DEBUG) console.error(`[lens-replay] ${text}`);
	};
	const isChild = () => {
		try {
			const active = pi.getActiveTools();
			return active.includes("notify_parent") || active.includes("ask_parent");
		} catch {
			return true; // unsure: leave the request alone
		}
	};

	let loadedFor: string | undefined;
	let fromFile: Kept[] = []; // recorded by an earlier process: put back when missing
	let seen = new Set<string>(); // recorded already, by any process
	const load = (ctx: ExtensionContext) => {
		const id = String(ctx.sessionManager.getSessionId?.() ?? ctx.sessionManager.getSessionFile?.() ?? "");
		if (id === loadedFor) return;
		loadedFor = id;
		fromFile = [];
		for (const e of ctx.sessionManager.getBranch() as any[]) {
			const d = e?.type === "custom" && e.customType === ENTRY ? e.data : undefined;
			if (d && typeof d.after === "string" && typeof d.content === "string") fromFile.push({ after: d.after, n: Number(d.n) || 0, content: d.content });
		}
		seen = new Set(fromFile.map(keyOf));
		debug(`session ${id.slice(0, 8)}: ${fromFile.length} recorded message(s)`);
	};
	pi.on("session_start", () => {
		loadedFor = undefined; // a new or reloaded session: read its entries again
	});

	pi.on("before_provider_request", (event: any, ctx: ExtensionContext) => {
		const payload = event?.payload;
		if (!payload || !("system" in payload) || !Array.isArray(payload.messages) || isChild()) return undefined;
		try {
			load(ctx);
			const messages = replay(payload.messages, fromFile);
			if (messages) debug(`put back ${messages.length - payload.messages.length} message(s)`);
			for (const k of collect(messages ?? payload.messages)) {
				if (seen.has(keyOf(k))) continue;
				seen.add(keyOf(k));
				pi.appendEntry(ENTRY, k);
			}
			return messages ? { ...payload, messages } : undefined;
		} catch (err: any) {
			debug(`failed, request left as it was: ${err?.message}`);
			return undefined;
		}
	});
}
