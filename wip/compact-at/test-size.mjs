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

// 6-9. the bg-bash gate (harness review 2026-11-14): a background result that wakes an idle session
function wake(branch, piTokens, { fail = false, hasUI = true } = {}) {
	const hooks = {};
	const bus = {};
	const entries = [];
	const pi = { events: { on: (name, fn) => (bus[name] = fn) }, on: (name, fn) => (hooks[name] = fn), appendEntry: (type, data) => entries.push(data), getActiveTools: () => [], sendMessage() {} };
	ext(pi);
	let finish;
	let compactions = 0;
	const ctx = {
		hasUI,
		sessionManager: { getBranch: () => branch },
		getContextUsage: () => ({ tokens: piTokens, contextWindow: 1_000_000 }),
		ui: { notify() {} },
		compact: ({ onComplete, onError }) => {
			compactions++;
			finish = () => (fail ? onError(new Error("boom")) : onComplete({ tokensAfter: 40_000 }));
		},
	};
	const ask = () => {
		const gate = { ctx, hold: false };
		bus["bg-bash:before-wake"](gate);
		return gate.hold;
	};
	return { ask, entries, finish: () => finish(), compactions: () => compactions };
}
const big = [user("u1"), ok("a1", 223_821)];
let w = wake(big, 223_821);
assert.equal(w.ask(), true); // idle 10 h, 224k: the result waits and a compaction starts
assert.equal(w.ask(), true); // asked again while it runs: still waiting, no second compaction
assert.equal(w.compactions(), 1);
w.finish();
await new Promise((r) => setImmediate(r));
assert.equal(w.ask(), false); // over: the result goes out
assert.deepEqual(w.entries.map((e) => [e.outcome, e.by]), [["compacted", "bg-bash"]]);
console.log("ok  wake: holds the result, compacts once, then lets it through");

w = wake(big, 223_821, { fail: true });
assert.equal(w.ask(), true);
w.finish();
await new Promise((r) => setImmediate(r));
assert.equal(w.ask(), false); // one try per idle period: no loop on a failing compaction
assert.equal(w.compactions(), 1);
assert.equal(w.entries[0].outcome, "failed");
console.log("ok  wake: a failed compaction lets the result through, no second try");

w = wake([user("u1"), ok("a1", 100_000)], 100_400);
assert.equal(w.ask(), false);
assert.equal(w.ask(), false);
assert.deepEqual(w.entries.map((e) => e.outcome), ["skipped: under the token limit"]); // recorded once
console.log("ok  wake: under the token limit, no hold, one entry");

const fresh = new Date().toISOString();
w = wake([user("u1"), { ...ok("a1", 223_821), timestamp: fresh }], 223_821);
assert.equal(w.ask(), false); // not idle: the cache is warm
assert.equal(wake(big, 223_821, { hasUI: false }).ask(), false); // print mode
assert.equal(w.entries.length, 0);
console.log("ok  wake: a warm session and print mode are left alone");
console.log("all 9 passed");
