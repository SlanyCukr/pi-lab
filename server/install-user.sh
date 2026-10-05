#!/usr/bin/env bash
# User side of a headless pi host, run as the unprivileged user (no sudo). Idempotent.
#   ./server/install-user.sh [--sub openai|codex|copilot] [--tz Europe/Prague] [--port 30141]
#                            [--public-host pi.example.com] [--no-services]
# What it does:
#   - Node 24 in ~/.local/node (official tarball, checksum verified) unless a Node >= 22.19 is already on PATH;
#   - npm global prefix ~/.npm-global, PATH and env in ~/.profile and ~/.config/environment.d (systemd units);
#   - ~/bin/docker -> rootless podman, ~/bin/gh with a private temp dir (shared /tmp caches belong to other users);
#   - the pi setup from ../pi-kit (pi itself, extensions, agents, skills, configs);
#   - pi-web (browser UI) as a user unit on 127.0.0.1:<port>, with a generated password in ~/.config/pi-web/env.
# --no-services skips systemctl (containers without systemd, tests). Logins are interactive: run `pi`, then /login.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="$HERE/../pi-kit"
SUB=openai TZ_NAME=Europe/Prague PORT=30141 PUBLIC_HOST="" SERVICES=1
NODE_MAJOR=24 PI_WEB_VERSION=0.9.3
while [ $# -gt 0 ]; do
  case $1 in
    --sub) SUB=$2; shift 2 ;;
    --tz) TZ_NAME=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --public-host) PUBLIC_HOST=$2; shift 2 ;;
    --no-services) SERVICES=0; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" != 0 ] || { echo "run as the pi user, not root" >&2; exit 1; }
say() { printf '== %s\n' "$*"; }

# --- Node ---------------------------------------------------------------------------------------
node_ok() { command -v node > /dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=19)?0:1)'; }
export PATH="$HOME/bin:$HOME/.local/node/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"
if ! node_ok; then
  case $(uname -m) in aarch64|arm64) arch=arm64 ;; x86_64) arch=x64 ;; *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;; esac
  base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  tmp=$(mktemp -d)
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file=$(grep -oE "node-v[0-9.]+-linux-$arch\.tar\.xz" "$tmp/SHASUMS256.txt" | head -1)
  say "installing $file into ~/.local/node"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -)
  rm -rf "$HOME/.local/node" && mkdir -p "$HOME/.local/node"
  tar -xJf "$tmp/$file" -C "$HOME/.local/node" --strip-components=1
  rm -rf "$tmp"
fi
node_ok || { echo "node install failed" >&2; exit 1; }
mkdir -p "$HOME/.npm-global" "$HOME/bin" "$HOME/.local/bin"
npm config set prefix "$HOME/.npm-global"

# --- Environment for login shells and for systemd user units -------------------------------------
begin="# >>> pi-lab server >>>" end="# <<< pi-lab server <<<"
touch "$HOME/.profile"
sed -i "/^$begin\$/,/^$end\$/d" "$HOME/.profile"
cat >> "$HOME/.profile" <<EOF
$begin
export PATH=\$HOME/bin:\$HOME/.local/node/bin:\$HOME/.npm-global/bin:\$HOME/.local/bin:\$PATH
export NPM_CONFIG_PREFIX=\$HOME/.npm-global
export XDG_RUNTIME_DIR=/run/user/\$(id -u)
export DOCKER_HOST=unix://\$XDG_RUNTIME_DIR/podman/podman.sock
export TESTCONTAINERS_RYUK_DISABLED=true
export TZ=$TZ_NAME
$end
EOF
mkdir -p "$HOME/.config/environment.d"
cat > "$HOME/.config/environment.d/50-pi-host.conf" <<EOF
# pi-lab server/install-user.sh: what this user's systemd units see (PATH, rootless podman as docker, time zone).
PATH=\${HOME}/bin:\${HOME}/.local/node/bin:\${HOME}/.npm-global/bin:\${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin
DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock
TESTCONTAINERS_RYUK_DISABLED=true
TZ=$TZ_NAME
EOF

# --- Wrappers -------------------------------------------------------------------------------------
if command -v podman > /dev/null; then
  printf '#!/bin/sh\n# Rootless podman stands in for docker (this user has no access to the host docker daemon).\nexec podman "$@"\n' > "$HOME/bin/docker"
  chmod +x "$HOME/bin/docker"
fi
if [ -x /usr/bin/gh ]; then
  cat > "$HOME/bin/gh" <<'EOF'
#!/bin/sh
# gh caches run logs in $TMPDIR/gh-cli-cache; on a shared host /tmp/gh-cli-cache may belong to another user.
TMPDIR=/tmp/$(id -un)-gh; export TMPDIR
mkdir -p "$TMPDIR"
exec /usr/bin/gh "$@"
EOF
  chmod +x "$HOME/bin/gh"
fi

# --- pi and the kit -------------------------------------------------------------------------------
say "installing the pi setup from pi-kit (--sub $SUB)"
"$KIT/install.sh" --sub "$SUB" --install-pi

# --- pi-web ---------------------------------------------------------------------------------------
say "installing pi-web $PI_WEB_VERSION"
npm install -g --no-fund --no-audit "@agegr/pi-web@$PI_WEB_VERSION" > /dev/null
mkdir -p "$HOME/.config/pi-web"
if [ ! -f "$HOME/.config/pi-web/env" ]; then
  ( umask 077
    { printf 'PI_WEB_PASSWORD=%s\n' "$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
      if [ -n "$PUBLIC_HOST" ]; then printf 'PI_WEB_ALLOWED_HOSTS=%s\n' "$PUBLIC_HOST"; fi; } > "$HOME/.config/pi-web/env" )
  say "pi-web password generated in ~/.config/pi-web/env (read it there; it is not printed)"
elif [ -n "$PUBLIC_HOST" ] && ! grep -q '^PI_WEB_ALLOWED_HOSTS=' "$HOME/.config/pi-web/env"; then
  printf 'PI_WEB_ALLOWED_HOSTS=%s\n' "$PUBLIC_HOST" >> "$HOME/.config/pi-web/env"
fi
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/pi-web.service" <<EOF
[Unit]
Description=Pi Web (browser UI for pi coding-agent sessions, 127.0.0.1:$PORT)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h
ExecStart=%h/.local/node/bin/node %h/.npm-global/bin/pi-web --no-open --hostname 127.0.0.1 --port $PORT
Environment=PI_WEB_NO_OPEN=1
EnvironmentFile=%h/.config/pi-web/env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
# A Node that came with the system (not ~/.local/node) still works: point the unit at it.
[ -x "$HOME/.local/node/bin/node" ] || sed -i "s#%h/.local/node/bin/node#$(command -v node)#" "$HOME/.config/systemd/user/pi-web.service"

if [ "$SERVICES" = 1 ]; then
  systemctl --user daemon-reload
  command -v podman > /dev/null && systemctl --user enable --now podman.socket
  systemctl --user enable --now pi-web.service
  sleep 3
  say "pi-web: $(systemctl --user is-active pi-web.service) on 127.0.0.1:$PORT"
fi

cat <<EOF

Done. Next:
  1. Log out and back in (or: . ~/.profile).
  2. Run pi, type /login, pick Anthropic; /login again for the sub-agent plan ($SUB).
  3. Optional public access: point a Cloudflare tunnel (root, cloudflared) at http://127.0.0.1:$PORT
     and rerun with --public-host <name> so pi-web accepts that Host header.
EOF
