# Test the pi 1.4.0 -> 1.5.0 + extensions update in a scratch dir (do NOT change anything live)

Host: Raspberry Pi 5, user `loop`, shared with production. Keep load low (no parallel heavy jobs). Goal: prove, with
real pi turns, that the update works with our extensions, so the live switch is: install, copy package.json, verify.
Work only under `/tmp/pi-update-1.5/` (it exists; `rpiv-advisor/` there is prepared, see below).

## Current live state (read-only for you)
- pi CLI `@earendil-works/pi-coding-agent` 1.4.0 in `~/.npm-global` (Node 24 at `~/.local/node`; the find-gaps loop
  runs pi on Node 26 at `~/.local/node26`). Target 1.5.0. pi-web 0.12.2 runs a nested pi 1.2.0; target pi-web 0.15.0
  pins pi 1.5.0 exactly.
- Config dir `~/.pi/agent/`: settings.json, APPEND_SYSTEM.md, agents/*.md, prompts/, extensions/<name>/ (own:
  arg-fixes, auto-continue, bg-bash, cache-ttl, compact-at, ext-fresh, hide-tools, lsp-exit, tool-groups, tool-trim;
  plus extensions/pi-permission-system/config.json = the permission policy), local-packages/rpiv-advisor (patched
  advisor 2.13.8), npm/ (installed pi packages; package.json holds ranges + allowScripts).
  `PI_CODING_AGENT_DIR=<dir>` points pi at another config dir.
- Package targets: pi-lens ^4.4.11 (from 4.4.4), @gotgenes/pi-subagents ^25.0.5, @gotgenes/pi-permission-system
  40.3.0 (stays pinned), pi-web-access ^0.47.0 (from 0.44.0), @gotgenes/pi-anthropic-auth ^3.4.4,
  @juicesharp/rpiv-todo ^2.15.0 (from 2.13.9; adds a `tasks[]` batch-create param that our tool-trim now drops).
- Advisor: `/tmp/pi-update-1.5/rpiv-advisor/` = upstream @juicesharp/rpiv-advisor 2.15.0 (which now has our session-id
  and WebSocket-cleanup fixes) + only our prompts/advisor-system.txt; diff in `/tmp/pi-update-1.5/rpiv-advisor-2.15.0-local.diff`.
- lsp-exit should become redundant: pi-lens 4.4.9 sets `reader.partialMessageTimeout = 0`.
- Previous update's spec and scripts: `~/pi-lab/wip/pi-update-1.4/` (SPEC.md, switch.sh, rollback.sh).

## Setup
1. `npm i --prefix /tmp/pi-update-1.5/prefix @earendil-works/pi-coding-agent@1.5.0 --no-audit --no-fund`;
   run it as `/tmp/pi-update-1.5/prefix/node_modules/.bin/pi` (call it P).
2. Scratch agent dir `/tmp/pi-update-1.5/agent/`: symlink auth.json (never read it), APPEND_SYSTEM.md, agents/,
   prompts/ from `~/.pi/agent/`. Make `extensions/` a real dir holding one symlink per entry of
   `~/.pi/agent/extensions/` EXCEPT `lsp-exit`. `local-packages/rpiv-advisor` -> symlink to `/tmp/pi-update-1.5/rpiv-advisor`.
   COPY settings.json. Create npm/ with a copy of `~/.pi/agent/npm/package.json` with the target ranges (keep
   allowScripts, keep permission-system at exactly 40.3.0), then `cd npm && npm i --no-audit --no-fund` (NOT
   `pi update --extensions`: it rewrites the permission-system pin). Record installed versions.
   The symlinked extension dirs are LIVE: do not write into them (logs they write themselves are fine).

## Checks (real turns; `--no-session` unless the check needs a session file; `< /dev/null` always;
## `--model anthropic/claude-haiku-5-5` where the check allows; at most one advisor call)
a. Startup on Node 24 and on Node 26 (PATH=~/.local/node26/bin:$PATH): no extension load errors on stderr (pi 1.5
   may print "Extension Updates" changelog notices: report, not a failure); list which tools are active.
b. One main turn using read, bash, edit (scratch file under /tmp/pi-update-1.5/), lens_diagnostics (source lsp) and
   lsp_navigation (hover or documentSymbol) on a small .ts file, and todo (create + update). pi-lens must work: no
   handler errors, diagnostics returned. Time how long `P -p` takes to exit after its last assistant message (lsp-exit
   is not loaded: must be a few seconds, not minutes).
c. Sub-agents: a foreground Explore call, a background builder (`run_in_background: true`) + get_subagent_result,
   and one `resume` of a finished agent. Check each child's session JSONL: model, no errors.
d. One advisor call; check details.advisorModel, that the advice came back in the "Recommendation: / Why: / ..."
   format (our prompt), and that the process exits promptly afterwards.
e. The find-gaps runner's form: `P -p --model anthropic/claude-haiku-5-5 --thinking low --tools read,grep,find,ls,bash
   --append-system-prompt <file> --session-dir <dir> "<prompt>"`; check the JSONL still has message.usage
   (input, output, cacheRead, cacheWrite, cacheWrite1h, cost.total), toolCall/toolResult, stopReason.
f. Permission policy: `rm -rf a b` style multi-arg delete still denied; `ls -la ~/.pi/agent/auth.json` via the bash
   tool still denied (never cat it).
g. cache-ttl: a top-level session's Anthropic writes are 1 h (`cacheWrite1h` > 0); with PI_CACHE_TTL_MAIN=5m none.
h. compact-at: force compaction with PI_COMPACT_AT_TOKENS=8000 in a session that grows past it; compaction happens,
   the next turn works.
i. bg-bash: a `background: true` bash command delivers its completion; auto-continue does not misfire.
j. hide-tools: resume a session (`--session <file>`) and compare active tools before and after;
   `pi_lens_activate_tools` must stay hidden.
k. Payload: run one turn with `-e ~/pi-lab/update-lab/wire-probe.ts` and `WIRE_PROBE_OUT=/tmp/pi-update-1.5/wire.jsonl`.
   From the request body report: the tool names; for todo, lens_diagnostics and lsp_navigation their property names
   (todo must not have `tasks`); any property in those three that is NOT in tool-trim's drop/params lists
   (`~/.pi/agent/extensions/tool-trim/index.ts` TRIMS) and is new versus pi-lens 4.4.4 (`~/.pi/agent/npm/node_modules/pi-lens`).
   Also: total system-prompt length, and do the same probe with the LIVE pi 1.4.0 (`pi`, live agent dir, same
   prompt, `--no-session`) and report the system-prompt diff in a few lines (1.5.0 "tightened system prompt").
l. grep the 1.5.0 dist for the event names our extensions use and say whether each still exists:
   context_with_system, agent_before_settle, agent_settled, session_switch, before_provider_request, tool_call,
   session_start, session_shutdown, context. And confirm `dist/core/extensions/loader.js` exports
   `clearExtensionCache` (ext-fresh needs it for pi-web).
m. pi-web 0.15.0: `npm i --prefix /tmp/pi-update-1.5/web @agegr/pi-web@0.15.0 --no-audit --no-fund` and report which
   pi-coding-agent version it resolves; do not start it.

## Hard rules
- Do not modify `~/.npm-global`, `~/.pi/agent` (except logs extensions write on their own), `~/.agents/skills`,
  `~/bin`, systemd units, `~/projects/`. Do not restart services.
- Never read or print secrets: auth.json, `~/.config/pi-web/env`, `~/.config/gh/hosts.yml`, env.sh keys.
- `rm -rf` with several arguments is denied: delete one directory at a time.
- When a check fails, find the cause (file:line) and prepare a fix as a patched copy plus .diff under
  /tmp/pi-update-1.5/fixes/; do not apply it live.

## Report (at most ~600 words)
Per check: command, evidence (output line or JSONL field), verdict (works / breaks / unknown). Installed versions.
Prepared fixes. Cost of your test turns if you can read it from the JSONL.
