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
// hidden params leave the schema (and `required`); the others stay. pi-web-access 0.47: fetch_content.redirects, web_search.model
const prop = (names) => Object.fromEntries(names.map((n) => [n, { type: "string", description: n }]));
const fetchTool = mod.trimTool({ name: "fetch_content", description: "x", input_schema: { type: "object", properties: prop(["url", "urls", "prompt", "mode", "auth", "proxy", "redirects"]), required: ["url", "redirects"] } });
assert.deepEqual(Object.keys(fetchTool.input_schema.properties), ["url", "urls", "prompt", "mode"]);
assert.deepEqual(fetchTool.input_schema.required, ["url"]);
const searchTool = mod.trimTool({ name: "web_search", description: "x", input_schema: { type: "object", properties: prop(["query", "queries", "category", "provider", "model"]) } });
assert.deepEqual(Object.keys(searchTool.input_schema.properties), ["query", "queries", "category"]);
// pi 1.5.0 renders the list as a `<tools>` section (system-prompt.js): the whole section goes, the sections around it stay
const sys15 =
	"You are a coding assistant running inside pi.\n\n<tools>\n- read: Read file contents\n- bash: Execute bash commands (ls, grep, find, etc.)\n\nAdditional tools may be available.\n</tools>\n\n<rules>\n- Use bash for file operations like ls, rg, find\n- You can inspect PI_* environment variables\n</rules>\n\n<cwd>\n/tmp\n</cwd>";
const out15 = mod.trimSystemText(sys15);
assert.equal(out15, "You are a coding assistant running inside pi.\n\n<rules>\n- You can inspect PI_* environment variables\n</rules>\n\n<cwd>\n/tmp\n</cwd>");
// the trailer pi-web's older pi wrote, and a section with no tools listed (left alone)
assert.equal(mod.trimSystemText("P\n\n<tools>\n- a: b\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.\n</tools>\n\n<cwd>\n/x\n</cwd>"), "P\n\n<cwd>\n/x\n</cwd>");
assert.equal(mod.trimSystemText("P\n\n<tools>\n(none)\n\nAdditional tools may be available.\n</tools>"), "P\n\n<tools>\n(none)\n\nAdditional tools may be available.\n</tools>");
console.log("tool-trim: all payload shapes trimmed, hidden params dropped, 1.5 tools section dropped (13 checks)");
