#!/bin/bash
# pi-web 0.15.0 -> 0.18.0 (pins pi 1.6.0 exactly, so web sessions run the same pi as the CLI again).
# Run last: the restart ends every pi-web session process, this script's caller included. The restart runs DELAY
# seconds later (default 20) from a transient unit. That unit then checks the service and the login page; when the
# new version does not answer, it installs 0.15.0 again, restarts once more and says so in $LOG.
# usage: switch-web.sh [delay-seconds]
set -euo pipefail
G=/home/loop/.npm-global
LOG=/home/loop/pi-lab/wip/pi-update-1.6/web-verify.log
DELAY=${1:-20}
ver() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$1" 2>/dev/null || echo -; }
npm i -g --prefix "$G" @agegr/pi-web@0.18.0 --no-audit --no-fund 2>&1 | tail -2
W=$G/lib/node_modules/@agegr/pi-web
n=$W/node_modules/@earendil-works/pi-coding-agent/package.json
[ -f "$n" ] || n=$G/lib/node_modules/@earendil-works/pi-coding-agent/package.json
echo "pi-web $(ver $W/package.json), pi $(ver "$n") ($n)"
[ "$(ver "$n")" = 1.6.0 ] || { echo "pi-web does not resolve pi 1.6.0: installing 0.15.0 again"; npm i -g --prefix "$G" @agegr/pi-web@0.15.0 --no-audit --no-fund 2>&1 | tail -1; exit 1; }
cat > /tmp/pi-web-update-restart.sh <<EOF
#!/bin/bash
export PATH=$PATH
check() { sleep 30; code=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://127.0.0.1:30141/); echo "\$(date -Is) pi-web \$(systemctl --user is-active pi-web) HTTP \$code (\$1)"; case \$code in 200|30?|401) return 0;; *) return 1;; esac; }
{ systemctl --user restart pi-web.service
  if check "0.18.0"; then
    journalctl --user -u pi-web --since '-60s' --no-pager | grep -iE 'error|fail' | head -5
  else
    echo "0.18.0 did not answer: rolling pi-web back to 0.15.0"
    journalctl --user -u pi-web --since '-60s' --no-pager | tail -15
    npm i -g --prefix "$G" @agegr/pi-web@0.15.0 --no-audit --no-fund 2>&1 | tail -1
    systemctl --user restart pi-web.service
    check "0.15.0 after rollback" || echo "STILL DOWN: see journalctl --user -u pi-web"
  fi; } > $LOG 2>&1
EOF
chmod +x /tmp/pi-web-update-restart.sh
systemd-run --user --collect --on-active="${DELAY}s" --unit pi-web-update-restart /tmp/pi-web-update-restart.sh
echo "pi-web restarts in $DELAY s; check: cat $LOG"
