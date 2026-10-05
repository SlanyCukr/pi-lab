#!/usr/bin/env bash
# Replay every case (or the listed ones) under one append variant.
#   run.sh <variant> <reps> [split: train|test|all] [case-id ...]    (JOBS=4)
# variants/<variant>.md replaces APPEND_SYSTEM.md; outputs go to runs/<variant>/<case>-<rep>.json.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
v=$1 reps=$2 split=${3:-all}; shift 3 2>/dev/null || shift $#
file=$HERE/variants/$v.md
[ -f "$file" ] || { echo "no $file" >&2; exit 2; }
out=$HERE/runs/$v; mkdir -p "$out" /tmp/pieval
ids=$(jq -r --arg s "$split" '.[] | select($s == "all" or .split == $s) | .id' "$HERE/cases.json")
[ $# -gt 0 ] && ids=$(printf '%s\n' "$@")
for id in $ids; do for r in $(seq 1 "$reps"); do
  [ -s "$out/$id-$r.json" ] || echo "$id $r"
done; done | xargs -P "${JOBS:-4}" -L1 bash -c '
  c=$(jq -c --arg id "$0" ".[] | select(.id == \$id)" "'"$HERE"'/cases.json")
  node "'"$HERE"'/replay.mjs" "$c" "'"$file"'" "'"$out"'/$0-$1.json" < /dev/null > "/tmp/pieval/'"$v"'-$0-$1.log" 2>&1 || echo "replay failed: $0 $1" >&2'
ls "$out"/*.json 2>/dev/null | grep -vc grade
