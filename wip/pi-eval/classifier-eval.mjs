// Score an auto-continue classifier against the judge's verdicts on text-only endings.
//   node classifier-eval.mjs <index.ts> [split]
import { readFileSync, readdirSync } from 'node:fs';
const [mod, split = 'all'] = process.argv.slice(2);
const { classifyEnding } = await import(mod);
const cases = Object.fromEntries(JSON.parse(readFileSync('cases.json', 'utf8')).map((c) => [c.id, c]));
const t = {};
for (const v of readdirSync('runs')) for (const f of readdirSync(`runs/${v}`)) {
  if (!f.endsWith('.grade.json')) continue;
  const g = JSON.parse(readFileSync(`runs/${v}/${f}`, 'utf8'));
  if (split !== 'all' && cases[g.id].split !== split) continue;
  const o = JSON.parse(readFileSync(`runs/${v}/${f.replace('.grade.json', '.json')}`, 'utf8'));
  if ((o.toolCalls ?? []).length) continue;
  const k = `${g.verdict}->${classifyEnding(o.text ?? '')}`;
  t[k] = (t[k] ?? 0) + 1;
}
const fail = (t['FAIL->offer'] ?? 0) + (t['FAIL->none'] ?? 0) + (t['FAIL->user-only'] ?? 0);
console.log(split, JSON.stringify(t), `catch ${t['FAIL->offer'] ?? 0}/${fail}, false continue ${t['PASS->offer'] ?? 0}`);
