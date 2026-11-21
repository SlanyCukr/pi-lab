# pi 1.6.0 update test (scratch /tmp/pi-update-1.6, nothing live changed)

Installed in scratch: pi 1.6.0, pi-lens 4.5.1, pi-anthropic-auth 3.6.0, pi-web-access 0.48.0, pi-subagents 25.0.5, permission-system 40.3.0 (pinned). Live: pi 1.5.0, pi-lens 4.4.11.
Test cost (session JSONL, incl. sub-agents): $0.143 + a few cents of --no-session/RPC haiku runs.

| Check | Verdict |
|---|---|
| a Startup Node 24 + 26 | works: rc=0, stderr empty on both (`a24.err`, `a26.err`). Tools active at session_start (1.6): read bash edit write schedule_wakeup loop web_search source_check fetch_content get_search_content web_enable lens_diagnostics pi_lens_activate_tools lsp_navigation advisor subagent get_subagent_result steer_subagent. New vs 1.5: source_check, get_search_content (pi-web-access 0.48). Sent on the wire: 11 tools + placeholder (Read Bash Edit Write web_enable lens_diagnostics lsp_navigation advisor subagent get_subagent_result steer_subagent), same as live 1.5. |
| b main turn | works: read/bash/edit/write/lens_diagnostics(lsp)/lsp_navigation all ran, no handler errors. Diagnostic returned `hello.ts:1:7 warning[typescript] (2322)`. Exit 0.3 s after the last assistant message (ts 13:37:01.485Z, process end 13:37:01.77Z). Haiku once sent `mode:"null"`, `path:"null"`, `severity:"null"` strings → validation error, retried fine (model quirk, same tool schema as live). |
| c sub-agents | works: Explore (thinking low) and builder bg (medium) both `claude-sonnet-5-5`, 0 errors; get_subagent_result returned; built.txt = "built". |
| d threads + cache | works, see below |
| e runner form Node 26 | works (arg and stdin runs, rc=0): first entries `session`, `model_change claude-haiku-5-5`, `thinking_level_change low`; assistant messages carry usage input/output/cacheRead/cacheWrite/cacheWrite1h/cost.total, toolCall + toolResult, stopReason toolUse/stop. Stdin run read 3236 tokens of cache from the arg run. |
| f permission | works: `Denied by policy: 'bash' (rule 'rm -rf /tmp/* /*')` (dirs a, b still exist); `ls -la ~/.pi/agent/auth.json` → `Denied ... 'path_read' ... (rule '~/.pi/agent/auth.json')`. |
| g cacheWarming | see below |
| h compact-at | works: RPC, PI_COMPACT_AT_TOKENS=8000: `compaction_end ... "Nothing to compact (session too small)"`, compact-at queued its "continue" message, next prompt answered `gamma`. test-size.mjs: all 7 passed. |
| i bg-bash | works: `Started in the background as bg1`; later `message_end custom bg-bash "Background command bg1 finished: exit code 0 ... woke-ok"`, assistant answered "bg1 finished with exit code 0 and printed woke-ok"; no extra/misfired turns. |
| j hide-tools, units | works: resumed d16 session sends the same tool list (equal), `pi_lens_activate_tools` absent in both. Unit tests, Node 24, live and (where a path is taken) live index.ts: compact-at 7 pass, lens-replay 11 pass, auto-continue pass, cache-ttl 12 pass, tool-trim 13 pass. cache-ttl test takes the pi from `command -v pi` (live 1.5.0), not scratch: not run against 1.6 pi-ai. ext-fresh test: FAILS on live setup, unchanged by this update: it touches `extensions/lsp-exit/index.ts`, removed 2026-11-09 (`touch: cannot touch`). A scratch copy against pi-web 0.18's loader loaded (A,B ran, "watching ... via /tmp/.../web/.../loader.js") but ext-fresh hard-codes `~/.pi/agent`, so the touch cases could not be tested without touching live files: not run. |
| k payload | works: no new properties. lens_diagnostics and lsp_navigation raw property lists identical for 4.5.1 and 4.4.11 (getAllTools). Sent: lens_diagnostics = source scope mode path waitMs severity paths; lsp_navigation = operation path line character symbol newName query exactMatch maxResults; descriptions byte-identical to live 1.5.0 payload (tool-trim applies). `find` is not in the default active set so no find description is sent in the main session (params unchanged: pattern path limit). System prompt: 12,625 chars (1.6) vs 13,857 (1.5). Diff: billing header cc_version 2.1.280.608 → 2.1.323.893; pi's default intro changed ("You are a coding assistant running inside pi..." → "You are an expert coding assistant. Be concise and helpful. Use the available tools... Show file paths clearly..."); the `<docs>` block (pi doc paths) is gone. |
| l hooks | works: all names exist in 1.6.0 dist/types EXCEPT `session_switch` (0 hits; also 0 in 1.5.0): only hide-tools registers it (`hide-tools/index.ts:15`), harmless, `session_start` covers it. clearExtensionCache exported (`dist/core/extensions/loader.js:94`). render(): tool-groups `Lines.render` (`tool-groups/index.ts:121`) returns a new array from `.map`; no in-place modification of a stock component's array anywhere in tool-groups/bg-bash (grep push/splice/sort: only on own state). Types accept it (`string[]` is assignable to `readonly string[]`). |
| m pi-web 0.18.0 | works: pins `@earendil-works/pi-coding-agent` 1.6.0 (package.json:54), resolves 1.6.0; its loader exports clearExtensionCache (loader.js:94). Not started. |
| n pi-lens output | works, shorter: edit result under 4.5.1 = "Successfully replaced 1 block(s) in ..." (nothing appended); write result = "Successfully wrote to ...\n\n\n⏳ Pending runners (reported at turn end): lsp". Live 4.4.11 same edit: edit plain; write ends "Pending runners ...: lsp, tree-sitter, ast-grep-napi, oxlint". The new "why a runner was skipped" notice did not appear in this case. |

