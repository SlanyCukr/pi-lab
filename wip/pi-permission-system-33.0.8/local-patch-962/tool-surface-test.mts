import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToolSurface } from "/home/slanycukr/.pi/agent/local-packages/pi-permission-system/src/exposure/tool-surface-prompt.ts";

const dump = JSON.parse(readFileSync("/home/slanycukr/pi-lab/backup-20260922-toolsurface/wire-dump-before.jsonl", "utf8").split("\n")[0]);
// Pi's own prompt, before the extension appended its block.
const raw: string = dump.text.slice(0, dump.text.lastIndexOf("\n\nAvailable tools:"));
assert.equal(raw.split("\n").filter((l) => l === "<tools>").length, 1);

const inputs = {
	allowedTools: ["read", "bash", "edit", "todo"],
	toolSnippets: { read: "Read file contents", bash: "Run a command", edit: "Edit", todo: "Todo" },
	guidelinesByTool: new Map([["todo", ["Use todo for multi-step work"]]]),
	piAuthoredPreamble: true,
};
const count = (s: string, x: string) => s.split("\n").filter((l) => l === x).length;

// 1. real prompt: Pi's tagged sections gone, one narrowed block at the end, the rest intact
const out = renderToolSurface(raw, inputs);
assert.equal(count(out, "<tools>"), 0);
assert.equal(count(out, "<rules>"), 0);
assert.equal(count(out, "</rules>"), 0);
assert.equal(count(out, "Available tools:"), 1);
assert.equal(count(out, "Guidelines:"), 1);
for (const tag of ["<docs>", "<addendum>", "</addendum>", "<skills>", "<cwd>"]) assert.equal(count(out, tag), 1, tag);
assert.ok(out.includes("# Working rules"));
assert.ok(out.includes("- todo: Todo"));
assert.ok(!out.includes("- advisor:"));
assert.ok(!/\n{3,}/.test(out), "no triple newlines");
const removed = raw.length - (out.length - out.slice(out.lastIndexOf("Available tools:")).length);
console.log("1 ok: removed", removed, "chars of Pi tool surface; out", out.length, "vs raw", raw.length);

// 2. idempotent on its own output
assert.equal(renderToolSurface(out, inputs), out);
console.log("2 ok: idempotent");

// 3. custom prompt (child): Pi's region is not ours, nothing removed above the block
const child = renderToolSurface(raw, { ...inputs, piAuthoredPreamble: false });
assert.equal(count(child, "<tools>"), 1);
console.log("3 ok: custom prompt untouched");

// 4. tags quoted later (addendum) are left alone
const quoted = "You are pi.\n\n<addendum>\nexample:\n<tools>\n- x: y\n</tools>\n</addendum>\n\n<cwd>\n/x\n</cwd>";
const q = renderToolSurface(quoted, inputs);
assert.equal(count(q, "<tools>"), 1);
console.log("4 ok: quoted tags kept");

// 5. old 0.85 format still handled
const old = "You are pi.\n\nAvailable tools:\n- read: Read\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.\n\nGuidelines:\n- Be concise in your responses\n\nCurrent working directory: /x";
const o = renderToolSurface(old, inputs);
assert.equal(count(o, "Available tools:"), 1);
assert.ok(o.indexOf("Available tools:") > o.indexOf("Current working directory"));
console.log("5 ok: 0.85 format");
