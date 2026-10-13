import { mkdtempSync, writeFileSync } from "node:fs";
import { controlCharProblem, dropPlaceholders, fixCrEscapes, fixEscapedEdits } from "./index.ts";
import { tmpdir } from "node:os";
const D = mkdtempSync(`${tmpdir()}/argfix-`);
// Run: node test.ts (Node >= 23 strips the types)
let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fail++; };
writeFileSync(`${D}/cz.py`, '    "Spojené národy": "OSN",\n    # Austria’s ÖVP  \n');
writeFileSync(`${D}/lit.py`, 'x = "lit \\u00e9 stays"\n');
// 1 escaped oldText, plain file -> decoded, newText decoded too
let i: any = { path: "cz.py", edits: [{ oldText: '"Spojen\\u00e9 n\\u00e1rody"', newText: '"Spojen\\u00e9 st\\u00e1ty"' }] };
ok(fixEscapedEdits(i, D) === 1 && i.edits[0].oldText === '"Spojené národy"' && i.edits[0].newText === '"Spojené státy"', "decodes oldText and newText");
// 2 file really contains the escape -> untouched
i = { path: "lit.py", edits: [{ oldText: 'lit \\u00e9 stays', newText: 'lit \\u00e9 x' }] };
ok(fixEscapedEdits(i, D) === 0 && i.edits[0].oldText === 'lit \\u00e9 stays', "keeps escapes the file contains");
// 3 neither form found -> untouched
i = { path: "cz.py", edits: [{ oldText: 'nope \\u00e9', newText: 'y' }] };
ok(fixEscapedEdits(i, D) === 0 && i.edits[0].oldText === 'nope \\u00e9', "leaves a real miss alone");
// 4 fuzzy: trailing spaces + smart quote, absolute path, mixed edits
i = { path: `${D}/cz.py`, edits: [{ oldText: "# Austria's \\u00d6VP", newText: "# \\u00d6VP" }, { oldText: '"OSN"', newText: '"UN"' }] };
ok(fixEscapedEdits(i, "/") === 1 && i.edits[0].oldText === "# Austria's ÖVP" && i.edits[1].newText === '"UN"', "fuzzy match, other edits untouched");
// 5 missing file, no escapes
ok(fixEscapedEdits({ path: "missing.py", edits: [{ oldText: "\\u00e9", newText: "" }] }, D) === 0, "missing file");
ok(fixEscapedEdits({ path: "cz.py", edits: [{ oldText: "OSN", newText: "\\u00e9" }] }, D) === 0, "no escape in oldText: nothing");
// 6 surrogate pair
writeFileSync(`${D}/e.md`, "smile 😀 here\n");
i = { path: "e.md", edits: [{ oldText: "smile \\ud83d\\ude00", newText: "x" }] };
ok(fixEscapedEdits(i, D) === 1 && i.edits[0].oldText === "smile 😀", "surrogate pair");
// 7 newText: intended ASCII escapes and doubled backslashes stay; non-ASCII escapes decode
writeFileSync(`${D}/n.ts`, 'const a = "Česko";\n');
i = { path: "n.ts", edits: [{ oldText: '"\\u010cesko"', newText: '"\\u010cesko\\u000a\\u0022" + "\\\\u00e9" + "\\u00e9"' }] };
ok(fixEscapedEdits(i, D) === 1 && i.edits[0].oldText === '"Česko"' && i.edits[0].newText === '"Česko\\u000a\\u0022" + "\\\\u00e9" + "é"', "newText keeps \\u000a, \\u0022, \\\\u00e9; decodes \\u00e9");
// 8 a file that writes non-ASCII as escapes: oldText decodes (validated), newText stays as written
writeFileSync(`${D}/m.py`, 'A = "Česko"\nB = r"\\u00e9"\n');
i = { path: "m.py", edits: [{ oldText: 'A = "\\u010cesko"', newText: 'A = "\\u010cechy"' }] };
ok(fixEscapedEdits(i, D) === 1 && i.edits[0].oldText === 'A = "Česko"' && i.edits[0].newText === 'A = "\\u010cechy"', "file with escapes: newText untouched");
// 9 control characters: broken escapes are blocked, unless the file already has the character
writeFileSync(`${D}/c.sql`, "-- dropped (\"Redakce\", \"Zpravodajov\u00e9\")\n\tx = 1\n");
let r = controlCharProblem("edit", { path: "c.sql", edits: [{ oldText: '"Zpravodajov\b\b', newText: "x" }] }, D);
ok(!!r && r.includes("edits[0].oldText") && r.includes("U+0008 (backspace)") && r.includes('after "\\"Zpravodajov"'), "blocks a backspace in oldText, names field, char and text before");
r = controlCharProblem("edit", { path: "c.sql", edits: [{ oldText: "x = 1", newText: "x = \f2" }] }, D);
ok(!!r && r.includes("edits[0].newText") && r.includes("form feed"), "blocks a form feed in newText");
ok(controlCharProblem("edit", { path: "c.sql", oldText: "\tx = 1\n", newText: "\tx = 2\r\n" }, D) === undefined, "tab, newline, CR pass (legacy single-edit form)");
writeFileSync(`${D}/ff.py`, "a = 1\n\f\nb = 2\n");
ok(controlCharProblem("edit", { path: "ff.py", edits: [{ oldText: "\f\nb", newText: "\f\nc" }] }, D) === undefined, "file already has the char: allowed");
r = controlCharProblem("edit", { path: "ff.py", edits: [{ oldText: "\f\nb", newText: "\f\nc\b" }] }, D);
ok(!!r && r.includes("edits[0].newText") && r.includes("U+0008"), "an allowed form feed does not hide a later backspace");
r = controlCharProblem("write", { path: "new.md", content: "done \u001b[0m" }, D);
ok(!!r && r.startsWith("write blocked: content") && r.includes("(escape)"), "write of a new file with ESC blocked");
ok(controlCharProblem("write", { path: "new.md", content: "plain \u00e9\n" }, D) === undefined, "plain write passes");
ok(controlCharProblem("edit", { path: "missing.py", edits: [{ oldText: "a\u0007", newText: "b" }] }, D)?.includes("U+0007") === true, "missing file: still blocked");
// 10 a carriage return that ate an escape's backslash (c212 verdicts3.json, README "\ru2265"): repaired, so the edit finds its text
writeFileSync(`${D}/v.json`, '{"outlet": "Seznam Zpr\u00e1vy", "bar": "clean \u2265 18"}\r\n');
i = { path: "v.json", edits: [{ oldText: '"Seznam Zpr\ru00e1vy"', newText: '"Seznam Zpr\ru00e1vy \u2014 web"' }, { oldText: "clean \ru2265 18\"}\r\n", newText: "x\r\n" }] };
ok(fixCrEscapes("edit", i, D) === 3 && i.edits[0].oldText === '"Seznam Zprávy"' && i.edits[0].newText === '"Seznam Zprávy \u2014 web"' && i.edits[1].oldText === 'clean ≥ 18"}\r\n' && i.edits[1].newText === "x\r\n", "CR before uXXXX decoded in oldText and newText; CRLF kept");
i = { path: "v.json", edits: [{ oldText: "a\ru0041", newText: "b\ru00e1" }] };
ok(fixCrEscapes("edit", i, D) === 1 && i.edits[0].oldText === "a\ru0041" && i.edits[0].newText === "bá", "ASCII code point (\\ru0041) left alone");
writeFileSync(`${D}/raw.txt`, "line\ru00e1 kept\n");
i = { path: "raw.txt", edits: [{ oldText: "line\ru00e1 kept", newText: "line\ru00e1 two" }] };
ok(fixCrEscapes("edit", i, D) === 0 && i.edits[0].newText === "line\ru00e1 two", "file already has the sequence: untouched");
const w: any = { path: "new.md", content: "nap\ru0159. ok\r\n" };
ok(fixCrEscapes("write", w, D) === 1 && w.content === "nap\u0159. ok\r\n", "write content of a new file repaired");
ok(fixCrEscapes("edit", { path: "v.json", edits: [{ oldText: "plain", newText: "text" }] }, D) === 0, "no CR: nothing");
// placeholders: the todo update seen 3 times in the loop renamed task 1 to "null"
let p: any = { action: "update", id: 1, status: "completed", activeForm: "null", description: "null", subject: "null" };
ok(dropPlaceholders("todo", p) === 3 && JSON.stringify(p) === '{"action":"update","id":1,"status":"completed"}', "todo update: null subject/description/activeForm dropped");
p = { action: "create", subject: "Fix login", description: "None", activeForm: "fixing login" };
ok(dropPlaceholders("todo", p) === 1 && p.subject === "Fix login" && p.activeForm === "fixing login" && !("description" in p), "todo create: real text kept");
p = { source: "lsp", scope: "paths", paths: ["a.ts"], path: "null", mode: "full" };
ok(dropPlaceholders("lens_diagnostics", p) === 1 && !("path" in p) && p.mode === "full", "lens_diagnostics: null path dropped");
p = { subagent_type: "Explore", thinking: "undefined", model: "", prompt: "null" };
ok(dropPlaceholders("subagent", p) === 2 && p.prompt === "null", "subagent: only listed fields");
p = { path: "null", content: "null" };
ok(dropPlaceholders("write", p) === 0 && p.path === "null", "other tools untouched");
process.exit(fail);
