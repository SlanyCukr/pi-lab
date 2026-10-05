#!/usr/bin/env bash
# Checks the result of server/install-user.sh in the test container (see Dockerfile).
set -uo pipefail
. ~/.profile
fail=0
ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
ok "node 24 from ~/.local/node" '[ "$(command -v node)" = "$HOME/.local/node/bin/node" ] && node --version | grep -q "^v24\."'
ok "npm prefix is ~/.npm-global" '[ "$(npm config get prefix)" = "$HOME/.npm-global" ]'
ok "pi installed at the kit version" '[ "$(pi --version < /dev/null 2>/dev/null)" = "$(grep -oP "^PI_VERSION=\"\K[^\"]+" ~/pi-lab/pi-kit/install.sh)" ]'
ok "pi-web installed" '[ -x "$HOME/.npm-global/bin/pi-web" ]'
ok "kit placeholders filled with openai" 'grep -q "^model: openai/" ~/.pi/agent/agents/Explore.md && ! grep -rq "{{SUB_" ~/.pi/agent ~/.config/rpiv-advisor'
ok "no find-gaps skill" '[ ! -e ~/.agents/skills/find-gaps ]'
ok "pi-web env: password, mode 600, public host added on the rerun" '[ "$(stat -c %a ~/.config/pi-web/env)" = 600 ] && grep -q "^PI_WEB_PASSWORD=.\{16,\}" ~/.config/pi-web/env && grep -qx "PI_WEB_ALLOWED_HOSTS=pi.example.com" ~/.config/pi-web/env'
ok "pi-web unit points at the installed node" 'grep -q "ExecStart=%h/.local/node/bin/node %h/.npm-global/bin/pi-web" ~/.config/systemd/user/pi-web.service'
ok "environment.d for units" 'grep -q "^TZ=Europe/Prague" ~/.config/environment.d/50-pi-host.conf'
ok ".profile block written once after two runs" '[ "$(grep -c "^# >>> pi-lab server >>>" ~/.profile)" = 1 ]'
ok "pi starts and lists its extensions without a login" 'timeout 60 pi --help < /dev/null > /dev/null 2>&1'
exit $fail
