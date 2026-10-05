#!/usr/bin/env bash
# Per-task comparison of ab.sh runs: mean cost, requests, tool errors, final-message lines, pass rate.
#   ab-compare.sh [variant ...]   (default: every variant under /tmp/ab/sessions)
set -u
ROOT=/tmp/ab
variants=("$@")
[ ${#variants[@]} -eq 0 ] && mapfile -t variants < <(ls "$ROOT/sessions")
for v in "${variants[@]}"; do
  for f in "$ROOT"/sessions/"$v"/*.jsonl; do
    jq -s -r --arg v "$v" '
      ([.[] | select(.type=="message" and .message.role=="user")][0].message.content[0].text // "") as $u
      | [.[] | select(.type=="message" and .message.role=="assistant")] as $a
      | [.[] | select(.type=="message" and .message.role=="toolResult" and .message.isError==true)] as $e
      | "\($v)\t\($u[0:14])\t\($a | map(.message.usage.cost.total // 0) | add)\t\($a | length)\t\($e | length)"' "$f"
  done
done | awk -F'\t' '{k=$1"\t"$2; n[k]++; c[k]+=$3; r[k]+=$4; e[k]+=$5; tc[$1]+=$3; tn[$1]++; tr[$1]+=$4; te[$1]+=$5}
  END{
    printf "%-7s %-15s %4s %8s %6s %5s\n", "variant", "task", "n", "$/run", "req", "errs";
    for (k in n) { split(k, p, "\t"); printf "%-7s %-15s %4d %8.3f %6.1f %5.1f\n", p[1], p[2], n[k], c[k]/n[k], r[k]/n[k], e[k]/n[k] | "sort -k2,2 -k1,1" }
    close("sort -k2,2 -k1,1");
    for (v in tn) printf "TOTAL %-7s runs=%d $/run=%.3f req/run=%.1f errs/run=%.2f\n", v, tn[v], tc[v]/tn[v], tr[v]/tn[v], te[v]/tn[v];
  }'
echo
awk -F'\t' '{n[$1]++; p[$1]+=($5=="pass"); l[$1]+=$6} END{for (v in n) printf "%-7s pass %d/%d, final-message lines avg %.1f\n", v, p[v], n[v], l[v]/n[v]}' "$ROOT/results.tsv"
