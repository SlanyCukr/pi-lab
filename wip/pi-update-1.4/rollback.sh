#!/bin/bash
# Roll back switch.sh: pi 1.2.0, pi-web 0.12.1, the extension packages from before/package-lock.json.
set -euo pipefail
W=/home/loop/pi-lab/wip/pi-update-1.4
A=/home/loop/.pi/agent
G=/home/loop/.npm-global
B=$W/before
[ -f "$B/package-lock.json" ] || { echo "no snapshot in $B"; exit 1; }
cp "$B/settings.json" "$A/settings.json"
cp "$B/package.json" "$B/package-lock.json" "$A/npm/"
npm i -g --prefix "$G" @earendil-works/pi-coding-agent@1.2.0 --no-audit --no-fund 2>&1 | tail -1
npm i -g --prefix "$G" @agegr/pi-web@0.12.1 --no-audit --no-fund 2>&1 | tail -1
(cd "$A/npm" && npm ci --no-audit --no-fund 2>&1 | tail -1)
hash -r; pi --version
echo "rolled back: restart pi-web (systemctl --user restart pi-web) and the loop"
