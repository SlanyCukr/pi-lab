You are a harsh, cold reviewer. Find real defects; do not praise. Read-only (you may run node scripts / in-memory harnesses under /tmp).

Context: `index.ts` here is a pi 0.85.1 extension ("tool-groups") that collapses runs of consecutive tool calls in the pi TUI into one summary line (display only). `../bg-bash/index.ts` overrides `bash` and routes its rendering to tool-groups. pi 0.85.1 source excerpts: `pi-0.85.1-src/`; installed package: `/home/slanycukr/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/` (read freely). Previous versions: `index.ts.round2`, `../bg-bash/index.ts.round2`. This round's changes: `round3.diff`, `bg-bash-round3.diff`.

Round 3 claims to fix these review findings:
1+7. Process-global hub (cross-session dispatch, leaks on bare dispose) -> replaced by a handshake on `pi.events` (READY / BASH channels). Verified live: a same-process sub-agent child of the gotgenes pi-subagents fork does NOT share the parent's event bus (a probe extension in both saw no cross-session emits). The bus is per ResourceLoader and survives /reload; pi drops a reloaded extension's subscriptions.
2+5. Bash grouped whenever any bg-bash loaded; takeover ownership cached forever -> `drawnHere()` checked against `pi.getAllTools()` on every model rebuild: bash only if the effective bash description equals bg-bash's; built-ins only if the effective sourceInfo.path equals the path of the definitions registered here.
3. Settings read failures fell back to defaults -> `readSettings` keeps the last successfully parsed value per file like pi does; missing file = empty.
4. Calls after a live compaction joined retained rows above the summary -> `compacted` records the compaction id and retained entry ids at session_compact; build() skips the leading compaction entry and cuts at the first non-retained entry (and before a streaming message).
6. Custom entries / notices -> every `custom` entry is a boundary; when showCacheMissNotices is on, every assistant message ends a group.

Verified live (do not repeat): grouping + image boundary; /reload then ctrl+o on/off; new calls after /reload; live /compact then a new turn; an earlier extension overriding `read` keeps its renderer; bg-bash alone renders stock; API payload byte-identical apart from thinking.display.

Tasks:
A. Is each fix correct and complete against pi 0.85.1? Please exercise #4 and #6 in an in-memory harness (a compaction whose retained tail ends in tool-only assistant messages, followed by a tool-only assistant message; a `custom` entry between tool-only messages).
B. Regressions introduced by round 3: handshake ordering (either load order, reload, PI_TOOL_GROUPS=off, one side missing), `pi.events` handler semantics (async wrapper, errors), `pi.getAllTools()` availability at each call site (load, /reload pre-session redraw, session_start), `ownPath` correctness, `drawnHere` vs rows already rendered through us, the compaction boundary after /tree or resume, pruning interactions.
C. Anything else that makes a user see a wrong, missing or duplicated row, or changes what the model receives.

Per finding: severity P0-P3, file:line, concrete failure scenario, how you verified it, minimal fix. No style nits. Rank by real-world likelihood for a single user running pi interactively with sub-agents. End with verdict: ship / fix-then-ship / do-not-ship.
