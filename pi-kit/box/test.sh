#!/usr/bin/env bash
# Runs inside the box. No credentials needed: the main session talks to mock-llm.mjs,
# which makes pi call `subagent` (Explore) and `advisor`. Those two should target
# github-copilot and fail only on missing auth, which proves the wiring.
set -uo pipefail
LOG=/tmp/mock-requests.jsonl
rm -f "$LOG"
node /opt/pi-kit/box/mock-llm.mjs & MOCK=$!
trap 'kill $MOCK 2>/dev/null' EXIT
sleep 1

# Test-only provider, not part of the kit
cat > ~/.pi/agent/models.json <<'EOF'
{ "providers": { "mock": {
  "baseUrl": "http://127.0.0.1:18080/v1", "api": "openai-completions", "apiKey": "x",
  "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false },
  "models": [ { "id": "mock-1", "contextWindow": 200000, "maxOutputTokens": 8192 } ] } } }
EOF

echo "== pi version: $(pi --version </dev/null)"
echo "== run"
timeout 300 pi -p --no-session --provider mock --model mock-1 "box test" </dev/null >/tmp/out.txt 2>/tmp/err.txt
echo "exit=$?"
echo "-- stdout:"; head -c 1500 /tmp/out.txt; echo
echo "-- stderr (first 40 lines):"; head -40 /tmp/err.txt

echo "== requests seen by mock: $(wc -l < "$LOG")"
first=$(head -1 "$LOG")
echo "-- tools offered to main session:"
echo "$first" | jq -r '[.tools[].function.name] | join(" ")'
echo "-- system prompt checks:"
sys=$(echo "$first" | jq -r '.messages[0].content | if type=="string" then . else (map(.text)|join("")) end')
for needle in "ADHD-shaped output" "GitHub Copilot plan" "grill-me" "diagnose" "desloppify"; do
  grep -qF "$needle" <<<"$sys" && echo "ok   $needle" || echo "MISS $needle"
done
echo "-- sub-agent types listed in the subagent tool:"
echo "$first" | jq -r '.tools[] | select(.function.name=="subagent") | .function.description' \
  | grep -oE '^- (Explore|builder|reviewer|explore-glm):' | tr '\n' ' '; echo
echo "-- model per request (main = 18 tools, child = fewer):"
jq -r '"\(.model) tools=\(.tools|length)"' "$LOG" | sort | uniq -c
echo "-- tool results returned to main session:"
tail -1 "$LOG" | jq -r '.messages[] | select(.role=="tool") | "[\(.tool_call_id)] " + ((.content | if type=="string" then . else (map(.text)|join("")) end)[0:600])'
