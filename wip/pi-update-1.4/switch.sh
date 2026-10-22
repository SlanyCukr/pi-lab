#!/bin/bash
# Live switch to pi 1.4.0 + extension updates (2026-10-22). Run only while the find-gaps loop is stopped.
# Tested in a scratch agent dir first (/tmp/pi-update-1.4/SPEC.md: 12 checks, all work). Rollback: ./rollback.sh.
# pi-web pins pi-coding-agent 1.2.0 exactly; it used the global copy, so after the global moves to 1.4.0 pi-web is
# reinstalled to get its own nested 1.2.0 (the shared extensions accept pi >= 1.0, so they run on both).
set -euo pipefail
W=/home/loop/pi-lab/wip/pi-update-1.4
A=/home/loop/.pi/agent
G=/home/loop/.npm-global
B=$W/before
step() { printf '\n== %s\n' "$*"; }
ver() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$1" 2>/dev/null || echo -; }

systemctl --user is-active -q find-gaps-media_monitoring && { echo "loop still running: stop it first"; exit 1; }

step "1. snapshot (rollback source)"
mkdir -p "$B"
cp "$A/settings.json" "$A/npm/package.json" "$A/npm/package-lock.json" "$B/"
{ echo "pi $(ver $G/lib/node_modules/@earendil-works/pi-coding-agent/package.json)"
  echo "pi-web $(ver $G/lib/node_modules/@agegr/pi-web/package.json)"
  for p in pi-lens @gotgenes/pi-subagents @gotgenes/pi-permission-system pi-web-access @gotgenes/pi-anthropic-auth @juicesharp/rpiv-todo; do
    echo "$p $(ver $A/npm/node_modules/$p/package.json)"; done; } | tee "$B/versions.txt"

step "2. pi 1.4.0 (global)"
npm i -g --prefix "$G" @earendil-works/pi-coding-agent@1.4.0 --no-audit --no-fund 2>&1 | tail -2
hash -r; pi --version

step "3. pi-web 0.12.2 with its own pi 1.2.0"
npm i -g --prefix "$G" @agegr/pi-web@0.12.2 --no-audit --no-fund 2>&1 | tail -2
n=$G/lib/node_modules/@agegr/pi-web/node_modules/@earendil-works/pi-coding-agent/package.json
[ "$(ver "$n")" = 1.2.0 ] || { echo "pi-web has no nested pi-coding-agent 1.2.0 ($(ver "$n")): run rollback.sh"; exit 1; }
echo "pi-web $(ver $G/lib/node_modules/@agegr/pi-web/package.json), nested pi $(ver "$n")"

step "4. extension packages (npm i, not pi update --extensions: that rewrites permission-system to ^41)"
python3 - "$A/npm/package.json" <<'EOF'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
want = {"pi-lens": "^4.4.4", "@gotgenes/pi-subagents": "^25.0.1", "@gotgenes/pi-permission-system": "40.3.0",
        "pi-web-access": "^0.44.0", "@gotgenes/pi-anthropic-auth": "^3.4.3", "@juicesharp/rpiv-todo": "^2.13.9"}
assert set(want) <= set(d["dependencies"]), "a package is missing from npm/package.json"
d["dependencies"].update(want)
assert d.get("allowScripts"), "allowScripts missing"
open(p, "w").write(json.dumps(d, indent=2) + "\n")
EOF
(cd "$A/npm" && npm i --no-audit --no-fund 2>&1 | tail -2)
for p in pi-lens @gotgenes/pi-subagents @gotgenes/pi-permission-system pi-web-access @gotgenes/pi-anthropic-auth @juicesharp/rpiv-todo; do
  echo "$p $(ver $A/npm/node_modules/$p/package.json)"; done
[ "$(ver $A/npm/node_modules/@gotgenes/pi-permission-system/package.json)" = 40.3.0 ] || { echo "permission-system is not 40.3.0"; exit 1; }

step "5. verify: one turn on Node 24 and one in the runner's form on Node 26"
cd /tmp
timeout 180 pi -p --model anthropic/claude-haiku-5-5 --no-session "Run the bash command: echo node24-ok. Reply with its output only." < /dev/null 2> "$W/verify24.err" | tail -1
d=$(mktemp -d)
PATH=/home/loop/.local/node26/bin:$PATH timeout 180 pi -p --model anthropic/claude-haiku-5-5 --thinking low --tools read,grep,find,ls,bash \
  --append-system-prompt "$W/SPEC-note.md" --session-dir "$d" "Run the bash command: echo node26-ok. Reply with its output only." < /dev/null 2> "$W/verify26.err" | tail -1
f=$(ls "$d"/*.jsonl | head -1)
python3 - "$f" <<'EOF'
import json, sys
u = [json.loads(l)["message"]["usage"] for l in open(sys.argv[1]) if '"usage"' in l and '"assistant"' in l]
print("runner-form usage keys:", sorted(u[-1]) if u else "NONE")
EOF
grep -v '^Warning: Extension package ' "$W/verify24.err" "$W/verify26.err" | head -5 || true
cd /tmp && rm -rf "./$(basename "$d")"
echo "switch done: restart the loop, then pi-web (last; it ends pi-web sessions' processes)"
