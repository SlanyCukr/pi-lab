#!/usr/bin/env bash
# Auto-continue replay: for every text-only sample of <variant> that the classifier in <index.ts> would
# continue, sample the next turn after the nudge. Outputs go to runs-ac/<variant>/ (graded by grade.py).
#   ac-run.sh <variant> <index.ts>      (JOBS=4; EVAL_NUDGE overrides the nudge text)
set -u
HERE=$(cd "$(dirname "$0")" && pwd); v=$1 mod=$2
out=$HERE/runs-ac/$v; mkdir -p "$out" /tmp/pieval
export EVAL_NUDGE=${EVAL_NUDGE:-"Auto mode: go with your pick and do it now. Stop only for a production write, an irreversible or destructive action, spending money, or input only the user has; then end with that one decision."}
cd "$HERE" && node --input-type=module -e "
import { readFileSync, readdirSync } from 'node:fs';
const { classifyEnding } = await import('$mod');
for (const f of readdirSync('runs/$v')) {
  if (f.endsWith('.grade.json')) continue;
  const o = JSON.parse(readFileSync('runs/$v/' + f, 'utf8'));
  if (!(o.toolCalls ?? []).length && classifyEnding(o.text ?? '') === 'offer') console.log(o.id, f.replace('.json', ''));
}" 2>/dev/null | while read -r id name; do [ -s "$out/$name.json" ] || echo "$id $name"; done |
xargs -P "${JOBS:-4}" -L1 bash -c '
  c=$(jq -c --arg id "$0" ".[] | select(.id == \$id)" "'"$HERE"'/cases.json")
  EVAL_PREFIX="'"$HERE"'/runs/'"$v"'/$1.json" node "'"$HERE"'/replay.mjs" "$c" "'"$HERE"'/variants/'"$v"'.md" "'"$out"'/$1.json" < /dev/null > "/tmp/pieval/ac-$1.log" 2>&1 || echo "failed: $1" >&2'
ls "$out" | grep -vc grade
