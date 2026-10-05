#!/bin/bash
# Usage: rpc-run.sh <outfile> <hold-seconds> <prompt> [extra pi args...] - one prompt over RPC, stdin held open so background jobs can report back.
out=$1; hold=$2; msg=$3; shift 3
req=$(jq -cn --arg m "$msg" '{type:"prompt",message:$m}')
( echo "$req"; sleep "$hold" ) | timeout $((hold+30)) pi --no-session --mode rpc -xt advisor "$@" > "$out" 2> "${out%.jsonl}.err"
echo "rc=$?"
