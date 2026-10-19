/**
 * arg-fixes — repair tool arguments the model gets wrong in a predictable way, before the tool runs.
 *
 * 1. Placeholder strings in optional arguments. Opus 5.5 fills optional parameters it means to
 *    leave unset, and for a string-typed one it sometimes writes the text "null". pi-subagents
 *    then rejects `thinking: "null"` ("Invalid thinking level", by design) and would look for a
 *    model or session literally named "null"; the model retries without it, costing a turn.
 *    Seen 2026-09-22/23. The same habit hits `todo` and `lens_diagnostics` (run to 2026-10-11: 8 of
 *    229 todo calls, 3 of them updates that renamed task 1 to "null" with description "null"; 7
 *    lens calls with `path: "null"`). Only free-text fields are listed: pi validates arguments
 *    before `tool_call`, so an enum field such as `status: "null"` fails there and never reaches us.
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
 *    Tab, newline and carriage return are never blocked. One broken form is repaired instead: a
 *    carriage return before `u` and four hex digits (`Zpr\ru00e1vy` for `Zprávy`, `\ru2265` for `≥`) is
 *    the escape `\uXXXX` with its backslash eaten; to 2026-10-12, 11 edit calls had it, 9 failed as
 *    "not found" and 2 wrote it into files. Only non-ASCII code points, and only when the file does
 *    not already contain that exact sequence.
 *
 * 4. Tabs in edit text. The same broken escape often comes out as a tab: `shrnut\t\u00ed`, `po pra\tsk`,
 *    `RFC 9116 \t\t\u00a72.5.5`. To 2026-10-19, 65 edit calls with a mid-line tab failed as "not found" (13 in
 *    one day, retried up to 4 times unchanged), and 15 wrote the tab into a file. An edit whose oldText or
 *    newText has a tab is blocked when the file has no tab at all (Makefile, *.mk, *.go, *.tsv never are).
 *
 * 5. Placeholder newText. While stuck on such a line, Opus ends the edit with `newText: "x"` (also `X`,
 *    `XX`, `PLACEHOLDER`, `unused`). Over the run 281 such calls; 51 matched (a fuzzy match drops a
 *    trailing tab, an escape decodes) and replaced real text with "x", e.g. a cs.json key cut to
 *    `x\u00e9m\u011b\u0159` (19 JSON errors), then 1-3 repair edits. An edit whose newText is only such a
 *    word, replacing a longer oldText, is blocked.
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
	todo: ["subject", "description", "activeForm"],
	lens_diagnostics: ["path"],
};
const PLACEHOLDER = /^\s*(null|undefined|none|)\s*$/i;

/** Deletes placeholder strings from the tool's optional free-text fields; returns how many. Exported for the test. */
export function dropPlaceholders(toolName: string, input: any): number {
	let dropped = 0;
	for (const field of FIELDS[toolName] ?? []) {
		if (typeof input?.[field] === "string" && PLACEHOLDER.test(input[field])) {
			delete input[field];
			dropped++;
		}
	}
	return dropped;
}

