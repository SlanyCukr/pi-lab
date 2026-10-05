You are a harsh, independent reviewer. Your job is to find real defects, not to praise. Read-only.

## What was built
A pi (coding-agent TUI, version 0.85.1) extension, `index.ts` in this directory, that collapses runs of consecutive file/shell tool calls in the transcript into one summary line like Claude Code ("Ran 3 commands, read 2 files"). Display only: the model's context, tools payload and execution must be unchanged. It re-registers whichever built-in tools (read/edit/write/grep/find/ls) are active at session start with pi's own definitions plus renderers (renderShell "self"); the first row of a group draws the summary, other rows render nothing (0 lines). ctrl+o (global tools-expanded) must show pi's exact stock rendering; clicking a summary lists the group's calls. It also rewrites Anthropic requests in the main session to `thinking.display: "omitted"`.
A companion change to another extension, bg-bash, is in `bg-bash-hook.diff`: it routes `bash` rendering through `globalThis[Symbol.for("pi.tool-groups")]` and sets a flag.

pi 0.85.1 source for the relevant parts is in `pi-0.85.1-src/` (tool-execution.ts = the row component; interactive-mode.ts = event handling, renderSessionItems, addMessageToChat; assistant-message.ts; renderers-index.ts = withBuiltInRenderers; session-manager.ts; ext-loader.ts / ext-runner.ts; anthropic-messages.ts; text.ts). extensions-doc-main.md is the extension API doc (from main, may be newer than 0.85.1 - trust the 0.85.1 source when they differ).

## Already verified live (do not re-litigate unless you can show a flaw in the method)
- History of a 900-message session renders grouped; ctrl+o output is byte-identical (ANSI included) to stock pi.
- Live run: 10 calls -> one line; running state; text between calls splits groups; failures counted.
- API tools array and system prompt byte-identical with and without the extension (real setup).
- Works alongside pi-lens (edit diagnostics) and a sub-agent child using overridden read/grep.

## What to hunt for (rank by severity, each with a concrete failure scenario and file:line)
1. Rows that stay hidden while their group's summary is missing or stale, or duplicate display (a call counted in a summary AND drawn separately), including: streaming order (message_update vs row creation), message_end before persistence, aborted/error turns, compaction rebuild, /tree navigation, session switch, /reload, resumed sessions, parallel tool calls, sub-agent sessions sharing the process (globalThis!).
2. Any way the tool override changes behaviour vs stock: execute/cwd, prepareArguments, options (autoResizeImages), tool activation, prompt text, ordering, file mutation queue, anything a second registration of a builtin name changes.
3. The thinking.display rewrite: wrong scope (children, compaction, advisor), cache or thinking-signature implications, preserved-thinking/history-edit rules on Fable 5.1.
4. Performance: work per streamed token / per event with 1000+ rows; memory growth of the maps.
5. Anything in the bg-bash diff that can break bash when tool-groups is absent, present, or loaded in a different order.
Skip style nits. For each finding say whether you verified it against the 0.85.1 source or it is a hypothesis. End with a one-line verdict: ship / fix-then-ship / do not ship.
