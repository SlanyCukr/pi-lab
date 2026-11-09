#!/bin/bash
# pi-web 0.12.2 -> 0.15.0 (pins pi 1.5.0 exactly, so web sessions run the same pi as the CLI again).
# Run last: the restart ends every pi-web session process, this script's caller included. The restart runs
# 20 s later from a transient unit, then a check writes $LOG (HTTP status, versions, journal errors).
set -euo pipefail
G=/home/loop/.npm-global
LOG=/home/loop/pi-lab/wip/pi-update-1.5/web-verify.log
ver() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$1" 2>/dev/null || echo -; }
npm i -g --prefix "$G" @agegr/pi-web@0.15.0 --no-audit --no-fund 2>&1 | tail -2
W=$G/lib/node_modules/@agegr/pi-web
n=$W/node_modules/@earendil-works/pi-coding-agent/package.json
[ -f "$n" ] || n=$G/lib/node_modules/@earendil-works/pi-coding-agent/package.json
echo "pi-web $(ver $W/package.json), pi $(ver "$n") ($n)"
[ "$(ver "$n")" = 1.5.0 ] || { echo "pi-web does not resolve pi 1.5.0: run rollback.sh"; exit 1; }
systemd-run --user --collect --on-active=20s --unit pi-web-update-restart \
  bash -c "systemctl --user restart pi-web.service; sleep 25;
    { date -Is; echo \"pi-web \$(systemctl --user is-active pi-web)\";
      echo \"HTTP \$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:30141/)\";
      journalctl --user -u pi-web --since '-60s' --no-pager | grep -iE 'error|fail' | head -5; } > $LOG 2>&1"
echo "pi-web restarts in 20 s; check: cat $LOG"
