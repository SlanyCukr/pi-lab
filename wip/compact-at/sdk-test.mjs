import { createAgentSession, DefaultResourceLoader, SessionManager, getAgentDir } from "/home/slanycukr/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import ext from "./index.ts";
const cwd = "/home/slanycukr/pi-lab/lens-fixture";
const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), extensionFactories: [ext] });
await loader.reload();
const { session } = await createAgentSession({ cwd, agentDir: getAgentDir(), resourceLoader: loader, sessionManager: SessionManager.inMemory(), tools: ["read", "bash"] });
const reg = session.modelRegistry; const luna = reg?.find?.("openai-codex","gpt-5.6-luna"); if (luna) await session.setModel(luna); console.error("[test] model:", session.model?.id, "registry:", !!reg);
let settled; const done = new Promise((r) => (settled = r));
let finalText = ""; let timer;
session.subscribe((ev) => {
  if (!["message_update","tool_execution_update"].includes(ev.type)) console.error("[test] ev:", ev.type, ev.type==="message_end"? JSON.stringify({role:ev.message?.role, stop:ev.message?.stopReason, err:ev.message?.errorMessage}).slice(0,300):"");
  if (ev.type?.includes("compact")) console.error("[test] event:", ev.type, JSON.stringify({ reason: ev.reason, aborted: ev.aborted, err: ev.errorMessage }));
  if (ev.type === "tool_execution_start") console.error("[test] tool:", ev.toolName, JSON.stringify(ev.args).slice(0, 70));
  if (ev.type === "message_end" && ev.message?.role === "assistant") {
    const t = (ev.message.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
    if (t) { finalText = t; console.error("[test] text:", t.slice(0, 160).replace(/\n/g, " | ")); }
  }
  if (ev.type === "agent_end") { clearTimeout(timer); timer = setTimeout(settled, 20000); } // wait: a continue prompt may start a new run
  if (ev.type === "agent_start") clearTimeout(timer);
});
session.prompt("Do these steps strictly one tool call per turn, in order: 1) read src/math.ts 2) read src/util.py 3) read src/main.ts 4) run bash: wc -l src/math.ts src/util.py src/main.ts. Then reply with the three line counts on one line prefixed FINAL:").catch((e) => console.error("[test] prompt rejected:", e?.message));
await done;
console.error("[test] RESULT finalHasFINAL:", /FINAL:/.test(finalText), "ctx:", JSON.stringify(session.getContextUsage?.()));
session.dispose(); process.exit(0);