## d. Threads and cache (sonnet-5-5, 4 requests, `wire-d16.jsonl`, `wire-d15.jsonl`; probe = copy `wire-probe2.ts` that also logs thread/cache_control)
1.6.0 requests (messages, thread, tools, system cache, tail cache):
1. 2 msgs, `thread:{type:create}`, 12 tools (1 with 1h), system 3 blocks (2 with ttl 1h), msg[0] 1h
2. 2 msgs, `thread:{type:continue, previous_message_id:msg_…}`, 0 tools, system = only the billing header block (85 chars), msg[0] 1h
3,4. same as 2.
Live 1.5.0: no thread field; messages 2,5,8,11; tools 12 every time; same 1h blocks.
Usage (input / cacheRead / cacheWrite(1h) / cost):
| req | 1.6.0 | 1.5.0 |
|1| 4 / 0 / 8321 (8321) / 0.0347 | 4 / 0 / 8982 (8982) / 0.0373 |
|2| 2 / 8321 / 148 (148) / 0.00282 | 2 / 8982 / 148 / 0.00288 |
|3| 2 / 8469 / 146 / 0.00282 | 2 / 9130 / 146 / 0.00289 |
|4| 2 / 8615 / 146 / 0.00152 | 2 / 9276 / 146 / 0.00159 |
(1) Threads in use under OAuth: yes (`thread.type` create/continue). (2) Yes: cacheRead 8321/8469/8615, input 2. (3) Yes: cacheWrite1h = cacheWrite on every request. (4) Yes: tool descriptions identical to live (no diff in any of 12 tools). Cost slightly lower (smaller prompt, -1.2k chars). (5) divergence.jsonl: no new line for sonnet-5-5 from my runs (only opus/fable lines from other processes, all systemChanged=false toolsChanged=false). So no divergence at system/tools; unknown whether cache-ttl's divergence log still compares anything on thread continuations (2-message bodies) — no evidence either way.
Resume (`--session`, `wire-d16r.jsonl`): request 1 sent 14 msgs with `thread:{type:create}`, all tools; usage input 4, cacheRead 8761, cacheWrite 30 → cache hit across processes; then continue. lens-replay did not break it.
supportsMessageThreads:false fallback: not needed, not run.
The 1.6 per-request system/tool trimming holds: continuation requests carry no tools; the 1h marker is on msg[0] (the thread head) for continuations.

## g. cacheWarming (`dist/core/cache-warmer.js`, `agent-session.js:743,1088`, `sdk.js:192,269`)
- Default is "idle" (`settings-defaults.js:60`). One CacheWarmer per AgentSession, started from the provider-request path (`sdk.js:269`) in any mode; timer is `unref`'d (`cache-warmer.js` schedule). Phase "streaming" while the agent runs; at `agent_settled` (`agent-session.js:743`) "streaming" mode stops, "idle" sets phase idle and keeps warming up to 30 min after start (`CACHE_WARMING_MAX_IDLE_AGE_MS`; 1 h max for streaming phase).
- Modes: interactive and RPC keep the process alive, so an idle warm can fire there. Print mode: process exits after the run and the timer is unref'd/disposed, so no idle warm in practice (not tested with a >5 min wait). Needs ≥$0.05 expected savings and a model cache lifetime.
- Finished sub-agent: pi-subagents disposes the child session (`lifecycle/subagent.ts:751,845`) and `dispose()` calls `cacheWarmer.cancel()` (`agent-session.js:1088-1090`), so no warm after it finishes. While it runs, pi's own decision applies (ours only stops the main session).
- Our cache-ttl `cache_warming_decision` → "stop" (`cache-ttl/index.ts:185`, only when TTL=1h and not a child): evaluated at the first scheduled refresh; `stop()` ends the run ("stopped by extension"). So in idle mode too, no warm requests are sent from the main session; idle mode changes nothing for us. Not exercised live (needs a wait past the delay).
- Recommendation: keep the default "idle" (nothing to change). If cache-ttl is ever removed or TTL is 5 min, "streaming" is the one that avoids idle refresh spend; with the stop answer both behave the same.

## Fixes prepared
None needed. Stale test (not a regression): `wip/ext-fresh/test.mjs` references removed `lsp-exit` (touch lines 20-27) — fix by pointing at another extension's index.ts; not prepared as a diff.

## Open
- ext-fresh live-behaviour (touch cases) not run; cache-ttl unit test not run against 1.6's pi-ai; divergence log behaviour on threads unknown; idle warm never observed over time.
- Stray automated pi-lens notices in this session named files outside this task (wip/review-replay/compare.py etc.); not acted on.
