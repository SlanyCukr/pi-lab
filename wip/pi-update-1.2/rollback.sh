#!/bin/bash
# Roll back the 2026-10-15 switch to pi 1.2.0. Stop the find-gaps loop first; restart pi-web after.
set -euo pipefail
W=/home/loop/pi-lab/wip/pi-update-1.2
A=/home/loop/.pi/agent
B=$W/before
npm i -g --prefix /home/loop/.npm-global @earendil-works/pi-coding-agent@0.99.1 @agegr/pi-web@0.9.3 --no-audit --no-fund 2>&1 | tail -2
hash -r
cp "$B/settings.json" "$A/settings.json"
cp "$B/permission-config.json" "$A/extensions/pi-permission-system/config.json"
[ -d "$A/local-packages/pi-permission-system-33.0.8" ] || cp -a /home/loop/pi-lab/wip/pi-permission-system-33.0.8 "$A/local-packages/pi-permission-system-33.0.8"
mv "$A/local-packages/rpiv-advisor" "/tmp/pi-update/rpiv-advisor-2.13.8-rolled-back-$(date +%s)"
cp -a "$W/rpiv-advisor-2.11.0-tested" "$A/local-packages/rpiv-advisor"
npm i --prefix "$A/npm" --legacy-peer-deps pi-web-access@0.30.0 pi-lens@4.3.0 @gotgenes/pi-subagents@21.9.4 @juicesharp/rpiv-todo@2.12.0 --no-audit --no-fund 2>&1 | tail -2
npm uninstall --prefix "$A/npm" @gotgenes/pi-permission-system --no-audit --no-fund 2>&1 | tail -1
cp "$B/npm-package.json" "$A/npm/package.json"
pi --version; pi list 2>&1 | tail -10
echo "rolled back; restart pi-web: systemctl --user restart pi-web"
