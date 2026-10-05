#!/usr/bin/env bash
# run1.sh <model> <thinking> <task> <rep>
m=$1 th=$2 k=$3 rep=$4; tag=$(echo "$m" | tr '/' '_')-$th
declare -A C=([g80]=7938ed92 [g68]=b8f2696d [g23]=cb478241) F=([g80]=frontend/lib/share-format.test.ts [g68]=backend/tests/test_backup_script.py [g23]=backend/tests/test_chat_agent.py)
w=/tmp/abb/w/$tag-$k-$rep; sd=/tmp/abb/sess/$tag/$k-$rep; mkdir -p $sd /tmp/abb/out
/tmp/abb/mk.sh ${C[$k]}^ $w > /dev/null
s=$(date +%s)
(cd $w && timeout 2400 pi -p --session-dir $sd --model $m --thinking $th --tools read,bash,edit,write,grep,find,ls,lens_diagnostics,lsp_navigation --append-system-prompt /tmp/abb/builder-append.md "$(cat /tmp/abb/spec-$k.md)" < /dev/null > /tmp/abb/out/$tag-$k-$rep.txt 2>&1)
rc=$?; e=$(date +%s)
git -C ~/Documents/personal/projects/media_monitoring show ${C[$k]}:${F[$k]} > $w/${F[$k]}
case ${F[$k]} in frontend/*) res=$(cd $w/frontend && timeout 300 npx vitest run ${F[$k]#frontend/} 2>&1 | grep -E 'Tests +[0-9]' | tail -1 | tr -s ' ');;
  *) res=$(cd $w/backend && PYTHONPATH=$PWD timeout 600 .venv/bin/python -m pytest -q ${F[$k]#backend/} 2>&1 | tail -1);; esac
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$tag" "$k" "$rep" "$rc" "$((e-s))" "$res" >> /tmp/abb/results.tsv
