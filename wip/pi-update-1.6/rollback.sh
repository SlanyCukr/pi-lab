#!/bin/bash
# Roll back switch.sh (+ switch-web.sh): pi 1.5.0, pi-web 0.15.0, settings.json and the packages from before/.
# The loop must be stopped (run.sh stop) while this runs; restart pi-web afterwards (it ends pi-web sessions).
set -euo pipefail
W=/home/loop/pi-lab/wip/pi-update-1.6
A=/home/loop/.pi/agent
G=/home/loop/.npm-global
B=$W/before
[ -f "$B/package-lock.json" ] || { echo "no snapshot in $B"; exit 1; }
cp "$B/settings.json" "$A/settings.json"
cp "$B/package.json" "$B/package-lock.json" "$A/npm/"
npm i -g --prefix "$G" @earendil-works/pi-coding-agent@1.5.0 --no-audit --no-fund 2>&1 | tail -1
npm i -g --prefix "$G" @agegr/pi-web@0.15.0 --no-audit --no-fund 2>&1 | tail -1
(cd "$A/npm" && npm ci --no-audit --no-fund 2>&1 | tail -1)
hash -r; pi --version
echo "rolled back: restart pi-web (systemctl --user restart pi-web)"
