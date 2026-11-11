// Run: node test-mixed.ts (Node >= 23 strips the types)
import { splitMixed } from "./mixed.ts";
let fail = 0;
const same = (cmd: string, want: unknown) => {
	const got = JSON.stringify(splitMixed(cmd));
	const ok = got === JSON.stringify(want);
	console.log(`${ok ? "ok  " : "FAIL"} ${cmd.replace(/\n/g, "\\n")}${ok ? "" : `\n     got  ${got}\n     want ${JSON.stringify(want)}`}`);
	if (!ok) fail++;
};
const w = (id: string) => ({ kind: "wait", id });
const s = (id: string) => ({ kind: "stop", id });
const m = (o: { setup?: string; before?: string; ops: unknown[]; joins: string[]; after?: string }) => ({
	setup: o.setup ?? "",
	before: o.before ?? "",
	ops: o.ops,
	joins: o.joins,
	after: o.after ?? "",
});
// lead shape: [setup] OPS [joiner REST]; forms the loop sent (2026-10-01..10)
same("pi-bg-wait bg1; date", m({ ops: [w("bg1")], joins: [";"], after: "date" }));
same("pi-bg-wait bg1; wc -l /tmp/x.log; date", m({ ops: [w("bg1")], joins: [";"], after: "wc -l /tmp/x.log; date" }));
same("pi-bg-wait bg1 >/dev/null; cd /r && source .find-gaps/env.sh; rm -f a b", m({ ops: [w("bg1")], joins: [";"], after: "cd /r && source .find-gaps/env.sh; rm -f a b" }));
same("pi-bg-wait bg1 2>&1 | tail -3; cd /r/backend; grep -c x f", m({ ops: [w("bg1")], joins: [";"], after: "cd /r/backend; grep -c x f" }));
same("cd /r && pi-bg-wait bg1 && git status --short", m({ setup: "cd /r", ops: [w("bg1")], joins: ["&&"], after: "cd /r && git status --short" }));
same("cd /r && pi-bg-wait bg2 && pi-bg-wait bg6 && git status --short", m({ setup: "cd /r", ops: [w("bg2"), w("bg6")], joins: ["&&", "&&"], after: "cd /r && git status --short" }));
same("cd /r && pi-bg-stop bg10 && cd frontend && npm run test", m({ setup: "cd /r", ops: [s("bg10")], joins: ["&&"], after: "cd /r && cd frontend && npm run test" }));
same('pi-bg-wait bg1; python3 -c "\nimport json; print(1); x=2\n"', m({ ops: [w("bg1")], joins: [";"], after: 'python3 -c "\nimport json; print(1); x=2\n"' }));
same("pi-bg-stop bg1 && pi-bg-wait bg7; ls /x", m({ ops: [s("bg1"), w("bg7")], joins: ["&&", ";"], after: "ls /x" }));
same("pi-bg-wait 3 && pi-bg-stop loop2; ls", m({ ops: [w("bg3"), s("loop2")], joins: ["&&", ";"], after: "ls" }));
same("pi-bg-wait bg1\ntail -3 /tmp/l\n", m({ ops: [w("bg1")], joins: [";"], after: "tail -3 /tmp/l" }));
// trail shape: REST joiner OPS (the rest runs first)
same("tools/zai-quota.sh; pi-bg-wait bg2", m({ before: "tools/zai-quota.sh", ops: [w("bg2")], joins: [";"] }));
same("cd /r && git status --short && pi-bg-wait bg2 && pi-bg-stop bg1", m({ before: "cd /r && git status --short", ops: [w("bg2"), s("bg1")], joins: ["&&", "&&"] }));
same("cd /r && source .find-gaps/env.sh && pi-bg-wait bg1", m({ before: "cd /r && source .find-gaps/env.sh", ops: [w("bg1")], joins: ["&&"] }));
// refused: a wait or stop between two commands (order or && would change), fallbacks, pipes into or out of one,
// background, heredocs, loop waits, subshells, writing redirections
same("cd /r && kill 2802752 && pi-bg-stop bg4 && git diff --quiet", undefined);
same("check-condition && pi-bg-stop bg1 && echo stopped", undefined);
same("pi-bg-wait bg1 2>/dev/null || tail -n 5 /tmp/l", undefined);
same("pi-bg-wait bg1 | grep x", undefined);
same("echo bg1 | pi-bg-wait bg1", undefined);
same("pi-bg-wait bg1 & date", undefined);
same("cat <<'EOF' > f\npi-bg-wait bg1\nEOF\npi-bg-wait bg1", undefined);
same("pi-bg-wait loop1; date", undefined);
same("(cd /r && pi-bg-wait bg1); date", undefined);
same("pi-bg-wait bg1 > /tmp/out.txt; cat /tmp/out.txt", undefined);
// only quoted text: bash runs it as it is
same("grep pi-bg-wait index.ts; echo 'x && pi-bg-wait bg1'", "plain");
same('cd /tmp && pi -p "run `pi-bg-stop bg1 && pi-bg-wait bg7; ls`" < /dev/null', "plain");
same('git commit -m "fix; pi-bg-wait bg2 now waits"', "plain");
same("date", "plain");
// a quoted mention next to a real wait: the real one is taken, the quote stays
same("pi-bg-wait bg1; echo 'then pi-bg-wait bg2'", m({ ops: [w("bg1")], joins: [";"], after: "echo 'then pi-bg-wait bg2'" }));

