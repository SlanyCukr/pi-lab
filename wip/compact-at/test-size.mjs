// Unit test of compact-at's context size after failed retries (harness review 2026-11-11): node test-size.mjs [index.ts]
// Drives the `input` hook with a fake pi and session; the compact-at-idle entry records the size it used.
import assert from "node:assert/strict";

const file = process.argv[2] ?? new URL("./index.ts", import.meta.url).pathname;
const ext = (await import(file)).default;

const old = new Date(Date.now() - 600 * 60_000).toISOString(); // 10 h idle
const ok = (id, total) => ({ type: "message", id, timestamp: old, message: { role: "assistant", stopReason: "toolUse", usage: { input: 2, cacheRead: total - 1002, cacheWrite: 500, output: 500 } } });
const err = (id) => ({ type: "message", id, timestamp: old, message: { role: "assistant", stopReason: "error", usage: { input: 0, output: 0 } } });
const user = (id) => ({ type: "message", id, timestamp: old, message: { role: "user", content: "hi" } });
const edit = (id, targetId, replacement = null) => ({ type: "context_edit", id, timestamp: old, targetId, replacement });

async function run(branch, piTokens) {
	const hooks = {};
	const entries = [];
	const pi = {
		events: { on() {} },
		on: (name, fn) => (hooks[name] = fn),
		appendEntry: (type, data) => entries.push({ type, data }),
		getActiveTools: () => [],
		sendMessage() {},
	};
	ext(pi);
	let compacted = false;
	const ctx = {
		hasUI: true,
		sessionManager: { getBranch: () => branch },
		getContextUsage: () => ({ tokens: piTokens, contextWindow: 1_000_000 }),
		ui: { notify() {} },
		compact: ({ onComplete }) => {
			compacted = true;
			onComplete({ tokensAfter: 60_000 });
		},
	};
	await hooks.input({ source: "interactive" }, ctx);
	const rec = entries.find((e) => e.type === "compact-at-idle")?.data;
	return { tokens: rec?.tokens, outcome: rec?.outcome, compacted };
}

// 1. the 11-11 case: a 221k response, then 429s each omitted by a context_edit; pi's estimate says 112k
const retries = [user("u1"), ok("a1", 220_929)];
for (let k = 0; k < 8; k++) retries.push(err(`e${k}`), edit(`x${k}`, `e${k}`));
retries.push(err("e8")); // the last failure, not yet omitted
let r = await run(retries, 112_190);
assert.equal(r.tokens, 220_929);
assert.equal(r.compacted, true);
console.log("ok  failed retries: uses the last response's 220,929, compacts");

// 2. no edits: pi's own number (it already counts the last response) is kept when it is the larger
r = await run([user("u1"), ok("a1", 100_000), user("u2")], 100_400);
assert.equal(r.tokens, 100_400);
assert.equal(r.outcome, "skipped: under the token limit");
console.log("ok  no edits: pi's 100,400 kept, skipped");

// 3. an edit that replaces content: pi's number stands (the old size no longer holds)
r = await run([user("u1"), ok("a1", 220_000), edit("x1", "a1", { content: "short" })], 40_000);
assert.equal(r.tokens, 40_000);
assert.equal(r.compacted, false);
console.log("ok  replacing edit: pi's 40,000 kept, skipped");

// 4. an omission of a successful message: pi's number stands
r = await run([user("u1"), ok("a1", 220_000), user("u2"), edit("x1", "a1")], 40_000);
assert.equal(r.tokens, 40_000);
console.log("ok  omitted good message: pi's 40,000 kept");

// 5. a compaction after the response: pi's number (null until the next response) stands
r = await run([user("u1"), ok("a1", 220_000), { type: "compaction", id: "c1", timestamp: old }, err("e1"), edit("x1", "e1")], null);
assert.equal(r.tokens, null);
assert.equal(r.outcome, "skipped: context size unknown");
console.log("ok  compaction: size unknown, skipped");
console.log("all 5 passed");
