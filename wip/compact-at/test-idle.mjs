// Unit test of compact-at's "compact while idle" timer (2026-11-14): node test-idle.mjs [index.ts]
// A fake pi, session and pi-web liveness registry; the idle limit is 0.3 s, so the timer fires 1.3 s after a turn end.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

process.env.PI_COMPACT_IDLE_MIN ??= "0.005";
const file = process.argv[2] ?? new URL("./index.ts", import.meta.url).pathname;
const off = process.env.PI_COMPACT_IDLE_PROACTIVE === "0";
const ext = (await import(file)).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const providers = [];
globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")] = {
	version: 1,
	register: (p) => {
		providers.push(p);
		return () => providers.splice(providers.indexOf(p), 1);
	},
};
const held = () => providers.some((p) => p.isActive());

function make({ tokens = 200_000, idle = true, pending = false, tools = [], compactMs = 0 } = {}) {
	const hooks = {};
	const entries = [];
	const s = { compactions: 0, entries, hooks, idle, pending, tokens };
	const pi = {
		events: { on() {} },
		on: (name, fn) => (hooks[name] = fn),
		appendEntry: (type, data) => entries.push({ type, data }),
		getActiveTools: () => tools,
		sendMessage() {},
	};
	ext(pi);
	s.ctx = {
		hasUI: true,
		sessionManager: { getBranch: () => [], getSessionId: () => "s1", getSessionFile: () => "/tmp/s1.jsonl" },
		getContextUsage: () => ({ tokens: s.tokens, contextWindow: 1_000_000 }),
		ui: { notify() {} },
		isIdle: () => s.idle,
		hasPendingMessages: () => s.pending,
		compact: ({ onComplete }) => {
			s.compactions++;
			setTimeout(() => {
				s.tokens = 40_000;
				onComplete({ tokensAfter: 40_000 });
			}, compactMs);
		},
	};
	hooks.session_start?.({}, s.ctx);
	s.turnEnd = () => hooks.turn_end({ message: { stopReason: "stop" } }, s.ctx);
	s.shutdown = () => hooks.session_shutdown?.();
	return s;
}

if (off) {
	// run as a child with PI_COMPACT_IDLE_PROACTIVE=0: no timer, no hold, and compact-on-return still works
	const s = make();
	s.turnEnd();
	assert.equal(held(), false);
	await sleep(1700);
	assert.equal(s.compactions, 0);
	await s.hooks.input({ source: "interactive" }, s.ctx);
	assert.equal(s.compactions, 1);
	console.log("ok  PI_COMPACT_IDLE_PROACTIVE=0: no timer and no hold; a message after the limit still compacts first");
	process.exit(0);
}

// 1. over the token limit and idle: held until the timer, compacted once, then released
let s = make();
s.turnEnd();
assert.equal(held(), true);
await sleep(900);
assert.equal(s.compactions, 0); // not before the idle limit
await sleep(800);
assert.equal(s.compactions, 1);
let rec = s.entries.find((e) => e.type === "compact-at-idle")?.data;
assert.equal(rec?.by, "timer");
assert.equal(rec?.outcome, "compacted");
assert.equal(rec?.tokens, 200_000);
assert.equal(held(), false);
await sleep(1500);
assert.equal(s.compactions, 1); // once per idle period
console.log("ok  idle over the limit: held, compacted once by the timer after the limit, released");
s.shutdown();

// 2. a turn before the limit starts the wait again
s = make();
s.turnEnd();
await sleep(900);
s.turnEnd();
await sleep(900);
assert.equal(s.compactions, 0);
await sleep(700);
assert.equal(s.compactions, 1);
console.log("ok  a later turn re-arms: one compaction, counted from the last turn");
s.shutdown();

// 3. a run is going on (a long tool call) or a message is queued: no compaction under it, the hold ends
for (const busy of [{ idle: false }, { pending: true }]) {
	s = make(busy);
	s.turnEnd();
	await sleep(1700);
	assert.equal(s.compactions, 0);
	assert.equal(s.entries.length, 0);
	assert.equal(held(), false);
	s.shutdown();
}
console.log("ok  not idle or a queued message: nothing happens, the session is released");

// 4. under the token limit: no hold, no compaction, no entry
s = make({ tokens: 90_000 });
s.turnEnd();
assert.equal(held(), false);
await sleep(1700);
assert.equal(s.compactions, 0);
assert.equal(s.entries.length, 0);
console.log("ok  under the token limit: no hold, no compaction, no entry");
s.shutdown();

// 5. the hold lasts until the compaction has started (pi-web keeps a compacting session by itself), then ends
s = make({ compactMs: 700 });
s.turnEnd();
await sleep(1250);
assert.equal(held(), true);
await sleep(250);
assert.equal(s.compactions, 1);
await sleep(900);
assert.equal(held(), false);
assert.equal(s.entries.filter((e) => e.type === "compact-at-idle").length, 1);
console.log("ok  held up to the compaction, released after it; one entry");
s.shutdown();

// 6. a sub-agent's session: never armed
s = make({ tools: ["notify_parent"] });
s.turnEnd();
assert.equal(held(), false);
await sleep(1700);
assert.equal(s.compactions, 0);
console.log("ok  child session: inert");
s.shutdown();

// 7. the session ends before the limit: timer gone, lease released
s = make();
s.turnEnd();
s.shutdown();
assert.equal(providers.length, 0);
await sleep(1700);
assert.equal(s.compactions, 0);
console.log("ok  session shutdown: no timer left, lease released");

// 8. the off switch, in its own process
const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, file], { env: { ...process.env, PI_COMPACT_IDLE_PROACTIVE: "0" }, encoding: "utf8" });
process.stdout.write(child.stdout);
assert.equal(child.status, 0, child.stderr);

console.log("all passed");