// Mid-run delivery (index.ts, turn_end): a background result that comes in while a run goes on joins that run at its
// next turn boundary, not only after agent_end. Loads index.ts with pi's real packages linked into a temp folder.
{
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const { execFileSync } = await import("node:child_process");
	const here = path.dirname(new URL(import.meta.url).pathname);
	const piBin = fs.realpathSync(execFileSync("bash", ["-lc", "command -v pi"], { encoding: "utf8" }).trim());
	const piPkg = piBin.slice(0, piBin.indexOf("/pi-coding-agent/") + "/pi-coding-agent".length);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-bash-test-"));
	fs.mkdirSync(path.join(dir, "node_modules", "@earendil-works"), { recursive: true });
	fs.symlinkSync(piPkg, path.join(dir, "node_modules", "@earendil-works", "pi-coding-agent"));
	fs.symlinkSync(path.join(piPkg, "node_modules", "typebox"), path.join(dir, "node_modules", "typebox"));
	for (const f of ["index.ts", "loop.ts", "mixed.ts"]) fs.copyFileSync(path.join(here, f), path.join(dir, f));
	const mod = await import(path.join(dir, "index.ts"));
	const handlers: Record<string, Function[]> = {};
	let tool: any;
	const sent: string[] = [];
	const pi: any = {
		on: (ev: string, fn: Function) => (handlers[ev] ??= []).push(fn),
		events: { on: () => {}, emit: () => {} },
		registerTool: (t: any) => (tool = t),
		registerCommand: () => {},
		getActiveTools: () => ["bash", "read"],
		sendMessage: (m: any) => sent.push(m.content),
		sendUserMessage: () => {},
		appendEntry: () => {},
	};
	mod.default(pi);
	const ctx: any = { cwd: dir, hasUI: false, isIdle: () => false, sessionManager: { getSessionId: () => "t", getSessionFile: () => undefined } };
	const fire = (ev: string, e: any = {}) => (handlers[ev] ?? []).map((fn) => fn({ type: ev, ...e }, ctx)).find((r) => r !== undefined);
	const check = (name: string, ok: boolean, info = "") => {
		console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${info}`}`);
		if (!ok) fail++;
	};
	fire("session_start", { reason: "startup" });
	fire("before_agent_start");
	fire("agent_start");
	const started = await tool.execute("c1", { command: "echo bgdone-42", background: true }, undefined, () => {}, ctx);
	check("background start", /Started in the background as bg1/.test(started.content[0].text), JSON.stringify(started.content));
	await new Promise((r) => setTimeout(r, 1500)); // the command exits while the run goes on
	check("no message while the run goes on", sent.length === 0, JSON.stringify(sent));
	const other = { type: "custom", customType: "x", data: {} };
	const r: any = fire("turn_end", { outcome: "completed", entries: [other], continue: false, toolResults: [] });
	const entry = r?.entries?.[1];
	check(
		"result joins the run at turn_end",
		r?.continue === true && r.entries[0] === other && entry?.type === "custom_message" && /bg1 finished: exit code 0[\s\S]*bgdone-42/.test(entry.content),
		JSON.stringify(r),
	);
	check("nothing left for the next boundary", fire("turn_end", { outcome: "completed", entries: [] }) === undefined);
	fire("agent_end");
	await new Promise((r) => setTimeout(r, 50));
	check("not sent again at agent_end", sent.length === 0, JSON.stringify(sent));
	fire("session_shutdown");
	fs.rmSync(dir, { recursive: true, force: true });
}
console.log(fail ? `${fail} FAILED` : "all passed");
(globalThis as any).process.exit(fail ? 1 : 0);
