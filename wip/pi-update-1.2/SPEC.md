# Prepare the pi + extensions update (do NOT apply it live)

Host: Raspberry Pi 5, user `loop`, 4 cores, shared with production and an always-running find-gaps loop.
Goal: find out exactly what breaks when we move from pi 0.99.1 to 1.2.0 and update the packages, and prepare
every fix, so the live switch later is: install, copy prepared files, verify. Nothing live changes now.

## Current state
- pi CLI: `@earendil-works/pi-coding-agent` 0.99.1, global in `~/.npm-global` (Node 24 at `~/.local/node`). Latest 1.2.0.
- Config dir: `~/.pi/agent/` (settings.json, APPEND_SYSTEM.md, agents/*.md, extensions/<name>/index.ts, local-packages/, npm/ = installed pi packages).
  `PI_CODING_AGENT_DIR=<dir>` makes pi use another config dir.
- Packages in settings.json: `npm:pi-web-access` 0.30.0 (latest 0.41.0), `npm:pi-lens` 4.3.0 (4.4.3),
  `npm:@gotgenes/pi-subagents` 21.9.4 (23.4.0, requires pi >= 1.0.0), `npm:@gotgenes/pi-anthropic-auth` 3.4.2 (current),
  `npm:@juicesharp/rpiv-todo` 2.12.0 (2.13.8), `local-packages/pi-permission-system-33.0.8` (patched local copy; dev copy in `~/pi-lab/wip/`),
  `local-packages/rpiv-advisor` (patched). Also the web UI `@agegr/pi-web` 0.9.3 global (latest 0.12.1), service `pi-web.service`.
- Own extensions: `~/.pi/agent/extensions/{arg-fixes,auto-continue,bg-bash,cache-ttl,compact-at,hide-tools,model-check,pi-permission-system,tool-groups,tool-trim}`; dev copies + tests in `~/pi-lab/wip/<name>/`.
- Changelogs already extracted: pi 0.99.2..1.2.0 at `/tmp/pi-cl.md`; pi-subagents 21.9.4..23.4.0 at `/tmp/sub-cl.md`.
- Known risks:
  1. pi 1.2.0: `before_agent_start` also fires for `pi.sendMessage(..., {triggerTurn: true})`; `BeforeAgentStartEvent` is a union on `messageType` ("user" has `prompt`/`images`, "custom" has `message`, no `prompt`). Session counts busy while a run starts (`ctx.isIdle()` false; `sendUserMessage` delivery rules changed). Users: bg-bash, cache-ttl, compact-at, permission-system, rpiv-advisor (grep found them).
  2. pi 1.2.0: `pi -p` exits 1 (partial text + stderr warning) when the final answer hits the output token limit. The find-gaps runner (`~/.agents/skills/find-gaps/run.sh`, dev `~/pi-lab/wip/find-gaps/`) counts failed cycles; 3 in a row stop the run. Also `~/bin/harness-review`.
  3. pi 1.0.1: npm installs no longer ship `npm-shrinkwrap.json`; transitive deps float.
  4. pi-subagents 23: stops a subagent at max_turns after warnings; turns reported only via `turnBudget`; minimum two turns; resumed subagent gets a fresh budget. `agents/Explore.md` and `agents/explore-glm.md` set max_turns. Scripts that parse sessions: `~/pi-lab/wip/find-gaps/analyze-loop.py`, `tool-audit.py`, `~/pi-lab/analyze.py` if present.

## Hard rules
- Do not modify `~/.npm-global`, `~/.pi/agent`, `~/.agents/skills`, `~/bin`, systemd units, or anything under `~/projects/`. Do not restart services. Do not touch the find-gaps loop.
- Work under `/tmp/pi-update/` only (your own subfolder named in your task). Prepared fixes go there as patched copies plus a `.diff` against the live file.
- Never read or print secrets: `~/.pi/agent/auth.json`, `~/.config/pi-web/env`, `~/.config/gh/hosts.yml`, env.sh keys. A symlink to auth.json is allowed, never `cat` it.
- `pi -p` from a script needs `< /dev/null`; use `--no-session` for test turns; keep test turns few and small (cheap model is fine where the test allows: check `pi --list-models` style flags yourself).
- `rm -rf` with several arguments is denied by policy: delete one directory at a time.
- Install npm packages with `npm i --prefix /tmp/pi-update/<you>/prefix ...` (never `-g`).

## Report (at most ~600 words)
Per item: what you checked, the evidence (command + result, file:line), verdict (works / breaks / unknown), and the prepared fix path. End with the exact ordered steps for the live switch and the rollback commands.
