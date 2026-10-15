// node wip/tool-trim/test.mjs [path-to-index.ts]: the system text is trimmed in every payload shape.
import assert from "node:assert/strict";
const mod = await import(process.argv[2] ?? new URL("./index.ts", import.meta.url).href);
let handler;
mod.default({ on: (ev, fn) => { if (ev === "before_provider_request") handler = fn; } });
const sys = "Intro\nAvailable tools:\n- read: Read files\n- bash: Run\n\nGuidelines:\n- Use bash for file operations like ls, rg, find\n<available_skills>\n  <skill>\n    <name>pi-lens-ast-grep</name>\n    <description>use ast-grep</description>\n  </skill>\n  <skill>\n    <name>diagnose</name>\n  </skill>\n</available_skills>";
const clean = (t) => !t.includes("pi-lens-ast-grep") && !t.includes("Available tools:") && !t.includes("Use bash for file operations") && t.includes("<name>diagnose</name>") && t.startsWith("Intro");
const cases = {
	anthropic: { system: [{ type: "text", text: sys }], messages: [{ role: "user", content: "hi" }] },
	codex: { instructions: sys, input: [{ role: "user", content: "hi" }] },
	chat: { messages: [{ role: "system", content: sys }, { role: "user", content: "hi" }] },
	responses: { input: [{ role: "developer", content: sys }, { role: "user", content: [{ type: "input_text", text: "Available tools:\n- x: y\n" }] }] },
	responsesParts: { input: [{ role: "developer", content: [{ type: "input_text", text: sys }] }] },
};
const get = {
	anthropic: (p) => p.system[0].text, codex: (p) => p.instructions, chat: (p) => p.messages[0].content,
	responses: (p) => p.input[0].content, responsesParts: (p) => p.input[0].content[0].text,
};
for (const [name, payload] of Object.entries(cases)) {
	const out = handler({ payload });
	assert.ok(clean(get[name](out)), `${name}: system text not trimmed: ${JSON.stringify(get[name](out))}`);
}
// only the leading system item is touched; user text that quotes the list stays as sent
const r = handler({ payload: cases.responses });
assert.deepEqual(r.input[1], cases.responses.input[1]);
assert.equal(r.input.length, 2);
// a payload whose first input item is a user message passes through unchanged
const u = { input: [{ role: "user", content: sys }] };
assert.equal(handler({ payload: u }).input[0].content, sys);
// deterministic: the same payload gives byte-identical output (prompt cache)
assert.equal(JSON.stringify(handler({ payload: cases.responses })), JSON.stringify(handler({ payload: cases.responses })));
console.log("tool-trim: all payload shapes trimmed (7 checks)");
