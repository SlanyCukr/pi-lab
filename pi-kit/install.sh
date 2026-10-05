#!/usr/bin/env bash
# Install the pi-kit setup into $HOME.
#   ./install.sh [--sub copilot|codex|openai] [--install-pi] [--files-only]
# --sub         which subscription runs Explore, reviewer and the advisor (default: copilot)
# --install-pi  also install the pinned pi version globally with npm
# --files-only  copy config files only; skip npm installs (quick config refresh)
# Existing files that would be overwritten are backed up to ~/.pi-kit-backup-<timestamp>/.
set -euo pipefail

PI_VERSION="0.99.1" # local patches and extensions were verified against this version (live since 2026-09-29)
SUB="copilot"
INSTALL_PI=0
FILES_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sub) SUB="$2"; shift 2 ;;
    --install-pi) INSTALL_PI=1; shift ;;
    --files-only) FILES_ONLY=1; shift ;;
    -h|--help) sed -n 2,8p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$SUB" in
  copilot) SUB_PROVIDER="github-copilot"; SUB_PLAN="GitHub Copilot" ;;
  codex)   SUB_PROVIDER="openai-codex";   SUB_PLAN="Codex" ;;
  # pi 0.99's /login "OpenAI" stores the ChatGPT subscription under provider openai (the Pi, 2026-10-04)
  openai)  SUB_PROVIDER="openai";         SUB_PLAN="ChatGPT" ;;
  *) echo "--sub must be copilot, codex or openai" >&2; exit 2 ;;
esac

KIT="$(cd "$(dirname "$0")" && pwd)"
SRC="$KIT/home"      # exported from the source machine by export.sh
[ -d "$SRC/.pi/agent" ] || { echo "missing $SRC; run export.sh on the source machine first" >&2; exit 1; }

# Node >= 22.19 (pi's engines field)
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=19)?0:1)' \
  || { echo "node >= 22.19 required (found $(node --version 2>/dev/null || echo none))" >&2; exit 1; }

if [ "$INSTALL_PI" = 1 ]; then
  npm install -g "@earendil-works/pi-coding-agent@$PI_VERSION"
fi
if command -v pi >/dev/null; then
  have=$(pi --version </dev/null 2>/dev/null || true)
  [ "$have" = "$PI_VERSION" ] || echo "warning: pi $have installed, kit was verified on $PI_VERSION" >&2
else
  echo "warning: pi not found on PATH (rerun with --install-pi)" >&2
fi

# Back up anything we are about to overwrite
BACKUP="$HOME/.pi-kit-backup-$(date +%Y%m%d-%H%M%S)"
while IFS= read -r -d '' f; do
  rel="${f#"$SRC"/}"
  if [ -e "$HOME/$rel" ]; then
    mkdir -p "$BACKUP/$(dirname "$rel")"
    cp -a "$HOME/$rel" "$BACKUP/$rel"
  fi
done < <(find "$SRC" -type f -print0)
[ -d "$BACKUP" ] && echo "backed up overwritten files to $BACKUP"

# Copy files and fill in the provider placeholders
rsync -a "$SRC/" "$HOME/"
while IFS= read -r -d '' f; do
  rel="${f#"$SRC"/}"
  sed -i -e "s#{{SUB_PROVIDER}}#$SUB_PROVIDER#g" -e "s#{{SUB_PLAN}}#$SUB_PLAN#g" "$HOME/$rel"
done < <(grep -rlZ '{{SUB_' "$SRC")

# Dependencies: npm packages from settings.json, then the vendored local packages.
# --omit=peer keeps npm from pulling a second 520 MB copy of pi into local packages.
if [ "$FILES_ONLY" = 1 ]; then echo "files copied (--files-only: npm installs skipped)"; exit 0; fi
(cd "$HOME/.pi/agent/npm" && npm install --omit=dev --no-audit --no-fund)
for p in "$HOME"/.pi/agent/local-packages/*/; do
  (cd "$p" && npm install --omit=dev --omit=peer --no-audit --no-fund)
done

cat <<EOF

pi-kit installed (sub-agents and advisor on $SUB_PLAN: $SUB_PROVIDER).
Next:
  1. Run: pi
  2. Type /login and pick Anthropic (main session), then /login again for $SUB_PLAN.
EOF
