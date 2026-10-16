// node wip/cache-ttl/test.mjs [path-to-index.ts]: the request keeps one system head whether or not a
// `context` handler (pi-lens) made pi rebuild the list. Links pi's real @earendil-works/pi-ai into a
// temp folder so the extension's import resolves to the code pi runs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "index.ts");
const piBin = realpathSync(execFileSync("bash", ["-lc", "command -v pi"], { encoding: "utf8" }).trim());
const piPkg = piBin.slice(0, piBin.indexOf("/pi-coding-agent/") + "/pi-coding-agent".length);
const piAi = join(piPkg, "node_modules", "@earendil-works", "pi-ai");
const dir = mkdtempSync(join(tmpdir(), "cache-ttl-test-"));
mkdirSync(join(dir, "node_modules", "@earendil-works"), { recursive: true });
symlinkSync(piAi, join(dir, "node_modules", "@earendil-works", "pi-ai"));
copyFileSync(src, join(dir, "index.ts"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
process.env.PI_CACHE_DIVERGENCE_LOG = "0";
const mod = await import(pathToFileURL(join(dir, "index.ts")).href);
const { getCurrentSystemMessage } = await import(pathToFileURL(join(piAi, "dist", "index.js")).href);

const load = () => {
	const handlers = {};
	mod.default({ on: (ev, fn) => (handlers[ev] = fn), getActiveTools: () => ["read", "bash"] });
	return handlers;
};
const fold = load().context_with_system;
assert.equal(typeof fold, "function", "no context_with_system handler");

const tool = (name) => ({ name, description: `${name} tool`, parameters: { type: "object", properties: {} } });
const sys0 = { role: "system", content: "", sections: { preamble: "You are pi.", tools: "<tools>read, bash</tools>" }, toolsAdded: [tool("read"), tool("bash")], timestamp: 1 };
const sys1 = { role: "system", content: "", sections: { tools: "<tools>read, bash, web_search</tools>" }, toolsAdded: [tool("web_search")], timestamp: 5 };
const user = { role: "user", content: [{ type: "text", text: "go" }], timestamp: 2 };
const a1 = { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "web_enable", arguments: {} }], timestamp: 3 };
const r1 = { role: "toolResult", toolCallId: "t1", toolName: "web_enable", content: [{ type: "text", text: "on" }], isError: false, timestamp: 4 };
const a2 = { role: "assistant", content: [{ type: "toolCall", id: "t2", name: "bash", arguments: { command: "echo" } }], timestamp: 6 };
const r2 = { role: "toolResult", toolCallId: "t2", toolName: "bash", content: [{ type: "text", text: "x" }], isError: false, timestamp: 7 };
const lens = { role: "user", content: [{ type: "text", text: "[pi-lens automated check — not a user request] fix it" }], timestamp: 8 };

// 1. the stored shape: initial head plus a mid-conversation tool change -> one merged head
const stored = [sys0, user, a1, r1, sys1, a2, r2];
const out = fold({ type: "context_with_system", messages: stored });
assert.ok(out, "stored shape was not folded");
assert.deepEqual(out.messages[0], getCurrentSystemMessage(stored));
assert.deepEqual(out.messages.slice(1), [user, a1, r1, a2, r2]);
assert.deepEqual(out.messages[0].toolsAdded.map((t) => t.name), ["read", "bash", "web_search"]);
// 2. pi's rebuild after a context handler returned messages: [merged head, ...visible, injected]
const rebuilt = [getCurrentSystemMessage(stored), user, a1, r1, a2, r2, lens];
assert.equal(fold({ type: "context_with_system", messages: rebuilt }), undefined, "rebuilt shape was changed");
// the key property: both shapes now send the same head, so pi-lens turns no longer flip it
assert.deepEqual(rebuilt[0], out.messages[0]);
// 3. no mid-conversation system message: untouched (every session without a tool change)
assert.equal(fold({ type: "context_with_system", messages: [sys0, user, a1, r1] }), undefined);
assert.equal(fold({ type: "context_with_system", messages: [user, a1] }), undefined);
assert.equal(fold({ type: "context_with_system", messages: undefined }), undefined);
// 4. deterministic (prompt cache)
assert.equal(JSON.stringify(fold({ type: "context_with_system", messages: stored })), JSON.stringify(out));
// 5. the input list is not mutated
assert.equal(stored.length, 7);
assert.equal(stored[4], sys1);
// 6. a later removal is replayed too: the merged head no longer declares the removed tool
const sys2 = { role: "system", content: "", sections: { tools: "<tools>read, bash</tools>" }, toolsRemoved: [{ name: "web_search" }], timestamp: 9 };
const removed = fold({ type: "context_with_system", messages: [...stored, sys2, lens] });
assert.deepEqual(removed.messages[0].toolsAdded.map((t) => t.name), ["read", "bash"]);
assert.equal(removed.messages[0].sections.tools, "<tools>read, bash</tools>");
assert.equal(removed.messages.at(-1), lens);
// 7. PI_SYSTEM_FOLD=0 turns it off
process.env.PI_SYSTEM_FOLD = "0";
assert.equal(load().context_with_system({ type: "context_with_system", messages: stored }), undefined);
delete process.env.PI_SYSTEM_FOLD;
console.log("cache-ttl: 10 checks passed");
