#!/bin/bash
# Live switch to pi 1.6.0 + extension updates (2026-11-21). Tested first in /tmp/pi-update-1.6 (SPEC.md, REPORT-scratch.md).
# pi-web is separate (switch-web.sh, run last: its restart ends pi-web sessions). Rollback: ./rollback.sh.
# usage: switch.sh [cacheWarming value to write into settings.json, e.g. streaming; empty = leave the setting unset]
set -euo pipefail
W=/home/loop/pi-lab/wip/pi-update-1.6
A=/home/loop/.pi/agent
G=/home/loop/.npm-global
B=$W/before
WARM=${1:-}
step() { printf '\n== %s\n' "$*"; }
ver() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$1" 2>/dev/null || echo -; }
PKGS="pi-lens @gotgenes/pi-subagents @gotgenes/pi-permission-system pi-web-access @gotgenes/pi-anthropic-auth"

systemctl --user is-active -q find-gaps-media_monitoring && { echo "loop still running: stop it first (run.sh stop)"; exit 1; }
systemctl --user is-active -q harness-review.service && { echo "harness review running: wait for it"; exit 1; }

step "1. snapshot (rollback source)"
mkdir -p "$B"
cp "$A/settings.json" "$A/npm/package.json" "$A/npm/package-lock.json" "$B/"
{ echo "pi $(ver $G/lib/node_modules/@earendil-works/pi-coding-agent/package.json)"
  echo "pi-web $(ver $G/lib/node_modules/@agegr/pi-web/package.json)"
  for p in $PKGS; do echo "$p $(ver $A/npm/node_modules/$p/package.json)"; done; } | tee "$B/versions.txt"

step "2. pi 1.6.0 (global)"
npm i -g --prefix "$G" @earendil-works/pi-coding-agent@1.6.0 --no-audit --no-fund 2>&1 | tail -2
hash -r; pi --version

step "3. extension packages (npm i, not pi update --extensions: that rewrites permission-system to ^42)"
python3 - "$A/npm/package.json" <<'EOF'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
want = {"pi-lens": "^4.5.1", "@gotgenes/pi-subagents": "^25.0.5", "@gotgenes/pi-permission-system": "40.3.0",
        "pi-web-access": "^0.48.0", "@gotgenes/pi-anthropic-auth": "^3.6.0"}
assert set(want) <= set(d["dependencies"]), "a package is missing from npm/package.json"
d["dependencies"].update(want)
assert d.get("allowScripts"), "allowScripts missing"
open(p, "w").write(json.dumps(d, indent=2) + "\n")
EOF
(cd "$A/npm" && npm i --no-audit --no-fund 2>&1 | tail -2)
for p in $PKGS; do echo "$p $(ver $A/npm/node_modules/$p/package.json)"; done
[ "$(ver $A/npm/node_modules/@gotgenes/pi-permission-system/package.json)" = 40.3.0 ] || { echo "permission-system is not 40.3.0"; exit 1; }

step "4. settings"
if [ -n "$WARM" ]; then
  python3 - "$A/settings.json" "$WARM" <<'EOF'
import json, sys
p, v = sys.argv[1], sys.argv[2]; d = json.load(open(p))
d["cacheWarming"] = v
open(p, "w").write(json.dumps(d, indent=2) + "\n")
print("cacheWarming =", v)
EOF
else echo "cacheWarming left unset (pi's default)"; fi

step "5. verify: one turn on Node 24 and one in the runner's form on Node 26"
cd /tmp
timeout 180 pi -p --model anthropic/claude-haiku-5-5 --no-session "Run the bash command: echo node24-ok. Reply with its output only." < /dev/null 2> "$W/verify24.err" | tail -1
d=$(mktemp -d)
echo "Answer briefly." > "$d/note.md"
echo "Run the bash command: echo node26-ok. Reply with its output only." > "$d/prompt.txt"
PATH=/home/loop/.local/node26/bin:$PATH timeout 180 pi -p --model anthropic/claude-haiku-5-5 --thinking low --tools read,grep,find,ls,bash \
  --append-system-prompt "$d/note.md" --session-dir "$d/s" < "$d/prompt.txt" 2> "$W/verify26.err" | tail -1
f=$(ls "$d"/s/*.jsonl | head -1)
python3 - "$f" <<'EOF'
import json, sys
u = [json.loads(l)["message"]["usage"] for l in open(sys.argv[1]) if '"usage"' in l and '"assistant"' in l]
print("runner-form usage keys:", sorted(u[-1]) if u else "NONE", "| cost", u[-1].get("cost", {}).get("total") if u else None)
EOF
grep -v '^Warning: Extension package ' "$W/verify24.err" "$W/verify26.err" | head -5 || true
cd /tmp && rm -rf "./$(basename "$d")"
echo "CLI switch done; pi-web next: ./switch-web.sh"
