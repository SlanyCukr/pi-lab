#!/bin/bash
# Live switch to pi 1.2.0 (2026-10-15). Run only while the find-gaps loop is stopped.
# Rollback: ./rollback.sh (same folder).
set -euo pipefail
W=/home/loop/pi-lab/wip/pi-update-1.2
A=/home/loop/.pi/agent
F=$W/fixes
B=$W/before
step() { printf '\n== %s\n' "$*"; }

systemctl --user is-active -q find-gaps-media_monitoring && { echo "loop still running: stop it first"; exit 1; }

step "1. snapshot the files this changes (rollback source)"
mkdir -p "$B"
cp "$A/settings.json" "$B/settings.json"
cp "$A/extensions/pi-permission-system/config.json" "$B/permission-config.json"
cp "$A/npm/package.json" "$B/npm-package.json"
[ -f "$A/npm/package-lock.json" ] && cp "$A/npm/package-lock.json" "$B/npm-package-lock.json"
pi --version > "$B/pi-version.txt" 2>&1 || true
python3 - "$A" > "$B/package-versions.txt" <<'EOF'
import json, sys, pathlib
nm = pathlib.Path(sys.argv[1]) / "npm" / "node_modules"
for p in ["pi-web-access", "pi-lens", "@gotgenes/pi-subagents", "@gotgenes/pi-anthropic-auth", "@juicesharp/rpiv-todo"]:
    f = nm / p / "package.json"
    print(p, json.load(open(f))["version"] if f.exists() else "-")
EOF
cat "$B/pi-version.txt" "$B/package-versions.txt"

step "2. pi 1.2.0"
# --prefix: this user's globals live in ~/.npm-global; a bare -g from a pi-web shell installs into ~/.local/node,
# which comes first on the units' PATH but not in pi-web.service's ExecStart (found during the 2026-10-15 switch).
npm i -g --prefix /home/loop/.npm-global @earendil-works/pi-coding-agent@1.2.0 --no-audit --no-fund 2>&1 | tail -2
hash -r
pi --version

step "3. rpiv-advisor 2.13.8 + our three fixes (old copy kept in $W/rpiv-advisor-2.11.0-tested)"
mv "$A/local-packages/rpiv-advisor" /tmp/pi-update/old-rpiv-advisor-live
cp -a "$F/rpiv-advisor-2.13.8-local" "$A/local-packages/rpiv-advisor"

step "4. settings.json: npm permission system 40.x"
python3 - "$A/settings.json" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
old = '"local-packages/pi-permission-system-33.0.8"'
assert s.count(old) == 1, "settings.json line not found"
open(p, "w").write(s.replace(old, '"npm:@gotgenes/pi-permission-system"'))
EOF

step "5. permission policy: the six work-tree rm -rf rules for 40.x"
cp "$F/pi-permission-system-40/config.json" "$A/extensions/pi-permission-system/config.json"

step "6. pi update --extensions"
python3 -c "import json;d=json.load(open('$A/npm/package.json'));assert d.get('allowScripts'),'allowScripts missing'"
pi update --extensions < /dev/null 2>&1 | tail -8
python3 -c "import json;d=json.load(open('$A/npm/package.json'));assert d.get('allowScripts'),'allowScripts lost'; print('allowScripts kept')"
(cd "$A/npm" && npm approve-scripts --allow-scripts-pending 2>&1 | tail -3) || true

step "7. local permission package out of the load path (wip copy stays)"
mv "$A/local-packages/pi-permission-system-33.0.8" /tmp/pi-update/old-pi-permission-system-33.0.8

step "8. pi-web 0.12.1 (bundles pi 1.2.0)"
npm i -g --prefix /home/loop/.npm-global @agegr/pi-web@0.12.1 --no-audit --no-fund 2>&1 | tail -2

step "9. versions"
pi --version
pi list 2>&1 | tail -12
python3 - "$A" <<'EOF'
import json, sys, pathlib
nm = pathlib.Path(sys.argv[1]) / "npm" / "node_modules"
for p in ["pi-web-access", "pi-lens", "@gotgenes/pi-subagents", "@gotgenes/pi-anthropic-auth", "@juicesharp/rpiv-todo", "@gotgenes/pi-permission-system"]:
    f = nm / p / "package.json"
    print(p, json.load(open(f))["version"] if f.exists() else "MISSING")
EOF
echo "switch done"
