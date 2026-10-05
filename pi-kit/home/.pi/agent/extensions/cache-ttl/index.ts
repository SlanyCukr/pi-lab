/**
 * cache-ttl — 1-hour prompt cache for the main session, 5 minutes for sub-agents.
 *
 * pi marks Anthropic cache breakpoints `{type: "ephemeral"}` (5 minutes) unless
 * PI_CACHE_RETENTION=long is set, and that variable would apply to every session in
 * the process, sub-agents included. A main session sits idle for longer than five
 * minutes all the time (the user reads, a background command runs), and each time it
 * pays for its whole context again; a sub-agent lives for minutes and would only pay
 * the higher 1-hour write price for nothing.
 *
 * So: leave the variable unset, and in the main session rewrite the breakpoints of an
 * Anthropic request to `ttl: "1h"`. Sub-agents are left as pi built them.
 * Env: PI_CACHE_TTL_MAIN (default "1h"; "5m" switches this off), PI_CACHE_TTL_DEBUG.
 *
 * System-prompt pin (2026-09-23). pi 0.87.1 starts a turn for a `sendMessage(..., {triggerTurn})`
 * custom message (bg-bash "finished", sub-agent notifications, compact-at) through
 * `_runAgentPrompt` directly, without `before_agent_start`. That run gets pi's base system
 * prompt, not the one the hooks built (pi-permission-system moves the tool list), so the
 * whole conversation is re-written to cache, and again on the next normal turn. Measured:
 * 6 of 7 bg-bash wake-ups missed the cache, about $2 each at 250K context.
 * Fix: remember the system prompt of the last hooked run and reuse it in an unhooked run,
 * but only when the tool list is the same. Env: PI_PROMPT_PIN=0 turns the pin off.
 */

import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TTL = process.env.PI_CACHE_TTL_MAIN ?? "1h";

// Prefix-divergence log (2026-09-24): some main-session requests after an 8-35 min pause
// read only the system prompt from cache although every write is 1 h. This records, per
// main-session Anthropic request, where the payload stopped matching the previous one
// (system, tools, or message index) so a miss can be told apart from a server-side
// eviction. Hashes and 80-char snippets only. PI_CACHE_DIVERGENCE_LOG=0 turns it off.
const DIVERGENCE_LOG = join(dirname(fileURLToPath(import.meta.url)), "divergence.jsonl");
const hash = (value: unknown): string => createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);
// Breakpoints move to the newest message every turn; they are not part of the content.
const withoutCacheControl = (message: any): any =>
	Array.isArray(message?.content)
		? { ...message, content: message.content.map(({ cache_control: _drop, ...rest }: any) => rest) }
		: message;
const snippet = (message: any): string => JSON.stringify(message?.content ?? "").slice(0, 80);

