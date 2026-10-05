#!/usr/bin/env bash
# Rebuild pi-kit/home/ from the live setup on this machine.
# Never copies secrets (auth.json, models-store.json, web-push.json, sessions, caches)
# or machine-specific files (models.json, code-intel.json, pi-web state).
# Provider names are replaced with placeholders that install.sh fills in:
#   {{SUB_PROVIDER}}  -> github-copilot | openai-codex | openai
#   {{SUB_PLAN}}      -> GitHub Copilot | Codex | ChatGPT
set -euo pipefail

KIT="$(cd "$(dirname "$0")" && pwd)"
OUT="$KIT/home"
A="$HOME/.pi/agent"

rm -rf "$OUT"
mkdir -p "$OUT/.pi/agent/agents" "$OUT/.pi/agent/extensions" "$OUT/.pi/agent/npm" \
  "$OUT/.pi/agent/local-packages" "$OUT/.config/rpiv-advisor" "$OUT/.config/rpiv-todo" \
  "$OUT/.pi-lens" "$OUT/.agents/skills"

sub() {
  sed -e 's#openai-codex/#{{SUB_PROVIDER}}/#g' \
    -e 's#\bopenai/#{{SUB_PROVIDER}}/#g' \
    -e "s#the user's ChatGPT plan#the user's {{SUB_PLAN}} plan#g" \
    -e 's#when ChatGPT is rate-limited#when {{SUB_PLAN}} is rate-limited#g' \
    -e "s#the user's Codex plan#the user's {{SUB_PLAN}} plan#g" \
    -e 's#only when Codex is rate-limited#only when {{SUB_PLAN}} is rate-limited#g' \
    -e 's#or the OpenAI quota is low#or the {{SUB_PLAN}} quota is low#g' \
    -e 's#instead of Explore when Codex is rate-limited#instead of Explore when {{SUB_PLAN}} is rate-limited#g'
}

# System-prompt append and sub-agents
sub < "$A/APPEND_SYSTEM.md" > "$OUT/.pi/agent/APPEND_SYSTEM.md"
for f in "$A"/agents/*.md; do sub < "$f" > "$OUT/.pi/agent/agents/$(basename "$f")"; done

# Own extensions (source only)
for d in arg-fixes auto-continue bg-bash cache-ttl compact-at hide-tools model-check tool-groups tool-trim; do
  rsync -a --include='*.ts' --exclude='*' "$A/extensions/$d/" "$OUT/.pi/agent/extensions/$d/"
done

# Permission policy (JSONC): drop project-specific rules for paths under this home,
# together with the comment block directly above them.
mkdir -p "$OUT/.pi/agent/extensions/pi-permission-system"
PERM_OUT="$OUT/.pi/agent/extensions/pi-permission-system/config.json"
awk -v h="\"$HOME/" '
  /^[[:space:]]*\/\// { buf = buf $0 "\n"; next }
  index($0, h) { buf = ""; next }
  { printf "%s%s\n", buf, $0; buf = "" }
' "$A/extensions/pi-permission-system/config.json" > "$PERM_OUT"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8").replace(/^\s*\/\/.*$/gm, ""))' "$PERM_OUT" \
  || { echo "export.sh: permission config is not valid JSONC after filtering" >&2; exit 1; }

# Settings: drop per-machine UI state
jq 'del(.lastChangelogVersion)' "$A/settings.json" > "$OUT/.pi/agent/settings.json"
cp "$A/web-search.json" "$OUT/.pi/agent/"
cp "$A/npm/package.json" "$OUT/.pi/agent/npm/"

# Locally patched packages, vendored without node_modules
for p in "$A"/local-packages/*/; do
  rsync -a --exclude node_modules "$p" "$OUT/.pi/agent/local-packages/$(basename "$p")/"
done

# Tool configs
sub < "$HOME/.config/rpiv-advisor/advisor.json" > "$OUT/.config/rpiv-advisor/advisor.json"
cp "$HOME/.config/rpiv-todo/config.json" "$OUT/.config/rpiv-todo/"
cp "$HOME/.pi-lens/config.json" "$OUT/.pi-lens/"

# Enabled skills (the .venv is a local Python env, 600+ MB; desloppify installs its own tool).
# find-gaps (the autonomous loop, its board and run state) stays out of the kit by the user's choice (2026-10-05).
rsync -a --exclude .venv --exclude find-gaps "$HOME/.agents/skills/" "$OUT/.agents/skills/"

# Safety net: fail if anything that looks like a credential slipped in
CRED_RE='sk-ant-[A-Za-z0-9_-]{20,}|gh[ousp]_[A-Za-z0-9]{30,}|"(refresh|access)_token" *: *"[^"]{20,}'
if grep -rIlE "$CRED_RE" "$OUT" >/dev/null; then
  echo "export.sh: possible credential found in $OUT, aborting" >&2
  grep -rIlE "$CRED_RE" "$OUT" >&2
  exit 1
fi
leftover=$(grep -rIlE "openai-codex/|\\bopenai/|Codex|ChatGPT|OpenAI quota" "$OUT/.pi/agent/agents" "$OUT/.pi/agent/APPEND_SYSTEM.md" "$OUT/.config" || true)
[ -z "$leftover" ] || { echo "export.sh: provider-specific text left in: $leftover" >&2; exit 1; }

echo "exported to $OUT ($(du -sh "$OUT" | cut -f1))"
