// Run: node wip/lens-replay/test.mjs [path/to/index.ts]   (Node 24 strips the types)
// Unit test of collect() and replay() on Anthropic-shaped message lists. The real check is two pi processes on one
// session (reviews/2026-11-13.md): the second request must repeat the first one's messages and read its cache.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const file = process.argv[2] ?? new URL("./index.ts", import.meta.url).pathname;
const { collect, replay, keyOf, anchors } = await import(pathToFileURL(file).href);

const SNAP = "\n\n[pi-lens snapshot: these findings are as of this turn and repeat unchanged in later requests; lens_diagnostics shows the current state.]";
const lens = (text) => ({ role: "user", content: `[pi-lens automated check — not a user request] ${text}${SNAP}` });
const result = (id, text = "ok") => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: false }] });
const call = (id) => ({ role: "assistant", content: [{ type: "tool_use", id, name: "Edit", input: {} }] });
const sys = () => ({ role: "system", content: [], output_config: { effort: "low" } });
const prompt = (text) => ({ role: "user", content: [{ type: "text", text }] });

// the first process: two findings after t2 (in order), one after t3
// (one of them a group: a message without the label, sent together with one that carries it)
const part = { role: "user", content: "[pi-lens automated check — not a user request] first of a group" };
const first = [prompt("go"), sys(), call("t1"), result("t1"), sys(), call("t2"), result("t2"), lens("A"), lens("B"), sys(), call("t3"), result("t3"), part, lens("C"), sys()];
// the same history as a new process builds it from the session file, plus the answer and a new prompt
const bare = first.filter((m) => !(typeof m.content === "string" && m.content.startsWith("[pi-lens ")));
const letters = (list) => list.filter((m) => typeof m.content === "string").map((m) => /request\] (\w)/.exec(m.content)[1]);
const resumed = [...bare, { role: "assistant", content: [{ type: "text", text: "done" }] }, prompt("again"), sys()];
let n = 0;
const ok = (name, fn) => {
	fn();
	n++;
	console.log(`ok ${n} ${name}`);
};

const kept = collect(first);
ok("collect: every retained message with its tool result and position", () => {
	assert.deepEqual(kept.map(keyOf), ["t2#0", "t2#1", "t3#0", "t3#1"]);
	assert.equal(kept[2].content, part.content);
	assert.equal(kept[1].content, lens("B").content);
});
ok("replay: a new process's request repeats the first process's messages", () => {
	const out = replay(resumed, kept);
	assert.deepEqual(out.slice(0, first.length), first);
	assert.deepEqual(out.slice(first.length), resumed.slice(bare.length));
});
ok("replay: nothing to do when pi-lens sent them itself (same process)", () => {
	assert.equal(replay(first, kept), undefined);
	assert.equal(replay(resumed, []), undefined);
});
ok("replay: only the missing one is added, before the ones present", () => {
	const partial = first.filter((m) => m.content !== lens("A").content);
	const out = replay(partial, kept);
	assert.equal(out.length, first.length);
	assert.deepEqual(letters(out), ["A", "B", "f", "C"]);
});
ok("replay: a tool result that left the request (compaction) gets nothing", () => {
	const compacted = [prompt("summary"), sys(), call("t3"), result("t3"), sys()];
	const out = replay(compacted, kept);
	assert.equal(out.length, compacted.length + 2);
	assert.equal(out[5].content, lens("C").content);
	assert.equal(replay([prompt("summary"), sys()], kept), undefined);
});
ok("collect: a one-request finding (no group member has the label), a prompt that quotes the label, and a finding after an assistant message are left out", () => {
	const once = { role: "user", content: "[pi-lens automated check — not a user request] seen once" };
	const quoted = prompt("the text [pi-lens snapshot: appears in my prompt");
	assert.deepEqual(collect([prompt("go"), call("t1"), result("t1"), once, quoted, sys()]), []);
	assert.deepEqual(collect([call("t1"), result("t1"), lens("kept"), once, sys()]).map(keyOf), ["t1#0"]);
	assert.deepEqual(collect([prompt("go"), { role: "assistant", content: [{ type: "text", text: "hi" }] }, lens("no tool result before")]), []);
});
ok("collect: a finding sent as text blocks (cache breakpoint on it) is the same message", () => {
	const blocks = { role: "user", content: [{ type: "text", text: lens("A").content, cache_control: { type: "ephemeral" } }] };
	assert.deepEqual(collect([call("t2"), result("t2"), blocks]), [{ after: "t2", n: 0, content: lens("A").content }]);
	assert.equal(replay([call("t2"), result("t2"), blocks], kept.slice(0, 1)), undefined);
});
ok("replay: several tool results in one message anchor on the last one", () => {
	const two = { role: "user", content: [{ type: "tool_result", tool_use_id: "t8", content: "x" }, { type: "tool_result", tool_use_id: "t9", content: "y" }] };
	const k = collect([call("t9"), two, lens("D")]);
	assert.deepEqual(k.map(keyOf), ["t9#0"]);
	assert.equal(replay([call("t9"), two, sys()], k)[2].content, lens("D").content);
});
// 2026-11-14: bg-bash adds a background command's result after the turn's tool results; the finding follows that text
const bg = (text) => ({ role: "user", content: [{ type: "text", text }] });
const live = [prompt("go"), sys(), call("t11"), result("t11"), bg("Background command bg1 finished: exit code 0"), lens("E"), sys(), call("t12"), result("t12"), bg("same text"), bg("same text"), lens("F"), sys()];
const fromFileLive = live.filter((m) => !(typeof m.content === "string" && m.content.startsWith("[pi-lens ")));
ok("collect + replay: a finding after a text message (a bg-bash result) is recorded and put back there", () => {
	const k = collect(live);
	assert.equal(k.length, 2);
	assert.match(k[0].after, /^text:[0-9a-f]{16}:0$/);
	assert.match(k[1].after, /^text:[0-9a-f]{16}:1$/); // the second of two messages with the same text
	const out = replay([...fromFileLive, { role: "assistant", content: [{ type: "text", text: "done" }] }, prompt("again"), sys()], k);
	assert.deepEqual(out.slice(0, live.length), live);
	assert.equal(replay(live, k), undefined);
});
ok("replay: entries of both kinds (tool result ids as recorded before 2026-11-14, text anchors) in one request", () => {
	const both = [...kept, ...collect(live)];
	const request = [...first.slice(0, -1), ...live.slice(1)];
	const bareRequest = request.filter((m) => !(typeof m.content === "string" && m.content.startsWith("[pi-lens ")));
	assert.deepEqual(replay(bareRequest, both), request);
});
ok("collect: a text anchor is the message itself, not a pi-lens message; a prompt with an image is no anchor", () => {
	assert.deepEqual(anchors([lens("A"), prompt("x"), prompt("x"), { role: "user", content: [{ type: "image", source: {} }, { type: "text", text: "x" }] }]).map((a) => a?.split(":").slice(0, 3).length ?? 0), [0, 3, 3, 0]);
	assert.deepEqual(collect([{ role: "user", content: [{ type: "image", source: {} }] }, lens("after an image")]), []);
});
console.log(`${n} passed`);
