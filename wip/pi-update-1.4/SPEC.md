# Test the pi 1.2.0 -> 1.4.0 + extensions update in a scratch dir (do NOT change anything live)

Host: Raspberry Pi 5, user `loop`, shared with production and an always-running find-gaps loop. Keep load low
(no parallel heavy jobs). Goal: prove, with real pi turns, whether the update works with our extensions, so the
live switch is: install, copy one package.json, verify. Work only under `/tmp/pi-update-1.4/`.

## Current live state (read-only for you)
- pi CLI `@earendil-works/pi-coding-agent` 1.2.0 in `~/.npm-global` (Node 24.22.1 at `~/.local/node`; the loop's
  sessions run pi on Node 26 at `~/.local/node26`). Target: 1.4.0.
- Config dir `~/.pi/agent/`: settings.json, APPEND_SYSTEM.md, agents/*.md, extensions/<name>/ (own: arg-fixes,
  auto-continue, bg-bash, cache-ttl, compact-at, hide-tools, model-check, tool-groups, tool-trim; plus
  extensions/pi-permission-system/config.json = the permission policy), local-packages/rpiv-advisor (patched advisor),
  npm/ (installed pi packages; package.json holds ranges + allowScripts). `PI_CODING_AGENT_DIR=<dir>` points pi at
  another config dir.
- Package targets: pi-lens ^4.4.4 (its changelog says tested up to pi <1.4.0: the main risk), @gotgenes/pi-subagents
  ^25.0.1 (from 23.4.0; 24/25 change resume/isBackground), @gotgenes/pi-permission-system ~40.3.0 (stay on 40.x; 41
  loosens external_directory asks), pi-web-access ^0.44.0, @gotgenes/pi-anthropic-auth ^3.4.3, @juicesharp/rpiv-todo
  ^2.13.9. Web UI `@agegr/pi-web` 0.12.1 -> 0.12.2 (global, service pi-web.service: do not touch it).
- Changelog review already done: /home/loop/.pi/agent/sessions/--home-loop-pi-lab--/2026-10-14T15-04-44-294Z_01a13af1-c005-71fe-bd4f-ec3528149f7f/tasks/2026-10-22T08-16-30-130Z_01a162ae-dfb1-720c-8426-0a79d328e711.jsonl
  (last assistant message). Extracted packages: /tmp/upd/<name>/package/.
- Previous update's method and scripts: ~/pi-lab/wip/pi-update-1.2/ (SPEC.md, switch.sh, rollback.sh).

## Setup
1. `npm i --prefix /tmp/pi-update-1.4/prefix @earendil-works/pi-coding-agent@1.4.0 --no-audit --no-fund`;
   run it as `/tmp/pi-update-1.4/prefix/node_modules/.bin/pi` (call it P).
2. Scratch agent dir `/tmp/pi-update-1.4/agent/`: symlink auth.json (never read it), APPEND_SYSTEM.md, agents/,
   extensions/, local-packages/, prompts/ from `~/.pi/agent/`; COPY settings.json; create npm/ with a copy of
   `~/.pi/agent/npm/package.json` whose ranges are the targets above (keep allowScripts), then
   `PI_CODING_AGENT_DIR=/tmp/pi-update-1.4/agent P update --extensions < /dev/null` (check allowScripts survived;
   if the live flow needed `npm approve-scripts`, see pi-update-1.2/switch.sh step 6). Record installed versions.
   Note: extensions/ is the LIVE dir via symlink; do not write into it (logs they write themselves are fine).

## Checks (real turns; `--no-session` unless the check needs a session file; `< /dev/null` always;
## Haiku `anthropic/claude-haiku-5-5` where the check allows; at most one advisor call)
a. Startup on Node 24 and on Node 26 (PATH=~/.local/node26/bin:$PATH): no extension load errors on stderr;
   list which tools are active.
b. One main turn using read, bash, edit (on a scratch file under /tmp/pi-update-1.4/), lens_diagnostics and
   lsp_navigation on a small .ts file, and todo. pi-lens must work: no handler errors, diagnostics returned.
c. Sub-agents: a foreground Explore call, a background builder (`run_in_background: true`) + get_subagent_result,
   and one `resume` of a finished agent. Check the session JSONL of each child: model, no errors.
d. One advisor call; check details.advisorModel and that the advice came back.
e. The find-gaps runner's form: `P -p --model anthropic/claude-haiku-5-5 --thinking low --tools read,grep,find,ls,bash
   --append-system-prompt <file> --session-dir <dir> "<prompt>"`; check the JSONL still has message.usage
   (input, output, cacheRead, cacheWrite, cacheWrite1h, cost.total), toolCall/toolResult, stopReason.
f. Permission policy: `rm -rf a b` style multi-arg delete still denied; reading `~/.pi/agent/auth.json` by path
   still denied (just attempt `ls -la ~/.pi/agent/auth.json` via the bash tool and see the decision; never cat).
g. cache-ttl: a top-level session's Anthropic writes are 1 h (`cacheWrite1h` > 0); with PI_CACHE_TTL_MAIN=5m none.
h. compact-at: force compaction with PI_COMPACT_AT_TOKENS=8000 in a session that grows past it; compaction happens,
   the next turn works.
i. bg-bash: a `background: true` bash command delivers its completion; auto-continue does not misfire.
j. hide-tools + 1.4.0's "resumed sessions keep their active tools": resume a session (`--continue` or `--session`)
   and compare active tools before and after.
k. grep the 1.4.0 dist for the event names our extensions use and say whether each still exists:
   context_with_system, agent_before_settle, agent_settled, session_switch, before_provider_request, tool_call,
   session_start, context.
l. pi-web 0.12.2: does its package.json depend on a pi-coding-agent version range that excludes 1.4.0? (read only)

## Hard rules
- Do not modify `~/.npm-global`, `~/.pi/agent` (except logs extensions write on their own), `~/.agents/skills`,
  `~/bin`, systemd units, `~/projects/`. Do not restart services. Do not touch the find-gaps loop.
- Never read or print secrets: auth.json, `~/.config/pi-web/env`, `~/.config/gh/hosts.yml`, env.sh keys.
- `rm -rf` with several arguments is denied: delete one directory at a time.
- When a check fails, find the cause (file:line) and prepare a fix as a patched copy plus .diff under
  /tmp/pi-update-1.4/fixes/; do not apply it live.

## Report (at most ~600 words)
Per check: command, evidence (output line or JSONL field), verdict (works / breaks / unknown). Installed versions.
Prepared fixes. Then the exact ordered live-switch steps (pi CLI, npm/package.json ranges, `pi update --extensions`,
pi-web) and the rollback commands. Cost of your test turns if you can read it from the JSONL.
