# pi setup and extension survey, 2026-09-17

Log of the user's pi setup: what is installed, why, and what was tried.

## Current setup (as of 2026-10-15, pi 1.2.0)

This section is the source of truth; the sections below explain how it got here.

**On the Pi (`loop` user, since 2026-10-04)** the table's laptop setup differs: Explore and the reviewer run on `openai/*` (pi stores the ChatGPT login as `openai`), the advisor on `anthropic/claude-fable-5-1` (2026-10-17); Z.AI only in the loop's sessions (`ZAI_API_KEY` from its env.sh enables a project copy of `explore-glm`, 2026-10-18), elsewhere `explore-glm` is off; no local Gemma, no desktop notifications. ImageMagick 7 (trixie debs unpacked without root) is in `~/.local/opt/imagemagick`, wrapper `~/bin/magick` (needed by the runner's screenshots and the stub tests). See `AGENTS.md` "This copy".

| Role | How it is wired |
|---|---|
| Default main session | `anthropic/claude-opus-5-5`, thinking `high` (user's choice after the 2026-09-22 effort A/B), direct login through `@gotgenes/pi-anthropic-auth` 3.4.2 (no version pin; see AGENTS.md) |
| Explorer sub-agent `Explore` | `openai-codex/gpt-5.6-luna`, thinking low, read/grep/find/ls; the main session delegates exploration to it (GPT-6 Luna reverted 2026-09-22: 11/15 vs 15/15) |
| Explorer alternative `explore-glm` | `zai/glm-5.3`, same rules, for parallel fan-out |
| Reviewer sub-agent `reviewer` | `openai/gpt-6.1-sol`, thinking high, read/grep/find/ls/bash |
| Builder sub-agent `builder` | `anthropic/claude-opus-5-5`, thinking medium, edit tools + pi-lens diagnostics/LSP |
| Advisor tool | `anthropic/claude-fable-5-1` (Claude subscription), effort high, `~/.config/rpiv-advisor/advisor.json` |

Packages (`~/.pi/agent/settings.json`, since the 2026-10-15 switch to pi 1.2.0): `@gotgenes/pi-anthropic-auth` 3.4.2, `@gotgenes/pi-subagents` 23.4.0 (tool `subagent`; stops a sub-agent at `max_turns`),
`@gotgenes/pi-permission-system` 40.2.1 from npm (our #962 fix upstream since 33.1.0; 40.x also matches an absolute rule against a relative path, hence six work-tree `rm -rf` allow rules), `@juicesharp/rpiv-todo` 2.13.8,
`pi-web-access` 0.41.0, `pi-lens` 4.4.3, and the patched advisor `~/.pi/agent/local-packages/rpiv-advisor` (upstream 2.13.8, which strips tool declarations for pi ≥ 1.0, plus our session-id cache fix for rpiv-mono#236, WebSocket cleanup and prompt edit; diffs, switch and rollback scripts in `wip/pi-update-1.2/`).
`~/.pi/agent/npm/package.json` `allowScripts` (npm 11): `@ast-grep/cli`, `esbuild` allowed (install or check their binaries); `protobufjs`, `@google/genai`, `tree-sitter-bash` denied (no-op, warning only, or a prebuilt linux-arm64 binary).
Global npm packages: `npm i -g --prefix ~/.npm-global …`. A bare `-g` from a pi-web shell installs into `~/.local/node`, first on the units' PATH but not in `pi-web.service`.
`settings.json` also: `"shellCommandPrefix": "unset NODE_ENV"` (pi-web's Next.js server sets `NODE_ENV=production`, and every bash command inherited it); retry `{"enabled": true, "maxRetries": 8, "baseDelayMs": 3000}` (12.7 min of backoff); `warnings.anthropicExtraUsage: false`.

Own extensions in `~/.pi/agent/extensions/` (dev copies in `~/pi-lab/wip/`):
- `bg-bash`: background bash, sub-agent hand-off, `monitor: true`/`persistent` watches, `/loop` + `schedule_wakeup` + `loop` tool, pi-web liveness hold; `pi-bg-wait`/`pi-bg-stop` at the start or end of a `&&`/`;` chain run in order, `&&` honoured (`index.ts`, `loop.ts`, `mixed.ts`).
- `cache-ttl`: 1 h prompt cache, main session. Its wake-up system-prompt pin is inactive on pi 1.2.0 (fixed there). Since 2026-10-16 it folds mid-conversation system messages into one head, so a pi-lens `context` injection after a tool change no longer flips the prompt (`PI_SYSTEM_FOLD=0` off; test `node wip/cache-ttl/test.mjs`).
- `compact-at`: compact at 40 %. `hide-tools`: hides `pi_lens_activate_tools`.
- `arg-fixes`: drops `"null"` placeholders in `subagent`, `todo` and `lens_diagnostics` free-text args; decodes `\uXXXX` escapes in `edit` text the file does not contain; blocks `edit`/`write` text with a stray control character (e.g. backspace); repairs a carriage return before `uXXXX` (an escape whose backslash was eaten).
- `auto-continue`: on in interactive pi; an offer ending gets "go with your pick", read-only after a question, ≤ 3 per message; `/auto off`, `PI_AUTO_CONTINUE=manual|0`.
- `tool-groups`: collapsed tool rows, thinking display omitted; marks `edit`/`write`/`read` sequential, so a message with one runs its calls in order.
- `tool-trim`: short tool descriptions, unused optional params hidden, "Available tools:" list and pi-lens skills dropped in Anthropic, Codex, chat and (since 2026-10-15) OpenAI Responses requests; `PI_TOOL_TRIM=0` off; test `node wip/tool-trim/test.mjs`.
- `pi-permission-system/config.json`: allow by default, `yoloMode: true`, deny dotenv files, `~/.ssh`, the pi and Codex credential files, `rm -rf` outside `/tmp`.

Other config: `~/.pi/agent/APPEND_SYSTEM.md` (ADHD style, lean since 2026-09-24; dev copy `wip/token-audit/APPEND_SYSTEM.lean.md`), `~/.pi/agent/agents/*.md` (`general-purpose`/`Plan` off via `enabled: false`), `~/.agents/skills/` (diagnose, grill-me, desloppify, find-gaps; the rest in `~/.agents/skills.disabled/`),
`~/.pi-lens/config.json` (trimmed tools, hidden widget), `.pi-lens.json` in `~/pi-lab` and `~/Documents/personal/projects` (style-only rules off, `backup-*` ignored; copy `wip/token-audit/pi-lens.shared.json`), `~/.config/rpiv-todo/config.json`, `~/.pi/agent/web-search.json` (`source_check`, `get_search_content` off; `webSearch.allowedProviders: [openai, exa]`), prompt template `~/.pi/agent/prompts/deeper.md` (`/deeper <task>`, 2026-10-16).

Public repo: `~/pi-lab` is `github.com/SlanyCukr/pi-lab` (since 2026-10-05; no loop, no session data). Portable copy `pi-kit/`: `export.sh` snapshots this setup, `install.sh --sub copilot|codex|openai` installs it, `server/` installs a headless host, `box/` has a Docker image and a credential-free test. See its README and "Decisions: portable kit".

Browser UI: `@agegr/pi-web` 0.12.1 (bundles pi 1.2.0; 0.9.3 bundled pi 0.87.1, so web sessions lagged the CLI until 2026-10-15), user service `~/.config/systemd/user/pi-web.service` on `127.0.0.1:30141`,
public through a Cloudflare tunnel since 2026-10-04 (URL in `AGENTS.override.md`, not in git); password in `~/.config/pi-web/env`. See "Decisions: pi-web".
find-gaps loop and its run page (board): user units on the Pi; host details in `AGENTS.override.md`. Setup: `wip/find-gaps/DESIGN.md` (not in git).

Lab tool: `pi -e ~/pi-lab/update-lab/wire-probe.ts` with `WIRE_PROBE_OUT=/tmp/wire.jsonl` logs each Anthropic request body (no headers); diff two runs for prompt-cache changes.

Removed since the original install: `@vanillagreen/pi-claude-bridge`, `@tintinweb/pi-subagents`, `pi-workspace-history`, `@plannotator/pi-extension`, the hand-rolled `plan-billing` extension (archive deleted), `gsd-pi`.

## Open items

Reviewed 2026-09-23.

1. **Upstream, waiting:** rpiv-mono#236 (advisor cache key) and gotgenes/pi-packages#962 (tool list relocation on pi ≥0.86); local patches cover both, notes next to them in `wip/`. Drop each local patch when its fix ships: switch the settings entry back to `npm:` and delete the local copy.
2. The `context7` docs tool went away with the old extension and nothing replaces it; `web_search`/`fetch_content` cover docs lookups.
3. Note, not a to-do: the `reviewer` agent is deliberately not isolated, so the permission policy applies to its bash tool. Explorers are isolated and have no bash.
4. **pi-lens hang (#4554, closed 2026-10-17):** fix #4563 ships in the release after 4.4.3. Update then; baseline 17 of 62 loop cycles hung (`did not exit within` in runner.log, 10-15..10-18).

Closed 2026-09-23: usage check (fine), backup deleted.

## How to work here (gotchas)

- Docker on the host (2026-10-06): 29.6.1's buildkit (v0.31.1) crashed dockerd mid-build (`concurrent map iteration and map write`, moby/buildkit#6915); `restart: unless-stopped` containers stayed down 1.5 h. Fixed by Docker 29.8.2 (buildkit v0.33.1) and `"live-restore": true` in `/etc/docker/daemon.json`. The loop's unit is transient: `~/.config/systemd/user/find-gaps-boot.service` restarts it after a reboot unless runner.log ends with "run end".
- The ISP caps concurrent connections per line (2026-10-05): over the cap, new connections get ICMP "administratively prohibited" ("no route to host", errno 113) from inside the ISP. Headroom ~300–640 connections; a torrent client's half-open attempts used ~100–140 (seeding stopped). Bursty GitHub or scraping failures: check this first.
- Long prod jobs: one at a time, each in its own `docker compose run --rm --no-deps -T worker …` container, with find-gaps pushes held (`hold-push`). In the live worker (512 MiB) three backfills OOM-killed it; three parallel fetchers failed ~35% of new connections upstream (0% with one) (2026-10-05).

### Running pi
- `pi -p` from a script or background shell needs `< /dev/null`, or it blocks forever.
- Test runs: `--no-session`, or trash the test session folders; else they show in `pi -r` and pi-web.
- `pi -ne` drops all packages, the Anthropic auth one included; Anthropic then answers `400 Third-party apps now draw from your extra usage, not your plan limits`. No `-ne` for Anthropic runs.
- Each monitor event, loop tick or wake-up is a full turn re-reading the context: run long watches in a small session.
- `pi update --models` refreshes the model catalog (it added `gpt-6-luna`/`gpt-6-sol`).
- No SDK scripts that call `bindExtensions` again against Anthropic: two such requests got a ToS "reverse engineering" block. The CLI path is fine.

### Testing extensions
- Never develop inside `~/.pi/agent/extensions/` (children of live sessions load it at once); use `~/pi-lab/wip/<name>/`.
- Test a dev copy with a separate agent dir: `PI_CODING_AGENT_DIR=/tmp/mt/agent` with symlinks to the live `~/.pi/agent` and the one extension swapped. A project `.pi/settings.json` path exclusion does not reach user-level extensions.
- Two extensions registering `bash` make pi refuse to start ("Tool bash conflicts"). bg-bash owns `bash`: swap it, never add a second.
- Children do not load `-e` CLI extensions, only persisted ones.
- A bare `<active_agent>` substring check marks every session as a child (`APPEND_SYSTEM.md` contains it). Check `<active_agent name=` plus the `ask_parent`/`notify_parent` tools.
- Cache-sensitive changes: log `payload` in `before_provider_request` (`update-lab/wire-probe.ts`), diff, remove the probe.
- pi-subagents falls back silently when an agent's `model` has no login (fuzzy match, then the parent's model): a lapsed Codex login makes Explore run on Opus. Only the kit has a `model-check` warning.
- Run prompt A/B tests from a scratch copy, not `~/pi-lab`: a test session edited the live `REPORT.md` (2026-09-23).
- `SYSTEM.md` replaces only pi's opening line and the pi-docs block; tool list and Guidelines stay. A neutral opening passed a real Opus 5.5 turn (200, 2026-09-23).
- Sub-agent transcripts: `~/.pi/agent/sessions/<dir>/<parent-session>/tasks/*.jsonl`.
- Do not edit a bash script while it runs: bash reads scripts incrementally.

### npm and packages
- Global installs use the system node: `PATH=/usr/bin:/bin npm i -g …`, never fnm's.
- Local packages: `npm install --omit=dev --omit=peer`; without `--omit=peer` npm pulls a 520 MB second copy of pi.
- npm 11 skips install scripts not listed in `allowScripts` in `~/.pi/agent/npm/package.json`. After an update, `npm approve-scripts --allow-scripts-pending` in `~/.pi/agent/npm` should list none.
- `pi update` does not touch `~/.pi/agent/local-packages/`.

### Permission policy
- No literal `*` in the matcher; the last matching rule wins. `rm` rules: deny `rm -rf /*`, allow `rm -rf /tmp/*`, deny `rm -rf /tmp/* /*` and `rm -rf /tmp/* ~*`, deny `rm -rf ~*`.
- `rm -rf /tmp/a /tmp/b` is denied too: split it. `/tmp/../x` is not caught.
- Bash deny rules can be bypassed by quoting (`r""m`) or double spaces; path rules are the stronger guard.
- A tool that spawns its own shell (not `bash`) bypasses the bash rules: reject such packages.
- `yoloMode: true` auto-approves "ask" rules (sudo, force push, `reset --hard`, `git clean`, `timeout`/`env` wrappers); explicit denies hold.
- The `*.env` path rule also blocks `git ls-files --error-unmatch .env`.

### pi-web and secrets
- Restart pi-web from a pi-web session only detached: `systemd-run --user --on-active=30 systemctl --user restart pi-web` (a direct restart kills the session).
- Update: `PATH=/usr/bin:/bin npm i -g @agegr/pi-web@latest && systemctl --user restart pi-web`.
- systemd never reads `~/.zshenv`: pi-web env goes in the unit file or `~/.config/pi-web/env`.
- pi-web evicts a session after 10 min idle (`PI_WEB_IDLE_TIMEOUT_MS`); extensions hold it via the `Symbol.for("@agegr/pi-web/session-liveness/v1")` registry (bg-bash does).
- Never read or print `~/.pi/agent/auth.json`, `~/.config/pi-web/env`, `~/.codex/auth.json`. Pass the pi-web password to curl from inside `bash -c`.
- Missing todo panel in pi-web: reload. The `rpiv-todos` button is bottom-left, under the input.

### Config and context files
- Editing `settings.json` while pi runs is safe: pi re-reads it under a lock and merges only its own changes.
- pi loads `~/.pi/agent/AGENTS.md` (or `CLAUDE.md`), then one file per directory from cwd up to `/`, never below cwd. Never put an `AGENTS.md` in `~` or `~/.pi/agent/`.
- `/tmp/pi-bg-bash-*` log folders (one per process) outlive pi; `/tmp` is tmpfs, so a reboot clears them.

### pi-lens
- "Clean" means something only in a project that type-checks on its own (real `tsconfig.json`, `node_modules`).
- The first LSP run per project under-reports (`lsp cold`): run `lens_diagnostics mode=full` before claiming clean.
- In projects under `/tmp`, pi-lens writes a `.pi-lens-probe-home/` folder.
- `pi_lens_activate_tools` cannot be disabled in config (PILENS_CFG_0009); `hide-tools` hides it.
- Changing active tools mid-session is one full cache miss, even on Opus 5.5: `pi-permission-system` returns a full `systemPrompt` from `before_agent_start` (2026-09-24). Hiding a tool from session start is free.
- `rules.<id>.disable` and `ignore` work only in a project `.pi-lens.json` (found walking up, not reaching `~`; tested 2026-09-24). Files created by bash (`cp`, `mv`, redirects) count as new, so all their findings show.

## Decisions and why

### Models and roles
- **Main: Opus 5.5, high** (2026-09-22, replaced Fable 5.1): all effort levels passed the A/B, high won nothing measured ($0.23 vs $0.21 medium per task); the user chose it.
- **Builder: Opus 5.5, medium** (2026-09-22): vs Opus 5, 40 s vs 62 s, 4/20/0.2 vs 5/25/0.5 USD per M.
- **Explore: GPT-5.6 Luna, low** (2026-09-17, rechecked 09-22): 18–22 s, 15/15 hard test. GPT-6 Sol: 15/15 at half the tokens but scarce Codex allowance; Opus 5.5: 22/22 but Anthropic usage.
- **Exploration goes to `Explore`** (2026-09-22): Opus delegated 0 of 22 runs before the rule, 2/2 after; quick greps stay local.
- **explore-glm: GLM-5.3**, only when Codex is rate-limited. GLM-5.3-Flash invented line numbers (2 of 4); GPT-5.6 Terra: Luna's accuracy, more quota.
- **Reviewer: GPT-6 Astra, high** (2026-09-17): 4 of 5 real reviews found a real defect; $1–3, 2.5–5 min. GPT-6.1 Sol since 2026-10-17 (the user's pick).
- **No Sonnet 5.5** (2026-09-29, `wip/model-ab/RESULTS.md`): Explore 15/16 vs Luna 16/16; builder 2/4 vs Opus 4/4, missed edge cases. GPT-6 Luna explorer 14/16.
- **Codex allowance** (2026-09-22, Pro 5x per 5 h, estimates): Luna 1,250–10,000, Sol 70–700, Astra 25–225.

### Anthropic auth and billing
- **400s** (2026-09-18): pi's "Pi documentation" block made Anthropic treat requests as third-party; org overage is off, so they are refused, not billed.
- **`@gotgenes/pi-anthropic-auth`, not own `plan-billing`** (2026-09-18): it shapes every request, compaction included.
- **Auth 2.0.10 → 3.2.2, pin removed** (2026-09-23): 2.x supports only pi ≤0.85 and broke pi 0.87's prompt. A pin disables 3.x's automatic version raise and retry.
- **A 200 does not prove billing** (2026-09-22): Claude Code billing framing; the usage page looked fine 09-23. `warnings.anthropicExtraUsage: false` (09-18): printed every session.

### Prompt cache and context size
- **1 h cache TTL, main session** (`cache-ttl`, 2026-09-20): $75.50 of one session's $79.82 re-billing came from 5–23 min pauses; 1 h writes cost 2x base vs 1.25x.
- **`PI_CACHE_RETENTION` unset** (2026-09-20): it would move sub-agents to 1 h; bg-bash's 240 s hand-off keeps their 5 min cache warm.
- **Advisor session-id patch** (2026-09-17): repeat calls 0 → ~21k cached tokens, 0.21 → 0.025 USD.
- **No per-turn prompt rewrites**: payload byte-identical between turns (verified for `tool-groups`, `arg-fixes`, #962 patch). Built-in `cacheWarming` fired twice ever (09-23).
- **`compact-at` at 40 %** (2026-09-20): pi ignored `compaction.modelOverrides`; one `reserveTokens` cannot fit 1M and 272k windows. Inert in children and (since 09-28) print/JSON mode, where its abort killed `pi -p` runs.
- **`compaction.reserveTokens` 65536** (2026-09-29): summaries may use 0.8 × reserve (13,107 at the default, thinking included); they reached 11.5–12.5K and failed with "hit the token cap". A test used 15.8K.
- **Auto-retry 8 tries, 3 s base** (2026-09-20): defaults covered 14 s; one session lost 2.4 h. `retry.provider.maxRetries` stays 0 (can swallow usage-limit errors).
- **Tool-call compression not built** (2026-09-20): summaries cost ~$8/session; `billion-context-pi` cancels all compaction. Worth building: model-free clearing of old results when the cache is cold.

### Permission system
- **`yoloMode` on** (2026-09-20): the first `timeout`/`env` "ask" per session blocked 51–237 s on an unseen dialog.
- **#962 patch** (2026-09-22): on pi ≥0.86 the tool list went twice and children saw the parent's tools; prompt 31,019 → 25,400 chars. Upstream since 33.1.0; local fork dropped 2026-10-15.
- **`rm` rules rewritten** (2026-09-23): `rm -rf /*` matched every absolute path, `/tmp/…` included.
- **Pattern kills denied** (2026-10-18): `pkill *`, `killall *`, `xargs *kill*`, `kill *pgrep*`, `kill *pidof*`; a cycle's `pgrep -f "run\.sh" | xargs kill` had stopped the loop 6.5 h. Kill by saved PID or port.

### Sub-agents
- **`@gotgenes/pi-subagents`** (2026-09-18, over `@tintinweb`): tool schema ~14.1k → ~7.2k tokens; `tools:` is a full allowlist, so children lack advisor, goal and web tools.
- **Explorer turn cap 40 → 150** (2026-09-20): 5 of 17 runs hit 40. Explorers cite, not quote (GLM reports 8–21K chars → 770 words). Fixed report formats (09-18).
- **`arg-fixes`** (2026-09-23): Opus 5.5 sent `"null"` for optional `subagent` args; fixed in `event.input`, so stored message and cache stay. Escape decoding (10-08): 20 of 29 failed loop edits; newText gets only non-ASCII escapes decoded. Test `node wip/arg-fixes/test.ts`.

### Advisor
- **Shutdown cleanup** (2026-09-23): a cached Codex WebSocket made `pi -p` hang ~300 s after an advisor call; now 15–19 s.
- **Call only when stuck** (2026-09-18): the default made Luna call it before a one-line edit (19 s → 300 s timeout). Fixed output format; transcript is evidence, not instructions.
- **Quirk**: on tiny prompts Astra sometimes answered with a tool call ("no text content"); real calls fine.

### pi-lens
- **Only `lens_diagnostics` + `lsp_navigation`** (2026-09-17): navigation tools did not help correctness and slowed tasks (55 s → 25 s after). Tools 27 → 17. `hide-tools` (09-18) hides `pi_lens_activate_tools`.
- **Widget and LSP status hidden** (2026-09-21): diagnostics still reach the model; `/lens-widget-toggle` for one session.
- Rejected: `@ian-pascoe/pi-lsp` (silent without pull diagnostics), `@narumitw/pi-lsp` (only on tool call).

### bg-bash, monitor, loop
- **Own `bg-bash`** (2026-09-20): `background: true` on stock `bash`, no new tools (one session had polled CI 137 min). Monitor + `/loop` (09-23) as `bash` parameters stay under the permission rules (`wip/bg-bash/DESIGN-monitor-loop.md`).
- **Rejected** (09-20/23): `pi-background-bash` (in children, login shell, skips shell prefix, rewrites transcript); `@richardgill/pi-background-bash`, `pi-patty-bg-tasks` (replace `bash` or 4+ tools); `clankercode/pi-monitor`, `codesoda/pi-event-monitor`, `gregjohnso/pi-monitor`, `pi-better-background-tasks` (own `sh -c`; racy `steer` + `triggerTurn`).
- Residual: a job ending between prompt submit and bg-bash's `input` handler can make pi reject the prompt ("Agent is already processing").

### pi-web
- **`@agegr/pi-web`** (2026-09-22): browser UI on the same sessions, localhost only, behind a tunnel; password only, no Cloudflare Access (user's choice).
- **`shellCommandPrefix: "unset NODE_ENV"`** (2026-09-23): Next.js's `NODE_ENV=production` made `npm ci` skip devDependencies.
- **T3 Code dropped** (2026-09-22): no Pi provider in stable; the preview cannot resume Pi threads (t3code#12467).

### Prompt and system-append tuning
- **ADHD style append** (2026-09-18): copied from the user's claude-config; children inherit it, `# Scope` exempts them. Skills 18 → 3 (7.4 → 3.1 KB); caveman out (fought the style).
- **Working rules** (2026-09-18, Fable 5.1 guide): top corrections in 694 messages were "continue" (57), "verify" (37). Instruction boundary (09-20): a pasted recap was taken for a tool message.
- **`edit`, not bash** (2026-09-20): 33 heredoc rewrites in one session, 0 in the replay. Todo tool `rpiv-todo`, not plan files (09-20); not for sub-agents.
- **Opus 5.5 edits** (2026-09-22): delegation, scope rule, corrections only when they matter; no thinking or verification instructions (Opus over-verifies).
- **Output length** (2026-09-23): "Response style" plus a final-message shape (outcome, detail, `Open:` ≤ 3 lines, next action; ~8 lines). `style-reminder` tried, removed (`wip/style-reminder/`).
- **Tool definitions** (2026-09-23): 29.5K → 13.1K chars (`web_search` allowlist, built-in agents off, `tool-trim`); 4 tool-heavy A/B tasks pass.
- **Token efficiency** (2026-09-23, `wip/token-audit/`): baseline week $544, 47 % cache writes. Lean append (09-24, 19.0K → 7.7K chars): A/B 35/35, −26 % per task, tool errors 0.40 → 0.17.
- **`auto-continue`** (2026-09-26): 40 of 212 user messages were "continue" nudges. Replay eval 09-30 (`wip/pi-eval/RESULTS.md`, 36 points): append rewrites gained nothing; auto-continue 68→85% train, 71→79% test, 0 worse.
- **`find-gaps` skill** (2026-09-26/28, `wip/find-gaps/DESIGN.md`): multi-day autonomous run in a `<repo>.find-gaps` worktree; a review per commit, a skeptic per finding. Board: own server, pi-web's cookie.
- **`pi-goal` removed** (2026-09-23; picked 09-18 over `@recynie/pi-goal`, `pi-supervisor`): self-graded completion; tools never called in 169 sessions.

### UI
- **`tool-groups`** (2026-09-21): consecutive tool calls draw as one line, ctrl+o expands; payload byte-identical; `PI_TOOL_GROUPS=off`.
- **Thinking display omitted** (2026-09-21): still billed; advisor and compaction lose thinking summaries. `PI_THINKING_DISPLAY=summarized` restores it.

### Portable kit
- **`pi-kit` with Copilot sub-agents** (2026-09-23): same `gpt-5.6-luna`/`gpt-6-astra`, so the swap is placeholders; a real turn needs a GitHub login; Astra needs Copilot Pro+.
- **pi-lab public** (2026-10-05): the only off-machine copy. Gitignored: the loop, eval cases and runs, the chat-message research file (held a password), `*.jsonl`, `AGENTS.override.md` (host details; `main` rewritten once to drop them). `gitleaks` 8.30: 0 of 521 files.
- **Left out of the kit**: pi-web, `models.json` (local Gemma), `code-intel.json` (semvex), skills `.venv` (667 MB), project `.env` allows.

### Evaluated and rejected
- **OmO Native** (`omo-ai` 5.0.0 on senpi, 2026-09-26): 3× our prompt, telemetry, 5-min cache. Worth borrowing: `tool_search`, per-category routing.
- **NVlabs SoL-Pi** (2026-09-23): nothing fired in 6 runs, best case 2.6 % saving; `then_run` runs shell inside `edit`/`write`.
- **Removed at the user's request** (09-17/18): pi-claude-bridge, workspace-history, plannotator (plan mode did not block bash). `gsd-pi` (last use April) with `gsd-web`, `gsd-update`; `~/.gsd` kept.
- `@tintinweb/pi-subagents` (~8,200 schema tokens, silent model fallback, deletes a worktree on a failed commit), `@henryqw/pi-subagent` (3 companion packages), `@ayulab/pi-rewind` (archived, `git clean` data loss), `pi-hermes-memory`/`pi-memory` (background calls, memory in the system prompt), `pi-hashline-edit-pro` (disables `edit`, weak checksums), `pi-agent-browser-native`/`gentle-pi` (prompt changes per turn; gentle-pi downloads a binary), `pi-goal-x` (pi < 0.85), `pi-repl-py` (107 MB venv), `@mjasnikovs/pi-task`, `bigpowers`, `pi-gsd`, `@devinat1/pi-debugger`, `pi-papercuts` (heavy, overlapping or dead).

## History

find-gaps details: `wip/find-gaps/DESIGN.md`. Daily harness review details: `reviews/<date>.md`.

- 2026-10-18 — Harness review: the rest after a failed part stays pending (push 92 had shipped 96 unreviewed commits); `FG_EXIT_GRACE` 120 → 45 s. `reviews/2026-10-18.md`
- 2026-10-18 — Loop down 12:36–19:00 (a cycle killed the runner): units get `-p RestartForceExitStatus=SIGTERM`; pattern kills denied
- 2026-10-18 — find-gaps speed: `.find-gaps/prereview.sh` before every reviewer call; explore-glm in loop sessions (env.sh `ZAI_API_KEY`)
- 2026-10-17 — Harness review: `ship_midcycle` ships a reviewed red-main fix mid-cycle. Rollback `reviews/2026-10-17/before/`. `reviews/2026-10-17.md`
- 2026-10-17 — Advisor `openai/gpt-6-astra` → `anthropic/claude-fable-5-1`; reviewer (also loop gate, skeptic, done-check) `openai/gpt-6-astra` → `openai/gpt-6.1-sol` (the user's pick)
- 2026-10-17 — cache-ttl: `hash()` threw on `JSON.stringify(undefined)` with `--no-tools`; now hashes "undefined"
- 2026-10-17 — find-gaps: G332 cascade approved ($2/day, $45/month); pi-lens hang filed (apmantza/pi-lens#4554)
- 2026-10-16 — Harness review: `cache-ttl` folds mid-conversation system messages (c275: $44 avoidable cache writes). `reviews/2026-10-16.md`
- 2026-10-16 — Anthropic trial cap 30 → 80 USD (`MM_ANTHROPIC_SPEND_CAP_USD` in the loop's env.sh; the user: "Raise cap")
- 2026-10-16 — find-gaps: a reviewer usage limit is no rejection; hang lines add "pi tree"; digest stub test flaky (not fixed)
- 2026-10-16 — Prompt template `/deeper <task>` (`~/.pi/agent/prompts/deeper.md`, in pi-kit)
- 2026-10-15 — Harness review: `tool-trim` covers OpenAI Responses system text; `pi-maint sql` backslash fix prepared, not installed (still on 10-16). `reviews/2026-10-15.md`
- 2026-10-15 — pi 0.99.1 → 1.2.0 with the package versions in Current setup (local permission-system 33.0.8 fork dropped). Rollback `wip/pi-update-1.2/rollback.sh`
- 2026-10-15 — find-gaps SKILL.md: parallel `builder` sub-agents in own worktrees (≤ 2 running test suites, 4 API-bound)
- 2026-10-14 — Harness review: `tool-groups` makes `read` sequential; `--direct` ships mid-cycle. `reviews/2026-10-14.md`
- 2026-10-14 — Read-only `pi-maint` key for unattended sessions; prod jobs G235, G292, G293; Claude trial project ($30 cap)
- 2026-10-13 — Harness review: no 7th review after 6 fails in a row; `arg-fixes` repairs a CR before `uXXXX`; host stalled 10-11 23:16 to 10-12 12:16. `reviews/2026-10-13.md`
- 2026-10-13 — `pi-maint` key to the host's admin account (the user's choice; AGENTS.override.md); host journal persistent again
- 2026-10-11 — Harness review: `bg-bash` runs joined `pi-bg-wait`/`pi-bg-stop`; `arg-fixes` `"null"` in `todo`; reviews must run changed paths. `reviews/2026-10-11.md`
- 2026-10-10 — Harness review: `arg-fixes` blocks stray control characters in `edit`/`write` (56 calls). `reviews/2026-10-10.md`
- 2026-10-09 — Harness review: messages with `edit`/`write` run calls in order (`executionMode: "sequential"`). `reviews/2026-10-09.md`
- 2026-10-08 — Harness review starts (05:00 timer; a change whose metric fails to improve in 3 reviews is rolled back, `reviews/changes.md`). `reviews/2026-10-08.md`
- 2026-10-07 — find-gaps: UI explorers, re-judging declined findings, trim hand-over. Prod jobs: organisation merge, ParlamentníListy replay, title backfill
- 2026-10-05 — Public repo `SlanyCukr/pi-lab`; find-gaps: OOM-proof units, affected suites only, `hold-push`; G180 backfills (echo24 codes 1264; bylines 709 + 3006)
- 2026-10-04 — Pi loop check; auto-continue stops on prices; stale PRs riot-api-project#9, security-money-maker#2 closed; 45 min review grace; ImageMagick on the Pi
- 2026-09-24 — Lean append (A/B −26 %/task); `/loop` tools hidden; pi-lens style rules off; Guidelines 3.6K → 2.2K
- 2026-09-23 — `rpiv-ask-user-question` removed; `tool-trim` (tool defs 24.7K → 13.1K); ADHD rule 1 "lead with the outcome"
- 2026-09-23 — Token pass (prompt pin, built-in sub-agents off, `analyze.py`); pi-goal removed; `web_search` allowlist; output-length pass
- 2026-09-23 — `pi-kit` + Docker test; `arg-fixes`; monitor + `/loop` in bg-bash; npm `allowScripts`, advisor 2.11.0
- 2026-09-23 — Updates: pi 0.87.1, auth 3.2.2 (pin removed), permission-system 33.0.8; `NODE_ENV` fix; `rm` rules; SoL-Pi not installed
- 2026-09-22 — Delegation audit, model-role and explorer tests; no changes
- 2026-09-22 — Default model Opus 5.5; pi-web installed and published
- 2026-09-22 — Tool list sent twice: pi-subagents 21.7.6, local #962 patch
- 2026-09-22 — Opus 5.5 tuning: append edits, effort A/B, builder on Opus 5.5, Explore rule, GPT-6 Luna tried and reverted
- 2026-09-21 — `tool-groups` extension; pi-lens widget hidden
- 2026-09-20 — `bg-bash`, `cache-ttl`, `compact-at`, `rpiv-todo`; `edit`-not-bash rule; instruction boundary; auto-retry raised
- 2026-09-18 — `@gotgenes/pi-subagents` and `pi-anthropic-auth`; ADHD append; `pi-goal`, `hide-tools`; advisor over-calling fixed
- 2026-09-17 — Original install on pi 0.85.1 (23 extensions probed, 9 installed); advisor patched; pi-lens trimmed