const HAS_ESCAPE = /\\u[0-9a-fA-F]{4}/;
const decode = (s: string) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
// Escapes of non-ASCII characters not preceded by a backslash: the model's transport habit, not source syntax.
const NON_ASCII_HEX = "(00[89a-fA-F][0-9a-fA-F]|0[1-9a-fA-F][0-9a-fA-F]{2}|[1-9a-fA-F][0-9a-fA-F]{3})";
const NON_ASCII_ESCAPE = new RegExp(`(?<!\\\\)\\\\u${NON_ASCII_HEX}`, "g");
const decodeNonAscii = (s: string) => s.replace(NON_ASCII_ESCAPE, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
// A `\uXXXX` escape whose backslash became a carriage return.
const CR_ESCAPE = new RegExp(`\\ru${NON_ASCII_HEX}`, "g");

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

/** Repairs CR-broken escapes in edit/write text in place; returns how many fields changed. Exported for the test. */
export function fixCrEscapes(toolName: string, input: any, cwd: string): number {
	const slots: [any, string][] =
		toolName === "write"
			? [[input, "content"]]
			: (Array.isArray(input?.edits) ? input.edits : [input]).flatMap((e: any) => [[e, "oldText"], [e, "newText"]] as [any, string][]);
	let text: string | undefined | null = null; // null: not read yet
	let fixed = 0;
	for (const [obj, key] of slots) {
		const value = obj?.[key];
		if (typeof value !== "string" || !value.includes("\r")) continue;
		const next = value.replace(CR_ESCAPE, (m: string, hex: string) => {
			if (text === null) text = fileText(input?.path, cwd);
			return text?.includes(m) ? m : String.fromCharCode(Number.parseInt(hex, 16));
		});
		if (next !== value) {
			obj[key] = next;
			fixed++;
		}
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

// Files where a tab is ordinary text even if the current content has none.
const TAB_NATIVE = /(^|\/)(GNUmakefile|Makefile|[^/]*\.(mk|go|tsv))$/i;

/** Why an edit carries a tab its file cannot contain, or undefined. Exported for the test. */
export function tabProblem(input: any, cwd: string): string | undefined {
	const named = Array.isArray(input?.edits);
	const edits: any[] = named ? input.edits : [input];
	let text: string | undefined | null = null; // null: not read yet
	for (const [i, e] of edits.entries()) {
		for (const key of ["oldText", "newText"]) {
			const value = e?.[key];
			if (typeof value !== "string") continue;
			const at = value.indexOf("\t");
			if (at < 0) continue;
			if (text === null) {
				if (typeof input?.path === "string" && TAB_NATIVE.test(input.path)) return undefined;
				text = fileText(input?.path, cwd);
			}
			if (text === undefined || text.includes("\t")) return undefined; // missing file: the tool says so; tabs in use: may be meant
			const before = JSON.stringify(value.slice(Math.max(0, at - 30), at));
			return (
				`edit blocked: ${named ? `edits[${i}].${key}` : key} has a tab after ${before}, and the file has no tab. ` +
				"This is a broken escape, usually where a non-ASCII letter (\u00e9, \u0159, \u00a7) was meant, so the edit cannot match " +
				"or would write a tab into the text. Write the letter itself, or anchor oldText on ASCII-only text next to it. Nothing was changed."
			);
		}
	}
	return undefined;
}

const PLACEHOLDER_TEXT = /^(x{1,3}|zz|placeholder|unused)$/i;

/** Why an edit would replace real text with a placeholder word, or undefined. Exported for the test. */
export function placeholderProblem(input: any): string | undefined {
	const named = Array.isArray(input?.edits);
	const edits: any[] = named ? input.edits : [input];
	for (const [i, e] of edits.entries()) {
		const word = typeof e?.newText === "string" ? e.newText.trim() : undefined;
		if (word === undefined || !PLACEHOLDER_TEXT.test(word) || typeof e?.oldText !== "string") continue;
		if (e.oldText.trim().length < word.length + 3) continue; // a short rename such as `y` -> `x`
		return (
			`edit blocked: ${named ? `edits[${i}].newText` : "newText"} is only ${JSON.stringify(word)}, so the edit would replace ` +
			`${e.oldText.length} characters of real text with a placeholder. Put the full replacement text in newText. ` +
			"If the oldText line has non-ASCII letters, anchor oldText on ASCII-only text next to them. " +
			`If ${JSON.stringify(word)} really is the new text, include a neighbouring word in both oldText and newText. Nothing was changed.`
		);
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event: any, ctx: any) => {
		const input = event?.input;
		if (!input || typeof input !== "object") return undefined;
		if (event.toolName === "edit" || event.toolName === "write") {
			const cwd = ctx?.cwd ?? process.cwd();
			fixCrEscapes(event.toolName, input, cwd);
			if (event.toolName === "edit") fixEscapedEdits(input, cwd);
			const reason =
				(event.toolName === "edit" ? (placeholderProblem(input) ?? tabProblem(input, cwd)) : undefined) ??
				controlCharProblem(event.toolName, input, cwd);
			return reason ? { block: true, reason } : undefined;
		}
		dropPlaceholders(event?.toolName, input);
		return undefined;
	});
}
