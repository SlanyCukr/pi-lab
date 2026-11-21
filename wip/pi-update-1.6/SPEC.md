# Test the pi 1.5.0 -> 1.6.0 + extensions update in a scratch dir (do NOT change anything live)

Host: Raspberry Pi 5, user `loop`, shared with production. Keep load low (no parallel heavy jobs). Goal: prove, with
real pi turns, that the update works with our extensions, so the live switch is: install, copy package.json, verify.
Work only under `/tmp/pi-update-1.6/`. Already there: `prefix/` (pi 1.6.0 installed with
`npm i --prefix /tmp/pi-update-1.6/prefix @earendil-works/pi-coding-agent@1.6.0`) and `cl/` (changelogs).
Run the new pi as `/tmp/pi-update-1.6/prefix/node_modules/.bin/pi` (call it P). The live pi is `pi` (1.5.0).

## Current live state (read-only for you)
- pi CLI 1.5.0 in `~/.npm-global` (Node 24 at `~/.local/node`; the find-gaps loop runs pi on Node 26 at
  `~/.local/node26`). pi-web 0.15.0 runs its own nested pi 1.5.0; target pi-web 0.18.0 pins pi 1.6.0 exactly.
- Config dir `~/.pi/agent/`: settings.json, APPEND_SYSTEM.md, agents/*.md, prompts/, models.json, extensions/<name>/
  (own: arg-fixes, auto-continue, bg-bash, cache-ttl, compact-at, ext-fresh, hide-tools, lens-replay, model-check,
  tool-groups, tool-trim; plus extensions/pi-permission-system/config.json = the permission policy),
  local-packages/rpiv-advisor (2.15.0 + our prompt; unchanged by this update), npm/ (installed pi packages;
  package.json holds ranges + allowScripts). `PI_CODING_AGENT_DIR=<dir>` points pi at another config dir.
- Package targets: pi-lens ^4.5.1 (from 4.4.11), @gotgenes/pi-anthropic-auth ^3.6.0 (from 3.4.4), pi-web-access
  ^0.48.0 (from 0.47.0), @gotgenes/pi-subagents ^25.0.5 (unchanged), @gotgenes/pi-permission-system 40.3.0 (stays
  pinned exactly).
- What changed upstream and needs proof here (from the changelogs in `/tmp/pi-update-1.6/cl/`):
  1. pi 1.5.1: **Anthropic message threads** are on by default (a request with a session id sends only the new
     messages; full-request fallback when earlier context changes). pi-anthropic-auth 3.4.5 opted OAuth requests out,
     3.6.0 sends them as threads "with the billing header on every continuation". Our extensions rewrite the request
     in `before_provider_request` (cache-ttl: 1 h `cache_control.ttl` + a pinned system prompt + a divergence log;
     tool-trim: tool descriptions and params; lens-replay; pi-lens context injection). Unknown: do those rewrites
     still apply, and does the prompt cache still hit.
  2. pi 1.5.1: `cacheWarming` defaults to `"idle"` (was `"streaming"`). cache-ttl answers `cache_warming_decision`
     with "stop" in the main session; sub-agents keep pi's decision.
  3. pi 1.6.0: the find tool's path patterns are relative to the search directory.
  4. pi 1.6.0 breaking: extension components' `render()` returns `readonly string[]` (tool-groups has a `Lines`
     component and wraps stock `renderCall`/`renderResult`; bg-bash routes bash rendering through tool-groups).
  5. pi-lens 4.5.x: a write notice now names why a runner was skipped; a blocker is repeated in full at most three
     times; a file a bash script wrote gets its blockers like an edit. lens-replay reads pi-lens's retained findings.

## Setup
1. Scratch agent dir `/tmp/pi-update-1.6/agent/`: symlink auth.json (never read it), APPEND_SYSTEM.md, agents/,
   prompts/, models.json from `~/.pi/agent/`. Make `extensions/` a real dir holding one symlink per entry of
   `~/.pi/agent/extensions/`. `local-packages` -> symlink to `~/.pi/agent/local-packages`. COPY settings.json.
   Create npm/ with a copy of `~/.pi/agent/npm/package.json` with the target ranges above (keep allowScripts, keep
   permission-system at exactly 40.3.0), then `cd npm && npm i --no-audit --no-fund` (NOT `pi update --extensions`:
   it rewrites the permission-system pin). Record the installed versions.
   The symlinked extension dirs are LIVE: do not write into them (logs they write themselves are fine).
2. Every P run uses `PI_CODING_AGENT_DIR=/tmp/pi-update-1.6/agent`, `< /dev/null`, and `cd /tmp/pi-update-1.6/work`
   (create it) so no project config applies.

## Checks (real turns; `--no-session` unless the check needs a session file;
## `--model anthropic/claude-haiku-5-5` where the check allows; no advisor calls)
a. Startup on Node 24 and on Node 26 (`PATH=~/.local/node26/bin:$PATH`): no extension load errors or warnings on
   stderr (quote any line that is not a changelog notice); list which tools are active.
b. One main turn using read, bash, edit (a scratch .ts file under /tmp/pi-update-1.6/work/), lens_diagnostics
   (source lsp) and lsp_navigation (documentSymbol). No handler errors, diagnostics returned. Time how long `P -p`
   takes to exit after its last assistant message (must be a few seconds).
c. Sub-agents: a foreground Explore call, a background builder (`run_in_background: true`) + get_subagent_result.
   Check each child's session JSONL: model (`claude-sonnet-5-5`), thinking level, no errors.
d. **Threads and the prompt cache (the main risk).** With `-e ~/pi-lab/update-lab/wire-probe.ts` and
   `WIRE_PROBE_OUT=/tmp/pi-update-1.6/wire-<name>.jsonl`, run ONE session of 4+ model requests (a prompt that needs
   three separate bash calls, one per turn) on `anthropic/claude-sonnet-5-5`, with a `--session-dir`. Report, per
   request, from the probe: is there a `thread` (or similarly named) field, how many `messages` the body carries,
   whether `system` and `tools` are present, the `cache_control` blocks and their `ttl`, and from the session JSONL
   the usage per assistant message: input, cacheRead, cacheWrite, cacheWrite1h. State plainly: (1) are threads in
   use under our OAuth login; (2) does request 2+ read the cache (cacheRead > 0 and input small); (3) are main-
   session writes still 1 h (`cacheWrite1h` > 0); (4) are tool-trim's short descriptions still what is sent (compare
   one tool description with the live pi 1.5.0 payload from the same probe run with `pi`, live agent dir); (5) does
   `~/.pi/agent/extensions/cache-ttl/divergence.jsonl` get new lines that report a divergence at `system` or
   `tools` during this session (a real problem) or only at the newest message (normal).
   Then run the same 4-request session with the LIVE pi 1.5.0 (`pi`, live agent dir) and put both usage tables side
   by side (total input, cacheRead, cacheWrite, cost.total per request).
   Then continue the 1.6.0 session with `--session <file>` for one more turn: does the cache still hit (lens-replay,
   resumed thread)?
   If threads break caching or a rewrite: repeat the 1.6.0 run with a models.json copy (scratch agent dir only) that
   sets `compat.supportsMessageThreads: false` for the anthropic provider/model (see
   `prefix/node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md`) and report that table too.
e. The find-gaps runner's form on Node 26: `P -p --model anthropic/claude-haiku-5-5 --thinking low --tools
   read,grep,find,ls,bash --append-system-prompt <file> --session-dir <dir> "<prompt>"`, the prompt given on stdin
   too in a second run (`P -p ... < promptfile`; the runner pipes the prompt since 2026-11-20). Check the JSONL still
   has message.usage (input, output, cacheRead, cacheWrite, cacheWrite1h, cost.total), toolCall/toolResult,
   stopReason, and the first entries `model_change` and `thinking_level_change`.
f. Permission policy: a multi-argument `rm -rf a b` is still denied; `ls -la ~/.pi/agent/auth.json` via the bash
   tool is still denied (never cat it).
g. cacheWarming: read how 1.6.0 decides (docs/settings.md, docs/models.md "Prompt Cache Lifetimes", and the dist
   code for `cacheWarming`/`cache_warming_decision`). Answer: with the default `"idle"`, in which process modes can
   an idle warm fire (interactive, RPC, print)? Does it fire for a finished sub-agent's session? What does our
   cache-ttl "stop" answer do in idle mode? Recommend `"idle"` or `"streaming"` for this setup, with the evidence.
h. compact-at: `PI_COMPACT_AT_TOKENS=8000` over RPC (see `~/pi-lab/wip/bg-bash/rpc-run.sh` for the RPC form; use P
   and the scratch agent dir) in a session that grows past it: compaction happens or reports "Nothing to compact",
   and the next turn works. Also `node ~/pi-lab/wip/compact-at/test-size.mjs` (unit, no pi needed).
i. bg-bash: over RPC, a `background: true` bash command (`sleep 8; echo woke-ok`) delivers its completion and the
   model answers it; auto-continue does not misfire.
j. hide-tools and lens-replay: resume a session (`--session <file>`) and compare active tools before and after;
   `pi_lens_activate_tools` must stay hidden. `node ~/pi-lab/wip/lens-replay/test.mjs` and the other unit tests that
   exist (`~/pi-lab/wip/{auto-continue,cache-ttl,ext-fresh,tool-trim}/test.mjs`): run each as its header says, once
   against the live setup and, where the test takes a pi or package path, against the scratch one. Report pass/fail.
k. Payload: from the check-d probe report the tool names; for lens_diagnostics and lsp_navigation their property
   names; any property that is NOT in tool-trim's lists (`~/.pi/agent/extensions/tool-trim/index.ts` TRIMS) and is
   new versus pi-lens 4.4.11; the find tool's description as sent; total system-prompt length for 1.6.0 and for
   live 1.5.0 and a few-line diff of the two system prompts.
l. grep the 1.6.0 dist for the hook names our extensions use and say whether each still exists:
   agent_before_settle, agent_end, agent_settled, agent_start, before_agent_start, before_provider_request,
   cache_warming_decision, context_with_system, input, message_end, message_start, message_update,
   session_before_compact, session_compact, session_shutdown, session_start, session_switch, session_tree, tool_call,
   tool_execution_end, tool_execution_start, tool_result, turn_end. Confirm the loader still exports
   `clearExtensionCache` (ext-fresh needs it in pi-web). Check tool-groups against the `render()` change: does any
   of our code modify an array returned by a stock component's `render()` in place (file:line)?
m. pi-web 0.18.0: `npm i --prefix /tmp/pi-update-1.6/web @agegr/pi-web@0.18.0 --no-audit --no-fund` and report which
   pi-coding-agent version it resolves and whether that copy's loader exports `clearExtensionCache`; do not start it.
n. pi-lens 4.5.1 output size: in the check-b turn, quote in full what pi-lens appended to the edit result and the
   write result (the "why it was not checked" notice is new). Is it longer than under live 4.4.11 for the same edit?

## Hard rules
- Do not modify `~/.npm-global`, `~/.pi/agent` (except logs extensions write on their own), `~/.agents/skills`,
  `~/bin`, systemd units, `~/projects/`. Do not restart services. Do not stop or signal any process you did not start.
- Never read or print secrets: auth.json, `~/.config/pi-web/env`, `~/.config/gh/hosts.yml`, env.sh keys.
- `rm -rf` with several arguments is denied: delete one directory at a time.
- When a check fails, find the cause (file:line) and prepare a fix as a patched copy plus .diff under
  /tmp/pi-update-1.6/fixes/; do not apply it live.
- A check you could not run is reported as "not run" with the reason, never as passed.

## Report
Write the full report to `/tmp/pi-update-1.6/REPORT.md` and return at most ~700 words: per check the command,
the evidence (an output line or a JSONL field with its value) and a verdict (works / breaks / unknown / not run);
the installed versions; prepared fixes; the cost of your test turns from the JSONL files.
