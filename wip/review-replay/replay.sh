#!/bin/bash
# Re-run the find-gaps review gate on past commit ranges with another reviewer model, to compare what each catches.
# usage: replay.sh <model> <thinking> <cases-file> [out-dir]
#   replay.sh anthropic/claude-opus-5-5 high cases.txt     # the baseline arm: the same model again
#   replay.sh openai/gpt-6.2-sol high cases.txt            # the candidate
# cases-file: one reviewed head sha per line (`#` comments), from pick-cases.py. For each head the script takes the
# base from the loop's verdict file, the original prompt from the review session, and runs the reviewer agent
# (~/.pi/agent/agents/reviewer.md: tools and prompt; model and thinking from the arguments) in a checkout of that
# head. Output: <out-dir>/<head>.txt (answer with a header) and the session under <out-dir>/sessions/<head>/.
# A finished case is skipped, so the run can be stopped and started again. Then: compare.py <cases-file> <out-dir>...
#
# What differs from the original review, for every arm alike (so compare the arms with each other first):
# - the checkout has no node_modules or Python environment, so the reviewer reads and reasons but cannot re-run tests;
# - ledger.md and done.md are today's copies (a done finding's row has moved to done.md);
# - the loop's state is only read: the checkout is a worktree of a `git clone --shared` under $REPLAY_ROOT.
set -euo pipefail
model=$1 thinking=$2 cases=$3
S=${FG_STATE:-$HOME/projects/media_monitoring.find-gaps/.find-gaps}
LIVE=$(dirname "$S")
R=${REPLAY_ROOT:-/tmp/review-replay}
out=${4:-$HOME/pi-lab/reviews/review-replay/${model//\//_}-$thinking}
agent=${REPLAY_AGENT:-$HOME/.pi/agent/agents/reviewer.md}
mkdir -p "$R" "$out/sessions"
[ -d "$R/repo" ] || git clone -q --shared --no-checkout "$LIVE" "$R/repo"
tools=$(awk -F': *' '/^tools:/{print $2; exit}' "$agent" | tr -d ' ')
body=$R/reviewer-body.md
awk 'n >= 2; /^---$/ {n++}' "$agent" > "$body"

grep -vE '^\s*(#|$)' "$cases" | while read -r head _; do
  v=$S/verdicts/$head.txt
  [ -f "$v" ] || { echo "$head: no verdict file, skipped"; continue; }
  [ -s "$out/$head.txt" ] && { echo "${head:0:9}: done already"; continue; }
  base=$(sed -n 's/^base: //p' "$v" | head -1)
  src=$(grep -l -m1 -F "commit(s) $base..$head" "$S"/sessions/reviews/*/*.jsonl 2>/dev/null | head -1 || true)
  [ -n "$src" ] || { echo "${head:0:9}: no review session with its prompt, skipped"; continue; }
  wt=$R/wt-${head:0:12}
  git -C "$R/repo" worktree add -q --detach "$wt" "$head" 2>/dev/null || { echo "${head:0:9}: cannot check out, skipped"; continue; }
  mkdir -p "$wt/.find-gaps"
  cp "$S/ledger.md" "$S/done.md" "$wt/.find-gaps/"
  [ -d "$S/specs" ] && cp -r "$S/specs" "$wt/.find-gaps/specs"
  # the first user message of the original review, with the live worktree's path replaced by the checkout's
  prompt=$(jq -rs --arg live "$LIVE" --arg wt "$wt" '[.[] | select(.type == "message" and .message.role == "user")][0].message.content
    | (if type == "string" then . else map(.text // "") | join("") end) | gsub($live; $wt)' "$src")
  t0=$(date +%s)
  ( cd "$wt" && PI_CACHE_TTL_MAIN=5m timeout 1h pi -p --model "$model" --thinking "$thinking" --tools "$tools" \
      --append-system-prompt "$body" --session-dir "$out/sessions/$head" "$prompt" < /dev/null > "$out/$head.stdout" 2> "$out/$head.err" ) || true
  f=$(find "$out/sessions/$head" -name '*.jsonl' -print -quit)
  answer="" cost=0 used=""
  if [ -n "$f" ]; then
    # the last assistant text that holds a verdict, else the last text (a background wake-up can follow the answer)
    answer=$(jq -rs '[.[] | select(.type == "message" and .message.role == "assistant") | (.message.content // []) | map(select(.type == "text") | .text) | join("\n") | select(test("\\S"))]
      | ([.[] | select(test("(^|\n)[*# -]*VERDICT"; "i"))] | last) // (last // "")' "$f")
    cost=$(jq -rs '[.[] | select(.type == "message" and .message.role == "assistant") | .message.usage.cost.total // 0] | add // 0' "$f")
    used=$(jq -rs '[.[] | select(.type == "message" and .message.role == "assistant") | .message.model // empty] | unique | join(",")' "$f")
  fi
  { echo "base: $base"; echo "head: $head"; echo "by: $model ($thinking; answered by: ${used:-none})"; echo "secs: $(( $(date +%s) - t0 ))"; echo "cost: $cost"; echo
    printf '%s\n' "${answer:-NO ANSWER: $(grep -v '^Warning: Extension package ' "$out/$head.err" | tail -2 | tr '\n' ' ')}"; } > "$out/$head.txt"
  git -C "$R/repo" worktree remove --force "$wt"
  echo "${head:0:9}: $(grep -m1 -ioE 'VERDICT: *(pass|fail)|NO ANSWER.*' "$out/$head.txt" | cut -c1-120) in $(( $(date +%s) - t0 )) s, \$$cost"
done
