/**
 * arg-fixes — repair tool arguments the model gets wrong in a predictable way, before the tool runs.
 *
 * 1. Placeholder strings in optional arguments. Opus 5.5 fills optional parameters it means to
 *    leave unset, and for a string-typed one it sometimes writes the text "null". pi-subagents
 *    then rejects `thinking: "null"` ("Invalid thinking level", by design) and would look for a
 *    model or session literally named "null"; the model retries without it, costing a turn.
 *    Seen 2026-09-22/23.
 *
 * 2. `\uXXXX` escapes in edit text. In non-ASCII files (Czech strings, typographic dashes) Opus
 *    writes `edits[].oldText` with the characters as literal six-character escapes (`Spojen\u00e9`
 *    for `Spojené`), so the text is not found. 2026-10-07/08 in the find-gaps loop: 20 of 29
 *    failed edits (509 edits), one retry turn each. When oldText as written is not in the file
 *    but its decoded form is, the edit gets the decoded oldText. newText is decoded more narrowly,
 *    since nothing checks it against the file: only escapes of non-ASCII characters (an intended
 *    `\u000a` or `\u0022` stays), never after a backslash (`\\u00e9` stays), and only when the
 *    file itself writes no non-ASCII character as an escape. Text found as written is never touched.
 *
 * 3. Control characters in edit or write text. Next to a non-ASCII letter, Opus sometimes emits a
 *    broken JSON escape instead of the letter: `Zpravodajov\b\b\b\b`, `Upozorn\fd`. Over the find-gaps
 *    run to 2026-10-10, 56 edit calls carried a backspace, form feed or similar: 43 failed with a
 *    misleading "text not found" (often retried unchanged, up to 3 times), and 13 wrote the control
 *    characters into files (ledger, tests, source). Such a call is now blocked with a reason that
 *    names the character and the text before it, unless the file already contains that character.
 *    Tab, newline and carriage return are never blocked.
 *
 * `tool_call` handlers may mutate `event.input` before the tool runs (no re-validation follows);
 * the assistant message in the session keeps what the model wrote, so the prompt cache is not
 * touched.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// tool -> optional string parameters where "null" / "undefined" / "" / "none" can only mean "not set"
const FIELDS: Record<string, readonly string[]> = {
	subagent: ["model", "thinking", "resume"],
};
const PLACEHOLDER = /^\s*(null|undefined|none|)\s*$/i;

const HAS_ESCAPE = /\\u[0-9a-fA-F]{4}/;
const decode = (s: string) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
// Escapes of non-ASCII characters not preceded by a backslash: the model's transport habit, not source syntax.
const NON_ASCII_ESCAPE = /(?<!\\)\\u(00[89a-fA-F][0-9a-fA-F]|0[1-9a-fA-F][0-9a-fA-F]{2}|[1-9a-fA-F][0-9a-fA-F]{3})/g;
const decodeNonAscii = (s: string) => s.replace(NON_ASCII_ESCAPE, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

// The same loosening pi's edit tool applies before it gives up (edit-diff.js normalizeForFuzzyMatch),
// so "found" here means "the edit tool would find it".
const loose = (s: string) =>
	s
		.replace(/\r\n?/g, "\n")
		.normalize("NFKC")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010-\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");

function fileText(path: unknown, cwd: string): string | undefined {
	if (typeof path !== "string" || !path) return undefined;
	const p = path.replace(/^@/, "").replace(/^~(?=\/|$)/, homedir());
	try {
		return readFileSync(isAbsolute(p) ? p : resolve(cwd, p), "utf8");
	} catch {
		return undefined; // missing file: the edit tool reports it
	}
}

/** Decodes escaped edits in place; returns how many were changed. Exported for the test. */
export function fixEscapedEdits(input: any, cwd: string): number {
	const edits: any[] = Array.isArray(input?.edits) ? input.edits : typeof input?.oldText === "string" ? [input] : [];
	const escaped = edits.filter((e) => typeof e?.oldText === "string" && HAS_ESCAPE.test(e.oldText));
	if (escaped.length === 0) return 0;
	const text = fileText(input.path, cwd);
	if (text === undefined) return 0;
	const looseText = loose(text);
	const has = (s: string) => text.includes(s) || looseText.includes(loose(s));
	const fileUsesEscapes = new RegExp(NON_ASCII_ESCAPE.source).test(text);
	let fixed = 0;
	for (const e of escaped) {
		if (has(e.oldText)) continue; // the file really contains the escape
		const oldText = decode(e.oldText);
		if (!has(oldText)) continue; // not found either way: let the edit tool say so
		e.oldText = oldText;
		if (typeof e.newText === "string" && !fileUsesEscapes) e.newText = decodeNonAscii(e.newText);
		fixed++;
	}
	return fixed;
}

// C0 controls except tab, newline and carriage return, plus DEL.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const NAMES: Record<string, string> = { "\b": "backspace", "\f": "form feed", "\v": "vertical tab", "\u0000": "NUL", "\u001B": "escape", "\u007F": "delete" };

/** Why an edit/write call carries a stray control character, or undefined. Exported for the test. */
export function controlCharProblem(toolName: string, input: any, cwd: string): string | undefined {
	const fields: [string, unknown][] =
		toolName === "write"
			? [["content", input?.content]]
			: (Array.isArray(input?.edits) ? input.edits : [input]).flatMap((e: any, i: number) => [
					[Array.isArray(input?.edits) ? `edits[${i}].oldText` : "oldText", e?.oldText],
					[Array.isArray(input?.edits) ? `edits[${i}].newText` : "newText", e?.newText],
				]);
	let text: string | undefined | null = null; // null: not read yet
	for (const [name, value] of fields) {
		if (typeof value !== "string") continue;
		for (const m of value.matchAll(CONTROL)) {
			if (text === null) text = fileText(input?.path, cwd);
			if (text?.includes(m[0])) continue; // the file already has this one: may be intended
			const code = `U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
			const before = JSON.stringify(value.slice(Math.max(0, m.index - 30), m.index));
			return (
				`${toolName} blocked: ${name} contains the control character ${code}${NAMES[m[0]] ? ` (${NAMES[m[0]]})` : ""} after ${before}, ` +
				"and the file has none. This is a broken escape, usually where a non-ASCII letter (\u00e9, \u0161, \u0159, \u016f) was meant. " +
				"Write the letter itself, or copy the exact text from a fresh read of the file. Nothing was changed."
			);
		}
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event: any, ctx: any) => {
		const input = event?.input;
		if (!input || typeof input !== "object") return undefined;
		if (event.toolName === "edit" || event.toolName === "write") {
			const cwd = ctx?.cwd ?? process.cwd();
			if (event.toolName === "edit") fixEscapedEdits(input, cwd);
			const reason = controlCharProblem(event.toolName, input, cwd);
			return reason ? { block: true, reason } : undefined;
		}
		const fields = FIELDS[event?.toolName];
		if (!fields) return undefined;
		for (const field of fields) {
			if (typeof input[field] === "string" && PLACEHOLDER.test(input[field])) delete input[field];
		}
		return undefined;
	});
}
