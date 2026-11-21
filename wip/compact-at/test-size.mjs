// Unit test of compact-at: node test-size.mjs [index.ts]
// Drives the `turn_end` hook with a fake pi and session (limit: 40 % of a 500k window = 200,000 tokens).
// Covers the context size after failed retries (harness review 2026-11-11) and that nothing compacts around an
// expired prompt cache any more (removed 2026-11-21).
import assert from "node:assert/strict";

const file = process.argv[2] ?? new URL("./index.ts", import.meta.url).pathname;
const ext = (await import(file)).default;

const old = new Date(Date.now() - 600 * 60_000).toISOString(); // 10 h idle
const ok = (id, total) => ({ type: "message", id, timestamp: old, message: { role: "assistant", stopReason: "toolUse", usage: { input: 2, cacheRead: total - 1002, cacheWrite: 500, output: 500 } } });
const err = (id) => ({ type: "message", id, timestamp: old, message: { role: "assistant", stopReason: "error", usage: { input: 0, output: 0 } } });
const user = (id) => ({ type: "message", id, timestamp: old, message: { role: "user", content: "hi" } });
const edit = (id, targetId, replacement = null) => ({ type: "context_edit", id, timestamp: old, targetId, replacement });

function load(branch, piTokens, { hasUI = true } = {}) {
	const hooks = {};
	const bus = {};
	const entries = [];
	const sent = [];
	const pi = {
		events: { on: (name, fn) => (bus[name] = fn) },
		on: (name, fn) => (hooks[name] = fn),
		appendEntry: (type, data) => entries.push({ type, data }),
		getActiveTools: () => [],
		sendMessage: (m) => sent.push(m),
	};
	ext(pi);
	let compactions = 0;
	const ctx = {
		hasUI,
		sessionManager: { getBranch: () => branch },
		getContextUsage: () => ({ tokens: piTokens, contextWindow: 500_000 }),
		ui: { notify() {} },
		isIdle: () => true,
		hasPendingMessages: () => false,
		compact: ({ onComplete }) => {
			compactions++;
			onComplete({ tokensAfter: 60_000 });
		},
	};
	return { hooks, bus, entries, sent, ctx, compactions: () => compactions };
}
const turnEnd = (branch, piTokens, opts) => {
	const t = load(branch, piTokens, opts);
	t.hooks.turn_end({ message: { stopReason: "toolUse" } }, t.ctx);
	return t;
};

// 1. the 11-11 case: a 221k response, then 429s each omitted by a context_edit; pi's estimate says 112k
const retries = [user("u1"), ok("a1", 220_929)];
for (let k = 0; k < 8; k++) retries.push(err(`e${k}`), edit(`x${k}`, `e${k}`));
retries.push(err("e8")); // the last failure, not yet omitted
let t = turnEnd(retries, 112_190);
assert.equal(t.compactions(), 1);
assert.equal(t.sent.length, 1); // mid-task: the run is told to continue
console.log("ok  failed retries: uses the last response's 220,929 (over 200,000), compacts and continues");

// 2. no edits, under the limit: nothing
assert.equal(turnEnd([user("u1"), ok("a1", 100_000), user("u2")], 100_400).compactions(), 0);
console.log("ok  under the limit: no compaction");

// 3. an edit that replaces content: pi's number stands (the old size no longer holds)
assert.equal(turnEnd([user("u1"), ok("a1", 220_000), edit("x1", "a1", { content: "short" })], 40_000).compactions(), 0);
console.log("ok  replacing edit: pi's 40,000 kept, no compaction");

// 4. an omission of a successful message: pi's number stands
assert.equal(turnEnd([user("u1"), ok("a1", 220_000), user("u2"), edit("x1", "a1")], 40_000).compactions(), 0);
console.log("ok  omitted good message: pi's 40,000 kept");

// 5. a compaction after the response: pi's number (null until the next response) stands
assert.equal(turnEnd([user("u1"), ok("a1", 220_000), { type: "compaction", id: "c1", timestamp: old }, err("e1"), edit("x1", "e1")], null).compactions(), 0);
console.log("ok  compaction entry: size unknown, no compaction");

// 6. print mode: inert even over the limit
assert.equal(turnEnd([user("u1"), ok("a1", 300_000)], 300_000, { hasUI: false }).compactions(), 0);
console.log("ok  print mode: inert");

// 7. no compaction around an expired cache (removed 2026-11-21): 190k tokens after 10 h idle, under the 40 % limit.
// No `input`, session or bg-bash wake listener is registered, a turn end arms no timer, and nothing is recorded.
t = load([user("u1"), ok("a1", 190_000)], 190_000);
assert.deepEqual(Object.keys(t.hooks).sort(), ["before_agent_start", "turn_end"]);
assert.equal(t.bus["bg-bash:before-wake"], undefined);
const realSetTimeout = globalThis.setTimeout;
let timers = 0;
globalThis.setTimeout = (...a) => (timers++, realSetTimeout(...a));
t.hooks.turn_end({ message: { stopReason: "stop" } }, t.ctx);
globalThis.setTimeout = realSetTimeout;
assert.equal(timers, 0);
assert.equal(t.compactions(), 0);
assert.equal(t.entries.length, 0);
console.log("ok  idle session: no input or wake hook, no timer, no compaction, no entry");
console.log("all 7 passed");
