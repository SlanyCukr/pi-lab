#!/usr/bin/env bash
# A/B runner for harness changes. Real model calls: costs money.
#
#   ab.sh <variant> [reps] [task-id...]
#   variants: base (live setup), lean (--append-system-prompt APPEND_SYSTEM.lean.md),
#             trim (loads wip/tool-trim), notrim (PI_TOOL_TRIM=0)
#
# Each run gets a fresh copy of the fixture (pi-kit, including the exported home/), runs one `pi -p` task,
# then the task's check command in that copy. Sessions go to /tmp/ab/sessions/<variant>/,
# so `analyze.py --root /tmp/ab/sessions/<variant>` gives cost, requests and cache numbers.
# Results: /tmp/ab/results.tsv (variant, task, rep, exit, check, final-message lines).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
VARIANT=${1:?variant: base or lean}
REPS=${2:-1}
shift 2 2>/dev/null || shift $#
FIXTURE=$HOME/pi-lab/pi-kit
ROOT=/tmp/ab
mkdir -p "$ROOT/sessions/$VARIANT"
FLAGS=()
case $VARIANT in
  base) ;;
  lean) FLAGS=(--append-system-prompt "$HERE/APPEND_SYSTEM.lean.md") ;;
  trim) FLAGS=(-e "$HOME/pi-lab/wip/tool-trim/index.ts") ;; # before tool-trim went live
  notrim) export PI_TOOL_TRIM=0 ;; # after tool-trim went live
  *) echo "unknown variant $VARIANT" >&2; exit 2 ;;
esac

while IFS=$'\t' read -r id prompt check; do
  [ -z "$id" ] && continue
  if [ $# -gt 0 ] && [[ " $* " != *" $id "* ]]; then continue; fi
  for rep in $(seq 1 "$REPS"); do
    dir="$ROOT/work/$VARIANT-$id-$rep"
    rm -rf "$dir" && mkdir -p "$dir"
    (cd "$FIXTURE" && tar -cf - .) | (cd "$dir" && tar -xf -)
    (cd "$dir" && git init -q && git add -A && git -c user.email=ab@x -c user.name=ab commit -qm fixture)
    (cd "$dir" && timeout 900 pi -p --session-dir "$ROOT/sessions/$VARIANT" "${FLAGS[@]}" "$prompt" </dev/null >"$dir.out" 2>"$dir.err")
    code=$?
    (cd "$dir" && bash -c "$check" >/dev/null 2>&1) && ok=pass || ok=fail
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$VARIANT" "$id" "$rep" "$code" "$ok" "$(wc -l <"$dir.out")" | tee -a "$ROOT/results.tsv"
  done
done <"$HERE/tasks.tsv"
