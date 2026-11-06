// Run: PI_EXT_FRESH_DEBUG=1 node test.mjs off   (uses the live ~/.pi/agent/extensions/ext-fresh; "on" also loads this dev copy)
// Expect: A loads the probe; B reloads once (first-install clear) and logs no line for the .jsonl log; D reuses the cache; C, E, F reload after a code file is touched.
const B = process.env.HOME + "/.npm-global/lib/node_modules/@agegr/pi-web/node_modules/@earendil-works/pi-coding-agent/dist/";
const { createAgentSession, SessionManager, DefaultResourceLoader, SettingsManager } = await import(B + "index.js");
const { execSync } = await import("node:child_process");
const withFresh = process.argv[2] === "on";
const extra = ["" + new URL("./probe.ts", import.meta.url).pathname + "", ...(withFresh ? [process.env.HOME + "/pi-lab/wip/ext-fresh/index.ts"] : [])];
const cwd = "/tmp", agentDir = process.env.HOME + "/.pi/agent";
const mk = async (label) => {
  console.error(`-- session ${label}`);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, additionalExtensionPaths: extra });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory(cwd), cwd, resourceLoader, settingsManager });
  return session;
};
await mk("A");
await new Promise((r) => setTimeout(r, 300));
execSync("touch " + process.env.HOME + "/.pi/agent/extensions/cache-ttl/divergence.jsonl");
await new Promise((r) => setTimeout(r, 300));
await mk("B (after touching cache-ttl/divergence.jsonl, a log)");
execSync("touch " + process.env.HOME + "/.pi/agent/extensions/lsp-exit/index.ts");
await new Promise((r) => setTimeout(r, 300));
await mk("C (after touching lsp-exit/index.ts)");
await mk("D (nothing changed since C)");
execSync("touch " + process.env.HOME + "/.pi/agent/extensions/ext-fresh/index.ts " + process.env.HOME + "/.pi/agent/extensions/lsp-exit/index.ts");
await new Promise((r) => setTimeout(r, 300));
await mk("E (ext-fresh itself and lsp-exit touched)");
execSync("touch " + process.env.HOME + "/.pi/agent/extensions/lsp-exit/index.ts");
await new Promise((r) => setTimeout(r, 300));
await mk("F (lsp-exit touched: expect one 'cache cleared' line, not two)");
process.exit(0);
