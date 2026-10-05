import { readFileSync, readdirSync } from 'node:fs';
const { classifyEnding } = await import(process.env.HOME + '/.pi/agent/extensions/auto-continue/index.ts');
const cases = Object.fromEntries(JSON.parse(readFileSync('cases.json', 'utf8')).map((c) => [c.id, c]));
const tally = {};
for (const v of process.argv.slice(2)) for (const f of readdirSync(`runs/${v}`)) {
  if (!f.endsWith('.grade.json')) continue;
  const g = JSON.parse(readFileSync(`runs/${v}/${f}`, 'utf8'));
  const o = JSON.parse(readFileSync(`runs/${v}/${f.replace('.grade.json', '.json')}`, 'utf8'));
  if ((o.toolCalls ?? []).length) continue; // only text-only endings end a turn
  const k = `${g.kind} ${g.verdict} -> ${classifyEnding(o.text ?? '')}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
console.log(Object.entries(tally).sort().map(([k, n]) => `${n.toString().padStart(4)}  ${k}`).join('\n'));