export default function (pi: ExtensionAPI) {
	const isChild = () => {
		try {
			const active = pi.getActiveTools();
			return active.includes("notify_parent") || active.includes("ask_parent");
		} catch {
			return true; // unsure: leave the request alone
		}
	};

	// --- system-prompt pin ---------------------------------------------------------------
	const PIN = process.env.PI_PROMPT_PIN !== "0";
	let hookPending = false;
	let runHooked = true;
	// A system prompt is a string (openai) or a list of content blocks (anthropic)
	type SystemValue = string | Array<Record<string, unknown>>;
	let pinned: { model: string; tools: string; field: string; key: string; value: SystemValue } | undefined;
	const toolKey = (payload: any): string =>
		JSON.stringify((payload.tools ?? []).map((t: any) => t?.name ?? t?.function?.name ?? ""));
	// Which payload field holds the system prompt, per API shape
	const systemField = (payload: any): string | undefined => {
		if ("system" in payload) return "system"; // anthropic-messages
		if (typeof payload.instructions === "string") return "instructions"; // openai responses / codex
		const first = payload.messages?.[0];
		if (first && (first.role === "system" || first.role === "developer")) return "messages[0]"; // chat completions
		return undefined;
	};
	const readField = (payload: any, field: string): SystemValue =>
		field === "messages[0]" ? payload.messages[0].content : payload[field];
	const writeField = (payload: any, field: string, value: SystemValue): any =>
		field === "messages[0]"
			? { ...payload, messages: [{ ...payload.messages[0], content: value }, ...payload.messages.slice(1)] }
			: { ...payload, [field]: value };

	pi.on("before_agent_start", () => {
		hookPending = true;
	});
	pi.on("agent_start", () => {
		runHooked = hookPending;
		hookPending = false;
	});
	pi.on("session_start", () => {
		pinned = undefined; // new session or /reload: prompt may have changed
	});

	const pinSystemPrompt = (payload: any): any => {
		if (!PIN || !payload) return undefined;
		const field = systemField(payload);
		if (!field) return undefined;
		const value = readField(payload, field);
		const key = JSON.stringify(value);
		const model = String(payload.model ?? "");
		const tools = toolKey(payload);
		if (runHooked) {
			pinned = { model, tools, field, key, value: structuredClone(value) };
			return undefined;
		}
		if (!pinned || pinned.model !== model || pinned.tools !== tools || pinned.field !== field || pinned.key === key) return undefined;
		if (process.env.PI_CACHE_TTL_DEBUG) console.error(`[cache-ttl] ${model}: unhooked run, reusing the hooked system prompt`);
		return writeField(payload, field, structuredClone(pinned.value));
	};

	let previous: { at: number; system: string; tools: string; messages: string[]; raw: any[] } | undefined;
	const logDivergence = (payload: any): void => {
		if (process.env.PI_CACHE_DIVERGENCE_LOG === "0" || !payload || !("system" in payload) || !Array.isArray(payload.messages) || isChild()) return;
		const raw = payload.messages.map(withoutCacheControl);
		const current = { at: Date.now(), system: hash(payload.system), tools: hash(payload.tools), messages: raw.map(hash), raw };
		const prev = previous;
		previous = current;
		if (!prev) return;
		const shared = Math.min(prev.messages.length, current.messages.length);
		let firstDiff = -1;
		for (let i = 0; i < shared; i++) {
			if (prev.messages[i] !== current.messages[i]) {
				firstDiff = i;
				break;
			}
		}
		// A pure append (the normal turn) is not logged; compaction shortens the list and is expected.
		const shrunk = current.messages.length < prev.messages.length;
		if (prev.system === current.system && prev.tools === current.tools && firstDiff < 0 && !shrunk) return;
		const entry = {
			ts: new Date(current.at).toISOString(),
			gapS: Math.round((current.at - prev.at) / 1000),
			model: payload.model,
			systemChanged: prev.system !== current.system,
			toolsChanged: prev.tools !== current.tools,
			firstDiff,
			prevLen: prev.messages.length,
			len: current.messages.length,
			role: firstDiff >= 0 ? current.raw[firstDiff]?.role : undefined,
			before: firstDiff >= 0 ? snippet(prev.raw[firstDiff]) : undefined,
			after: firstDiff >= 0 ? snippet(current.raw[firstDiff]) : undefined,
		};
		try {
			appendFileSync(DIVERGENCE_LOG, JSON.stringify(entry) + "\n");
		} catch (err) {
			if (process.env.PI_CACHE_TTL_DEBUG) console.error(`[cache-ttl] divergence log failed: ${err}`);
		}
	};

	pi.on("before_provider_request", (event: any) => {
		const pinnedPayload = pinSystemPrompt(event.payload);
		const ttlPayload = markTtl(pinnedPayload ?? event.payload);
		logDivergence(ttlPayload ?? pinnedPayload ?? event.payload);
		return ttlPayload ?? pinnedPayload;
	});

	const markTtl = (payload: any): any => {
		// Anthropic messages shape only: `system` blocks plus `messages`, breakpoints as cache_control
		if (TTL !== "1h" || !payload || !Array.isArray(payload.messages) || !("system" in payload) || isChild()) return undefined;

		// Only where Anthropic defines breakpoints: system blocks, tool definitions and
		// message content blocks. Tool inputs and schemas may hold a `cache_control` key
		// of their own and are passed through untouched.
		let changed = false;
		const mark = (block: any): any => {
			if (!block || typeof block !== "object" || block.cache_control?.type !== "ephemeral" || block.cache_control.ttl === TTL) return block;
			changed = true;
			return { ...block, cache_control: { ...block.cache_control, ttl: TTL } };
		};
		const blocks = (list: any): any => (Array.isArray(list) ? list.map(mark) : list);
		const next = {
			...payload,
			system: blocks(payload.system),
			tools: blocks(payload.tools),
			messages: payload.messages.map((message: any) => (Array.isArray(message?.content) ? { ...message, content: blocks(message.content) } : message)),
		};
		if (changed && process.env.PI_CACHE_TTL_DEBUG) console.error(`[cache-ttl] ${payload.model}: breakpoints set to ${TTL}`);
		return changed ? next : undefined;
	};
}
