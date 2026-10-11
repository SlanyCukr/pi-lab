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
// the forms the loop sent (2026-10-01..10)
same("pi-bg-wait bg1; date", { ops: [w("bg1")], rest: "date" });
same("pi-bg-wait bg1; wc -l /tmp/x.log; date", { ops: [w("bg1")], rest: "wc -l /tmp/x.log; date" });
same("tools/zai-quota.sh; pi-bg-wait bg2", { ops: [w("bg2")], rest: "tools/zai-quota.sh" });
same("pi-bg-wait bg1 >/dev/null; cd /r && source .find-gaps/env.sh; rm -f a b", { ops: [w("bg1")], rest: "cd /r && source .find-gaps/env.sh; rm -f a b" });
same("pi-bg-wait bg1 2>&1 | tail -3; cd /r/backend; grep -c x f", { ops: [w("bg1")], rest: "cd /r/backend; grep -c x f" });
same("cd /r && pi-bg-wait bg1 && git status --short", { ops: [w("bg1")], rest: "cd /r && git status --short" });
same("cd /r && git status --short && pi-bg-wait bg2 && pi-bg-stop bg1", { ops: [w("bg2"), s("bg1")], rest: "cd /r && git status --short" });
same("cd /r && pi-bg-wait bg2 && pi-bg-wait bg6 && git status --short", { ops: [w("bg2"), w("bg6")], rest: "cd /r && git status --short" });
same("cd /r && kill 2802752 && pi-bg-stop bg4 && git diff --quiet && git status --short", { ops: [s("bg4")], rest: "cd /r && kill 2802752 && git diff --quiet && git status --short" });
same("cd /r && pi-bg-stop bg10 && cd frontend && npm run test", { ops: [s("bg10")], rest: "cd /r && cd frontend && npm run test" });
same("cd /r && source .find-gaps/env.sh && pi-bg-wait bg1", { ops: [w("bg1")], rest: "" });
same('pi-bg-wait bg1; python3 -c "\nimport json; print(1); x=2\n"', { ops: [w("bg1")], rest: 'python3 -c "\nimport json; print(1); x=2\n"' });
same("pi-bg-wait 3 && pi-bg-stop loop2; ls", { ops: [w("bg3"), s("loop2")], rest: "ls" });
same("pi-bg-wait bg1\ntail -3 /tmp/l", { ops: [w("bg1")], rest: "tail -3 /tmp/l" });
// left to the refusal: fallbacks, pipes into or out of a wait, background, heredocs, loop waits, subshells
same("pi-bg-wait bg1 2>/dev/null || tail -n 5 /tmp/l", undefined);
same("pi-bg-wait bg1 | grep x", undefined);
same("echo bg1 | pi-bg-wait bg1", undefined);
same("pi-bg-wait bg1 & date", undefined);
same("cat <<'EOF' > f\npi-bg-wait bg1\nEOF\npi-bg-wait bg1", undefined);
same("pi-bg-wait loop1; date", undefined);
same("(cd /r && pi-bg-wait bg1); date", undefined);
// only quoted text: bash runs it as it is
same("grep pi-bg-wait index.ts; echo 'x && pi-bg-wait bg1'", "plain");
same('cd /tmp && pi -p "run `pi-bg-stop bg1 && pi-bg-wait bg7; ls`" < /dev/null', "plain");
same('git commit -m "fix; pi-bg-wait bg2 now waits"', "plain");
same("date", "plain");
// a quoted mention next to a real wait: the real one is lifted, the quote stays
same("pi-bg-wait bg1; echo 'then pi-bg-wait bg2'", { ops: [w("bg1")], rest: "echo 'then pi-bg-wait bg2'" });
console.log(fail ? `${fail} FAILED` : "all passed");
(globalThis as any).process.exit(fail ? 1 : 0);
