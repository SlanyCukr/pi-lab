/**
 * arg-fixes — drop placeholder strings the model puts into optional tool arguments.
 *
 * Opus 5.5 fills optional parameters it means to leave unset, and for a string-typed one it
 * sometimes writes the text "null" instead of leaving it out. pi-subagents then rejects
 * `thinking: "null"` ("Invalid thinking level", by design: an unknown level would silently turn
 * thinking off) and would look for a model or session literally named "null"; the model retries
 * without it, costing a turn. Seen 2026-09-22/23.
 *
 * `tool_call` handlers may mutate `event.input` before the tool runs (no re-validation follows);
 * the assistant message in the session keeps what the model wrote, so the prompt cache is not
 * touched. Only the listed optional string fields of the listed tools are changed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// tool -> optional string parameters where "null" / "undefined" / "" / "none" can only mean "not set"
const FIELDS: Record<string, readonly string[]> = {
	subagent: ["model", "thinking", "resume"],
};
const PLACEHOLDER = /^\s*(null|undefined|none|)\s*$/i;

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event: any) => {
		const fields = FIELDS[event?.toolName];
		const input = event?.input;
		if (!fields || !input || typeof input !== "object") return undefined;
		for (const field of fields) {
			if (typeof input[field] === "string" && PLACEHOLDER.test(input[field])) delete input[field];
		}
		return undefined;
	});
}
