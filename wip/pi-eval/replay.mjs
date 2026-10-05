// Replay one decision point of a real pi session and sample the next assistant message.
//
//   node replay.mjs <case-json> <append-file|live> <out.json>
//
// The context is the case's session cut at `leaf` (its ancestor chain only, so abandoned branches and
// later entries are gone), loaded with the user's real setup: extensions, skills, AGENTS.md files, tools.
// `append-file` replaces APPEND_SYSTEM.md (the text under test); `live` keeps the installed one.
// Safety: an inline extension blocks every tool call, and the run is aborted at the first assistant
// message, so nothing the sampled message asks for is executed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const PI = join(homedir(), '.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
const { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager } = await import(PI);

const [caseJson, appendArg, outPath] = process.argv.slice(2);
const c = JSON.parse(caseJson);
const MODEL = process.env.EVAL_MODEL ?? 'anthropic/claude-opus-5-5';
const THINK = process.env.EVAL_THINKING ?? 'high';

// 1. the context: header + the leaf's ancestor chain, oldest first
const lines = readFileSync(c.session, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(lines.filter((e) => e.id).map((e) => [e.id, e]));
const chain = [];
for (let e = byId.get(c.leaf); e; e = e.parentId ? byId.get(e.parentId) : null) chain.push(e);
chain.reverse();
const header = lines.find((e) => e.type === 'session');
// Auto-continue replay: EVAL_PREFIX=<first sample json> appends that sampled message plus the
// EVAL_NUDGE custom message, so the new sample is the turn after an auto-continue nudge.
if (process.env.EVAL_PREFIX) {
  const first = JSON.parse(readFileSync(process.env.EVAL_PREFIX, 'utf8'));
  const tpl = [...chain].reverse().find((e) => e.type === 'message' && e.message?.role === 'assistant');
  const ts = new Date().toISOString();
  const a = { type: 'message', id: 'evalA0001', parentId: chain.at(-1).id, timestamp: ts,
    message: { ...(tpl?.message ?? { role: 'assistant' }), content: [{ type: 'text', text: first.text }], stopReason: 'stop', errorMessage: undefined, timestamp: Date.now() } };
  const n = { type: 'custom_message', id: 'evalN0001', parentId: a.id, timestamp: ts, customType: 'auto-continue', content: process.env.EVAL_NUDGE, display: true };
  chain.push(a, n);
}
const cut = join('/tmp/pieval/sessions', `${c.id}-${process.pid}.jsonl`);
mkdirSync(dirname(cut), { recursive: true });
writeFileSync(cut, [header, ...chain].map((e) => JSON.stringify(e)).join('\n') + '\n');

// 2. the setup under test
const agentDir = getAgentDir();
const block = (pi) => {
  pi.on('tool_call', async () => ({ block: true, reason: 'eval replay: tools are not executed' }));
};
const loader = new DefaultResourceLoader({
  cwd: c.cwd,
  agentDir,
  extensionFactories: [block],
  ...(appendArg && appendArg !== 'live' ? { appendSystemPromptOverride: () => [readFileSync(appendArg, 'utf8')] } : {}),
});
await loader.reload();
const runtime = await ModelRuntime.create();
const [prov, ...rest] = MODEL.split('/');
const model = runtime.getModel(prov, rest.join('/'));
if (!model) throw new Error(`no model ${MODEL}`);
const { session } = await createAgentSession({
  cwd: c.cwd, agentDir, resourceLoader: loader, sessionManager: SessionManager.open(cut), modelRuntime: runtime, model, thinkingLevel: THINK,
});
await session.bindExtensions({ mode: 'print' }).catch(() => {});

// 3. sample: stop at the first finished assistant message
let result = null;
const done = new Promise((resolve) => {
  session.subscribe((ev) => {
    if (ev.type === 'message_end' && ev.message?.role === 'assistant' && !result) {
      const m = ev.message;
      result = {
        text: (m.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n'),
        toolCalls: (m.content ?? []).filter((x) => x.type === 'toolCall').map((x) => ({ name: x.name, args: x.arguments })),
        stopReason: m.stopReason, error: m.errorMessage ?? null, usage: m.usage ?? null,
      };
      resolve();
    }
  });
});
const t0 = Date.now();
const run = session.agent.continue().catch((e) => { if (!result) result = { error: String(e) }; });
await Promise.race([done, run, new Promise((r) => setTimeout(r, 600_000))]);
session.agent.abort();
await session.abort().catch(() => {});
writeFileSync(outPath, JSON.stringify({ id: c.id, kind: c.kind, append: appendArg, model: MODEL, thinking: THINK, secs: (Date.now() - t0) / 1000,
  systemPromptChars: session.agent.state?.systemPrompt?.length ?? null, ...result }, null, 1));
session.dispose();
process.exit(0);
