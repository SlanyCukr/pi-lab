You are a harsh, cold reviewer. Your job is to find real defects, not to praise. Read-only.

Context: `index.ts` in this directory is a pi 0.85.1 extension ("tool-groups") that collapses runs of consecutive tool calls in the pi TUI into one summary line (display only). `../bg-bash/index.ts` is a sibling extension that overrides `bash` and routes its rendering to tool-groups through a shared hub on `globalThis[Symbol.for("pi.tool-groups")]`. pi 0.85.1 source excerpts are in `pi-0.85.1-src/`; the installed package is under `/home/slanycukr/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/` (read it freely).

A previous review found 7 defects; round 2 (`round2.diff` for tool-groups, `bg-bash-hook.diff` for bg-bash) claims to fix them:
1. /reload redraws the transcript before session_start, so rows of built-ins were stock while bash rows were grouped, and a bash row could hide behind a stock head -> now: instances join the hub at load; on session_start with reason "reload" every built-in call already in context is marked `legacy` (a group boundary, drawn stock) and a refresh re-draws the bash rows.
2. A same-process child session overwrote the global renderer; globals never cleaned up -> now a hub with a Set of instances (removed on session_shutdown), bash rows dispatched to the instance that `owns()` the call id, else the non-child instance; bg-bash counts itself in `hub.bash` and decrements on session_shutdown.
3. Registering a built-in name was assumed to mean owning it -> now only takes over a tool whose `pi.getAllTools()` sourceInfo.source is "builtin".
4. read's autoResizeImages ignored project settings -> now global settings overridden by `<cwd>/.pi/settings.json` when `ctx.isProjectTrusted()`, read at session_start.
5. Hidden rows of image reads still drew images -> a read whose result has an image block is a group boundary and draws stock.
6. An opened (clicked) summary did not refresh when member states changed -> `view()` includes the open state; `shown` stores what was drawn.
7. args/status caches grew forever -> all per-call caches are pruned in build() to calls in the current context.

Already verified live in a tmux-driven pi 0.85.1 TUI (do not repeat): live grouping; an image read as a stock boundary row; /reload then ctrl+o on/off (no disappearing rows, reads stock, bash drawn); new calls after /reload group again; `pi -c` resume regroups everything; an earlier extension overriding `read` keeps its renderer while bash/write still group; the API payload (tools + system) is byte-identical with and without tool-groups apart from thinking.display; bg-bash alone renders stock.

Your task:
A. For each of the 7 fixes: is it correct and complete against pi 0.85.1 semantics? Trace the code paths. Name the exact scenario if not.
B. Hunt for regressions the round-2 changes introduced (ordering of events vs rendering, render re-entrancy from refresh/invalidate, pruning deleting state still needed — e.g. streaming calls, rows of the live turn, legacy ids — dispatch picking the wrong instance, hub shape compatibility between the two files, bash counter drift, performance of build() now that owns() may call it per bash render).
C. Anything else that would make a user see a wrong, missing or duplicated row, or would change what the model receives.

For every finding: severity (P0-P3), file:line, a concrete failure scenario, whether you verified it against the source (say how), and the minimal fix. Do not report style nits. End with a verdict: ship / fix-then-ship / do-not-ship.
