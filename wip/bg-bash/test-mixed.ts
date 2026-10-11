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
console.log(fail ? `${fail} FAILED` : "all passed");
(globalThis as any).process.exit(fail ? 1 : 0);
