#!/usr/bin/env bash
# run1.sh <model> <thinking> <task-id> <rep>
m=$1 th=$2 id=$3 rep=$4
tag=$(echo "$m" | tr '/' '_')
q=$(jq -r --arg id "$id" '.[] | select(.id==$id) | .q' /tmp/abx/tasks.json)
sd=/tmp/abx/sess/$tag/$id-$rep; mkdir -p "$sd" /tmp/abx/out/$tag
cd /tmp/abx/repo || exit 1
s=$(date +%s.%N)
timeout 900 pi -p --session-dir "$sd" --model "$m" --thinking "$th" --tools read,grep,find,ls --append-system-prompt /tmp/abx/explore-append.md "$q" < /dev/null > /tmp/abx/out/$tag/$id-$rep.txt 2>/tmp/abx/out/$tag/$id-$rep.err
rc=$?
e=$(date +%s.%N)
awk -v s="$s" -v e="$e" -v t="$tag" -v i="$id" -v r="$rep" -v c="$rc" 'BEGIN{printf "%s\t%s\t%s\t%s\t%.1f\n", t, i, r, c, e-s}' >> /tmp/abx/times.tsv
