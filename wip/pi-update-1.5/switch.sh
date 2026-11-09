#!/bin/bash
# Live switch to pi 1.5.0 + extension updates (2026-11-09). Tested first in /tmp/pi-update-1.5 (SPEC.md).
# pi-web is separate (switch-web.sh, run last: its restart ends pi-web sessions). Rollback: ./rollback.sh.
set -euo pipefail
W=/home/loop/pi-lab/wip/pi-update-1.5
A=/home/loop/.pi/agent
G=/home/loop/.npm-global
B=$W/before
T=/tmp/pi-update-1.5/removed
step() { printf '\n== %s\n' "$*"; }
ver() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$1" 2>/dev/null || echo -; }
PKGS="pi-lens @gotgenes/pi-subagents @gotgenes/pi-permission-system pi-web-access @gotgenes/pi-anthropic-auth @juicesharp/rpiv-todo"

systemctl --user is-active -q find-gaps-media_monitoring && { echo "loop still running: stop it first"; exit 1; }

step "1. snapshot (rollback source)"
mkdir -p "$B" "$T"
cp "$A/settings.json" "$A/npm/package.json" "$A/npm/package-lock.json" "$B/"
{ echo "pi $(ver $G/lib/node_modules/@earendil-works/pi-coding-agent/package.json)"
  echo "pi-web $(ver $G/lib/node_modules/@agegr/pi-web/package.json)"
  echo "rpiv-advisor $(ver $A/local-packages/rpiv-advisor/package.json)"
  for p in $PKGS; do echo "$p $(ver $A/npm/node_modules/$p/package.json)"; done; } | tee "$B/versions.txt"

step "2. pi 1.5.0 (global)"
npm i -g --prefix "$G" @earendil-works/pi-coding-agent@1.5.0 --no-audit --no-fund 2>&1 | tail -2
hash -r; pi --version

step "3. extension packages (npm i, not pi update --extensions: that rewrites permission-system to ^42)"
python3 - "$A/npm/package.json" <<'EOF'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
want = {"pi-lens": "^4.4.11", "@gotgenes/pi-subagents": "^25.0.5", "@gotgenes/pi-permission-system": "40.3.0",
        "pi-web-access": "^0.47.0", "@gotgenes/pi-anthropic-auth": "^3.4.4", "@juicesharp/rpiv-todo": "^2.15.0"}
assert set(want) <= set(d["dependencies"]), "a package is missing from npm/package.json"
d["dependencies"].update(want)
assert d.get("allowScripts"), "allowScripts missing"
open(p, "w").write(json.dumps(d, indent=2) + "\n")
EOF
(cd "$A/npm" && npm i --no-audit --no-fund 2>&1 | tail -2)
for p in $PKGS; do echo "$p $(ver $A/npm/node_modules/$p/package.json)"; done
[ "$(ver $A/npm/node_modules/@gotgenes/pi-permission-system/package.json)" = 40.3.0 ] || { echo "permission-system is not 40.3.0"; exit 1; }

step "4. advisor: upstream 2.15.0 + our prompt (upstream has the session-id and WebSocket fixes now)"
mv "$A/local-packages/rpiv-advisor" "$T/rpiv-advisor-2.13.8"
cp -r "$W/rpiv-advisor-2.15.0-local" "$A/local-packages/rpiv-advisor"
(cd "$A/local-packages/rpiv-advisor" && npm i --omit=dev --omit=peer --ignore-scripts --no-audit --no-fund 2>&1 | tail -1)
echo "rpiv-advisor $(ver $A/local-packages/rpiv-advisor/package.json)"

step "5. lsp-exit off (pi-lens 4.4.9 no longer arms the timer; dev copy stays in wip/lsp-exit)"
[ -d "$A/extensions/lsp-exit" ] && mv "$A/extensions/lsp-exit" "$T/lsp-exit"
ls "$A/extensions"

step "6. verify: one turn on Node 24 and one in the runner's form on Node 26"
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
echo "CLI switch done; pi-web next: ./switch-web.sh"
