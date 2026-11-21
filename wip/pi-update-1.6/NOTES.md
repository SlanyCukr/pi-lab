# pi 1.5.0 -> 1.6.0 (2026-11-21): what changed and what we adjusted

Read: the changelogs of pi 1.5.1, 1.5.2 and 1.6.0, pi-web 0.16-0.18, pi-lens 4.4.12-4.5.1, pi-anthropic-auth
3.4.5-3.6.0, pi-web-access 0.48.0 and pi-permission-system 41-42.2. Scratch test: `SPEC.md`, result `REPORT-scratch.md`.

## Versions

| Package | Before | After |
|---|---|---|
| `@earendil-works/pi-coding-agent` | 1.5.0 | 1.6.0 |
| `@agegr/pi-web` | 0.15.0 | 0.18.0 (pins pi 1.6.0) |
| `pi-lens` | 4.4.11 | 4.5.1 |
| `@gotgenes/pi-anthropic-auth` | 3.4.4 | 3.6.0 |
| `pi-web-access` | 0.47.0 | 0.48.0 |
| `@gotgenes/pi-subagents` | 25.0.5 | 25.0.5 (latest) |
| `@gotgenes/pi-permission-system` | 40.3.0 | 40.3.0 (pinned on purpose) |
| `rpiv-advisor` (local copy) | 2.15.0 | 2.15.0 (latest) |

## Changes that matter here

- **Anthropic message threads** (pi 1.5.1, on by default): after the first request of a session, a request sends
  only the new messages and the server continues from the previous reply. pi-anthropic-auth must be 3.4.5 or newer
  with it (3.4.4 would send continuations without the billing header); 3.6.0 sends threads with the header.
  Measured in the scratch test, 4 requests on Sonnet 5.5: request 1 `thread: create` with 12 tools, requests 2-4
  `thread: continue` with 2 messages, no tools and only the billing header as system; cache reads 8,321 / 8,469 /
  8,615 tokens; every write a 1 h one (cache-ttl still marks the new message); cost per request the same as 1.5.0
  ($0.0347 / 0.0028 / 0.0028 / 0.0015 against $0.0373 / 0.0029 / 0.0029 / 0.0016); a resumed session (`--session`)
  read 8,761 tokens from the cache. Off switch: `compat.supportsMessageThreads: false` in `models.json`.
  Not known: whether cache-ttl's divergence log still compares anything on a continuation (it sees 2 messages).
- **`cacheWarming` defaults to `"idle"`** (pi 1.5.1): pi may refresh a cache for up to 30 min between runs. Left at
  the default: cache-ttl answers `cache_warming_decision` with "stop" in the main session (1 h entries), a finished
  sub-agent's session is disposed (`agent-session.js:1088` cancels the warmer), and print mode exits.
  Not observed over time; watch for `Cache warmed` usage in main sessions.
- **find tool** (pi 1.6.0): a path pattern is now relative to the search directory (`src/*.ts` no longer matches
  `pkg/src/a.ts`; `**/src/*.ts` does). Explorers use find; watch its "no results" count in `tool-audit.py`.
- **Retries** (pi 1.6.0): "Connection closed." and bare socket errors (`ECONNRESET`, `EPIPE`, `ETIMEDOUT`) now retry.
- **`pi auth login <provider> [--no-browser]`** (pi 1.5.1): log in from a shell. The OpenAI login here is lapsed
  (`OAuth refresh failed for openai … invalid_grant`, 2026-11-21).
- **GPT-6.2 Sol and Astra** are in the catalog (pi 1.6.0); on `openai-codex` Sol has a 500K window.
- **pi-lens 4.5**: a blocker the agent cannot fix is repeated in full at most three times, then as one line; a file a
  bash script wrote gets its blockers like an edit; an unfinished check reads "unconfirmed", not "clean". No new
  parameters on `lens_diagnostics` or `lsp_navigation`, so tool-trim's lists stand.
- **pi-web 0.16-0.18**: a reply an extension wakes the session for (bg-bash) is its own turn, not folded into
  "Process details"; a background sub-agent's report reaches a busy parent at the next turn boundary; drafts survive
  a reload; per-tool switches in the tools menu; faster session search.
- **Breaking, checked, no change needed**: extension `render()` returns a read-only array (tool-groups builds a new
  array, `tool-groups/index.ts:121`); `session_switch` does not exist (already absent in 1.5.0; `hide-tools` also
  listens to `session_start`).
- **Not taken**: pi-permission-system 41 loosens `external_directory` asks; 42.x adds prompts for bash chains, which
  `yoloMode` never shows. The pin stays.

## Procedure

`switch.sh` (the loop stopped with `run.sh stop` first), then `switch-web.sh <delay>` last: it restarts pi-web from
a transient unit and installs 0.15.0 again when 0.18.0 does not answer (`web-verify.log`). Rollback: `rollback.sh`.
