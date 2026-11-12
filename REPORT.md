# pi setup and extension survey, 2026-09-17

Log of the user's pi setup: what is installed, why, and what was tried.

## Current setup (as of 2026-11-11, pi 1.5.0)

This section is the source of truth; the sections below explain how it got here.

**On the Pi (`loop` user, since 2026-10-04)** the table's laptop setup differs: Explore runs on `anthropic/claude-sonnet-5-5`, the reviewer and the advisor on `anthropic/claude-opus-5-5` (2026-10-21, the user: no Fable; off GPT since 10-18); Z.AI only in the loop's sessions (`ZAI_API_KEY` from its env.sh enables a project copy of `explore-glm`, 2026-10-18; `FG_SUBAGENT_MODEL` for GLM sub-agents is commented out since 11-02, after they used up prod's shared quota), elsewhere `explore-glm` is off; the loop's env.sh puts `~/.local/node26` first (c351, G441: prod's Node 26), so loop sessions run pi on Node 26, everything else on Node 24; no local Gemma, no desktop notifications. ImageMagick 7 in `~/.local/opt/imagemagick`, wrapper `~/bin/magick` (runner screenshots, stub tests). See `AGENTS.md` "This copy".

| Role | How it is wired |
|---|---|
| Default main session | `anthropic/claude-fable-5-2` (2026-11-09, the user; Opus 5.5 before). Unattended jobs name their own model since 2026-11-11: loop cycles `FG_CYCLE_MODEL` (default Opus 5.5), the loop's discovery cycles Opus 5.5 with the J1 briefs (`FG_DISCOVER_MODEL` in its env.sh; Fable 5.2 until 11-11 14:06), the harness review `HARNESS_REVIEW_MODEL` (default Fable 5.2, the user; one retry on Opus 5.5 at a rate limit), thinking `high` (user's choice after the 2026-09-22 effort A/B), direct login through `@gotgenes/pi-anthropic-auth` 3.4.4 (no version pin; see AGENTS.md) |
| Explorer sub-agent `Explore` | `anthropic/claude-sonnet-5-5` (2026-10-18; was `gpt-5.6-luna`), thinking low, read/grep/find/ls; the main session delegates exploration to it (GPT-6 Luna reverted 2026-09-22: 11/15 vs 15/15) |
| Explorer alternative `explore-glm` | `zai/glm-5.3`, same rules, for parallel fan-out |
| Reviewer sub-agent `reviewer` | `anthropic/claude-opus-5-5` (2026-10-21; Fable 5.1 from 10-18, GPT before), thinking high, read/grep/find/ls/bash; also the loop's review gate, skeptic and done-check |
| Builder sub-agent `builder` | `anthropic/claude-sonnet-5-5` (since 2026-10-21, kept 10-23; was Opus 5.5), thinking medium, edit tools + pi-lens diagnostics/LSP |
| Advisor tool | `anthropic/claude-opus-5-5` (Claude subscription; Fable 10-17..21), effort high, `~/.config/rpiv-advisor/advisor.json` |

Packages (`~/.pi/agent/settings.json`; updated 2026-11-09 with pi 1.5.0, `wip/pi-update-1.5/`): `@gotgenes/pi-anthropic-auth` 3.4.4, `@gotgenes/pi-subagents` 25.0.5 (tool `subagent`; stops a sub-agent at `max_turns`),
`@gotgenes/pi-permission-system` 40.3.0 pinned (41 loosens external_directory asks, 42 only adds a zod bump we already have; `pi update --extensions` rewrites it to ^42, so update with `npm i` in `~/.pi/agent/npm`) from npm (our #962 fix upstream since 33.1.0; 40.x also matches an absolute rule against a relative path, hence six work-tree `rm -rf` allow rules),
`pi-web-access` 0.47.0, `pi-lens` 4.4.11, and the advisor `~/.pi/agent/local-packages/rpiv-advisor` (upstream 2.15.0, which now has our session-id and WebSocket fixes, plus only our prompt `prompts/advisor-system.txt`; diff, switch and rollback scripts in `wip/pi-update-1.5/`).
`~/.pi/agent/npm/package.json` `allowScripts` (npm 11): `@ast-grep/cli`, `esbuild` allowed (install or check their binaries); `protobufjs`, `@google/genai`, `tree-sitter-bash` denied (no-op, warning only, or a prebuilt linux-arm64 binary).
Global npm packages: `npm i -g --prefix ~/.npm-global …`. A bare `-g` from a pi-web shell installs into `~/.local/node`, first on the units' PATH but not in `pi-web.service`.
`settings.json` also: `"shellCommandPrefix": "unset NODE_ENV"` (pi-web's Next.js server sets `NODE_ENV=production`, and every bash command inherited it); retry `{"enabled": true, "maxRetries": 8, "baseDelayMs": 3000}` (12.7 min of backoff); `warnings.anthropicExtraUsage: false`.

Own extensions in `~/.pi/agent/extensions/` (dev copies in `~/pi-lab/wip/`):
- `bg-bash`: background bash, sub-agent hand-off, `monitor: true`/`persistent` watches, `/loop` + `schedule_wakeup` + `loop` tool, pi-web liveness hold; `pi-bg-wait`/`pi-bg-stop` at the start or end of a `&&`/`;` chain run in order, `&&` honoured; a main-session `sleep N; check` (N >= 30) ends when a background command finishes, its result inline (2026-11-09) (`index.ts`, `loop.ts`, `mixed.ts`). Since 2026-11-11 a result that arrives during a run joins it at the next `turn_end` (custom message + `continue`), not at `agent_end`: 93 of 163 main-session results had come more than 5 min late, and a loop cycle (one `pi -p` run) got its review verdict after its last answer.
- `cache-ttl`: 1 h prompt cache, main session. Its wake-up system-prompt pin is inactive on pi 1.2.0 (fixed there). Since 2026-10-16 it folds mid-conversation system messages into one head, so a pi-lens `context` injection after a tool change no longer flips the prompt (`PI_SYSTEM_FOLD=0` off; test `node wip/cache-ttl/test.mjs`). Since 2026-11-11 it answers `cache_warming_decision` with stop in the main session: pi's warmer assumes a 5 min TTL and re-sent the context every 270 s under long tool calls (575 refreshes in 14 days, $21.29, all onto live 1 h entries).
- `compact-at`: compact at 40 %; also on return after 65+ min idle at 150k+ tokens (outcome in a `compact-at-idle` session entry; after failed retries it uses the last response's real size, 2026-11-11). `hide-tools`: hides `pi_lens_activate_tools`.
- `ext-fresh` (2026-11-06): on a code change under `extensions/` or `local-packages/`, the next pi-web session loads the new code (test `node wip/ext-fresh/test.mjs off`).
- `arg-fixes`: drops `"null"` placeholders in `subagent` and `lens_diagnostics` free-text args (`severity` too since 2026-11-09: pi-lens 4.4.9 rejects it); decodes `\uXXXX` escapes in `edit` text; blocks `edit`/`write` text with a stray control character, a tab the file lacks, or a placeholder `newText` (`x`, `unused`); repairs a CR before `uXXXX`; maps a missing `read`/`grep`/`find`/`ls` path to the one existing path without a `src` segment, noted in the result. A `grep` alternative rg cannot parse is searched as literal text, noted; `~/.pi/agent/bin/rg` wraps `rg.real`, adding `--engine=auto` for look-around (`wip/arg-fixes/rg-wrapper.sh`). A `bash` `pgrep -f`/`pkill -f` pattern that matches its own command gets one letter bracketed (`[f]oo`), noted.
- `auto-continue`: on in interactive pi; an offer ending gets "go with your pick", read-only after a question, ≤ 3 per message; `/auto off`, `PI_AUTO_CONTINUE=manual|0`.
- `tool-groups`: collapsed tool rows, thinking display omitted; marks `edit`/`write`/`read` sequential, so a message with one runs its calls in order.
- `tool-trim`: short tool descriptions, unused optional params hidden, "Available tools:" list and pi-lens skills dropped in Anthropic, Codex, chat and (since 2026-10-15) OpenAI Responses requests; `PI_TOOL_TRIM=0` off; test `node wip/tool-trim/test.mjs`. pi 1.5 renders the list as a `<tools>` section, which went out untrimmed from 11-09 to 11-11 (about 270 tokens a request); dropped again.
- `pi-permission-system/config.json`: allow by default, `yoloMode: true`, deny dotenv files, `~/.ssh`, the pi and Codex credential files, `rm -rf` outside `/tmp`.

Other config: `~/.pi/agent/APPEND_SYSTEM.md` (ADHD style, lean since 2026-09-24; dev copy `wip/token-audit/APPEND_SYSTEM.lean.md`), `~/.pi/agent/agents/*.md` (`general-purpose`/`Plan` off via `enabled: false`), `~/.agents/skills/` (diagnose, grill-me, desloppify, find-gaps; the rest in `~/.agents/skills.disabled/`),
`~/.pi-lens/config.json` (trimmed tools, hidden widget; `contextInjection.retain` since 2026-11-10, so a finding no longer breaks the prompt cache), `.pi-lens.json` in `~/pi-lab` and `~/Documents/personal/projects` (style-only rules off, `backup-*` ignored; copy `wip/token-audit/pi-lens.shared.json`), `~/.config/rpiv-todo/config.json`, `~/.pi/agent/web-search.json` (`source_check`, `get_search_content` off; `webSearch.allowedProviders: [openai, exa]`), prompt template `~/.pi/agent/prompts/deeper.md` (`/deeper <task>`, 2026-10-16), `~/.pi/agent/models.json` (adds `anthropic/claude-fable-5-2`, 2026-11-09: released that day, upstream pi commit `0d1793c2` not in 1.5.0; same settings as Fable 5.1, $8/$40).

Public repo: `~/pi-lab` is `github.com/SlanyCukr/pi-lab` (since 2026-10-05; no loop, no session data). Portable copy `pi-kit/`: `export.sh` snapshots this setup, `install.sh --sub copilot|codex|openai` installs it, `server/` installs a headless host, `box/` has a Docker image and a credential-free test. See its README and "Decisions: portable kit".

Browser UI: `@agegr/pi-web` 0.15.0 (pins pi 1.5.0, the same version as the CLI), user service `~/.config/systemd/user/pi-web.service` on `127.0.0.1:30141`,
public through a Cloudflare tunnel since 2026-10-04 (URL in `AGENTS.override.md`, not in git); password in `~/.config/pi-web/env`. See "Decisions: pi-web".
find-gaps loop and its run page (board): user units on the Pi; host details in `AGENTS.override.md`. Setup: `wip/find-gaps/DESIGN.md` (not in git).

Lab tool: `pi -e ~/pi-lab/update-lab/wire-probe.ts` with `WIRE_PROBE_OUT=/tmp/wire.jsonl` logs each Anthropic request body (no headers); diff two runs for prompt-cache changes.

Removed since the original install: `@vanillagreen/pi-claude-bridge`, `@tintinweb/pi-subagents`, `pi-workspace-history`, `@plannotator/pi-extension`, the hand-rolled `plan-billing` extension (archive deleted), `gsd-pi`, `lsp-exit` (2026-11-09: pi-lens 4.4.9 fixed the exit hang upstream; dev copy `wip/lsp-exit/`).

## Open items

Reviewed 2026-09-23.

1. Model selection settled 11-12 (Fable: main session and harness review; loop cycle, discovery, review, skeptic: Opus 5.5; Explore and builder: Sonnet 5.5; advisor: Opus 5.5). Evidence: same two audit briefs, skeptic verdicts by origin: Opus 10 kept of 14 (9 at 13.5+) for $34, Fable 9 of 15 (6 at 13.5+) for $42, no drop for a false fact in either; loop c501-c512 on Opus in direct mode: 125 commits pushed, $2.46 a commit (Fable trial $5.08), 19 green deploys, 2 red pushes (CI step missing from prereview, fixed by the 11-12 review). Two watch items: first reviews failed 3 of 19 (15 %; Opus baseline 3 %, Fable trial 1 of 35), and Opus discovery with the J1 briefs has one pass only (c505: 5 candidates, 2 kept, 1 at 13.5+, $11.59; Fable 1.8 kept a pass). Judge again after three passes; back to `FG_DISCOVER_MODEL=anthropic/claude-fable-5-2` only if they fall clearly short.
2. When a pi release lists `claude-fable-5-2` itself (`pi --list-models`), delete its entry in `~/.pi/agent/models.json`: the entry replaces the built-in one, which also sets the refusal fallback to Opus 5.
3. Note, not a to-do: the `reviewer` agent is deliberately not isolated, so the permission policy applies to its bash tool. Explorers are isolated and have no bash.
4. pi-web's pi caches extension modules per cwd for its whole process; `ext-fresh` clears that on a code change. A pi-web upgrade that renames `clearExtensionCache` makes it inert: check for `compact-at-idle` entries.

Closed: usage check, backup (09-23); pi-packages#962 (upstream 33.1.0); exit hang (`lsp-exit`, 0 hangs in 16 cycles, 10-29; upstream in pi-lens 4.4.9); rpiv-mono#236 (upstream in advisor 2.15.0, 11-09).

## How to work here (gotchas)

- Docker on the host (2026-10-06): buildkit v0.31.1 crashed dockerd mid-build (moby/buildkit#6915), containers down 1.5 h; fixed by Docker 29.8.2 and `"live-restore": true`. The loop's unit is transient: `find-gaps-boot.service` restarts it after a reboot unless runner.log ends with "run end".
- The ISP caps concurrent connections per line (2026-10-05): over it, new connections get "no route to host" (ICMP admin-prohibited). Headroom ~300–640. Bursty GitHub or scraping failures: check this first.
- Reviewed name lists apply themselves (the owner's "yes auto": merge map 2026-10-26, identity catalog 2026-10-29): after a deploy that changes one, the worker runs `canonical-merge` or `entity-identities --apply` once per version; a standing OK for these two only, other prod writes still wait for him.
- Long prod jobs: one at a time, with find-gaps pushes held (`.find-gaps/hold-push`): every deploy runs `compose down`, which stops the db and kills any job, one-off container or not (2026-10-22: G460's apply died 53 min in). Three backfills at once OOM-killed the 512 MiB worker; three parallel fetchers failed ~35% of connections (2026-10-05).

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
- pi-web evicts a session after 10 min idle (`PI_WEB_IDLE_TIMEOUT_MS`); extensions hold it via the `Symbol.for("@agegr/pi-web/session-liveness/v1")` registry (bg-bash does). A watch-held session keeps old extension code: `/reload` it.
- Never read or print `~/.pi/agent/auth.json`, `~/.config/pi-web/env`, `~/.codex/auth.json`. Pass the pi-web password to curl from inside `bash -c`.

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

- **Fable only where it is needed** (2026-11-11, the user): main session and harness review. In the loop every role is Opus 5.5 (cycle, discovery, review, skeptic) or Sonnet 5.5 (Explore, builder). Why: J1 traced the trial's 41 candidates: lenses on Sonnet found as much under either main; what differed was the brief (Fable: one end-to-end question per lens, known findings by id, a sizing query), and that brief is now in SKILL.md. GLM: only `explore-glm` inside loop sessions as the fallback when Explore hits a limit. OpenAI: no model; `openai` is still an allowed web-search provider.
- **Fable 5.2 is the scarce allowance** (2026-11-11): a 20-cycle loop run on Fable used it up in 26 h (about $513 list in the week; Opus still answered). It found 32 kept findings where Opus had found none and no review failed, at $31 per cycle against $7. So Fable is the user's main driver, the loop's discovery model and the harness review's model (the user, 11-11: $16 a run against $3.50 on Opus, about a fifth of the allowance a week); fix cycles and reviews stay on Opus, and no unattended job follows pi's default model.
- **Main: Opus 5.5, high** (2026-09-22, replaced Fable 5.1): all effort levels passed the A/B, high won nothing measured ($0.23 vs $0.21 medium per task); the user chose it.
- **Builder: Opus 5.5, medium** (2026-09-22): vs Opus 5, 40 s vs 62 s, 4/20/0.2 vs 5/25/0.5 USD per M.
- **Explore: GPT-5.6 Luna, low** (2026-09-17, rechecked 09-22): 18–22 s, 15/15 hard test. GPT-6 Sol: 15/15 at half the tokens but scarce Codex allowance; Opus 5.5: 22/22 but Anthropic usage.
- **Exploration goes to `Explore`** (2026-09-22): Opus delegated 0 of 22 runs before the rule, 2/2 after; quick greps stay local.
- **explore-glm: GLM-5.3**, only when Codex is rate-limited. GLM-5.3-Flash invented line numbers (2 of 4); GPT-5.6 Terra: Luna's accuracy, more quota.
- **Reviewer: GPT-6 Astra, high** (2026-09-17): 4 of 5 real reviews found a real defect; $1–3, 2.5–5 min. GPT-6.1 Sol since 2026-10-17 (the user's pick).
- **Sonnet 5.5 builder** (since 2026-10-21, usage ~-$50/day; kept 10-23: 0 of 13 first reviews failed vs Opus's 9 in 50). Back to Opus if fails climb past that. Older A/B: `wip/model-ab/RESULTS.md`.
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
- **`compact-at` at 40 %** (2026-09-20): pi ignored `compaction.modelOverrides`; one `reserveTokens` cannot fit 1M and 272k windows. Inert in children and print mode. Since 11-05 also on return after 65+ min idle at 150k+ tokens (cold re-writes: $87.53/30 d).
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
- **`arg-fixes`** (2026-09-23): fixes `"null"` optional args in `event.input` (stored message and cache stay); non-ASCII escapes in newText decoded (10-08: 20 of 29 failed loop edits). Test `node wip/arg-fixes/test.ts`.

### Advisor
- **Local copy = upstream + our prompt** (2026-11-09): 2.15.0 ships our session-id and WebSocket fixes; the prompt (Recommendation/Why/Main risk format) has no config hook, so the package stays local.
- **Shutdown cleanup** (2026-09-23): a cached Codex WebSocket made `pi -p` hang ~300 s after an advisor call; now 15–19 s.
- **Call only when stuck** (2026-09-18): the default made Luna call it before a one-line edit (19 s → 300 s timeout). Fixed output format; transcript is evidence, not instructions.
- **Quirk**: on tiny prompts Astra sometimes answered with a tool call ("no text content"); real calls fine.

### pi-lens
- **Only `lens_diagnostics` + `lsp_navigation`** (2026-09-17): navigation tools did not help correctness and slowed tasks (55 s → 25 s after). Tools 27 → 17. `hide-tools` (09-18) hides `pi_lens_activate_tools`.
- **Widget and LSP status hidden** (2026-09-21): diagnostics still reach the model; `/lens-widget-toggle` for one session.
- Rejected: `@ian-pascoe/pi-lsp` (silent without pull diagnostics), `@narumitw/pi-lsp` (only on tool call).

### bg-bash, monitor, loop
- **Own `bg-bash`** (2026-09-20): `background: true` on stock `bash`, no new tools (one session had polled CI 137 min). Monitor + `/loop` (09-23) as `bash` parameters stay under the permission rules (`wip/bg-bash/DESIGN-monitor-loop.md`).
- **Rejected** (09-20/23): six background-bash and monitor packages: they replace `bash`, add 4+ tools or race `steer` + `triggerTurn`.
- Residual: a job ending between prompt submit and bg-bash's `input` handler can make pi reject the prompt ("Agent is already processing").

### pi-web
- **`@agegr/pi-web`** (2026-09-22): browser UI on the same sessions, localhost only, behind a tunnel; password only, no Cloudflare Access (user's choice).
- **`shellCommandPrefix: "unset NODE_ENV"`** (2026-09-23): Next.js's `NODE_ENV=production` made `npm ci` skip devDependencies.
- **T3 Code dropped** (2026-09-22): no Pi provider in stable; the preview cannot resume Pi threads (t3code#12467).

### Prompt and system-append tuning
- **ADHD style append** (2026-09-18): copied from the user's claude-config; children inherit it, `# Scope` exempts them. Skills 18 → 3 (7.4 → 3.1 KB); caveman out (fought the style).
- **Working rules** (2026-09-18, Fable 5.1 guide): top corrections in 694 messages were "continue" (57), "verify" (37). Instruction boundary (09-20): a pasted recap was taken for a tool message.
- **`edit`, not bash** (2026-09-20): 33 heredoc rewrites in one session, 0 in the replay. No todo tool since 2026-11-11 (the user: the harness runs unwatched 99 % of the time, so todo calls are wasted tool calls; 254 calls in 14 days, 48 turns that called nothing else): `rpiv-todo` and `~/.config/rpiv-todo/config.json` (only its `guidance` texts) removed, the append's state line no longer names it; back with `npm i @juicesharp/rpiv-todo` in `~/.pi/agent/npm` plus the `npm:@juicesharp/rpiv-todo` line in `settings.json`.
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
- **pi-lab public** (2026-10-05): the only off-machine copy. Gitignored: the loop, evals, `*.jsonl`, `AGENTS.override.md` (host details). `gitleaks` before every commit.
- **Left out of the kit**: pi-web, `models.json` (local Gemma), `code-intel.json` (semvex), skills `.venv` (667 MB), project `.env` allows.

### Evaluated and rejected
- **OmO Native** (`omo-ai` 5.0.0 on senpi, 2026-09-26): 3× our prompt, telemetry, 5-min cache. Worth borrowing: `tool_search`, per-category routing.
- **NVlabs SoL-Pi** (2026-09-23): nothing fired in 6 runs, best case 2.6 % saving; `then_run` runs shell inside `edit`/`write`.
- **Removed at the user's request** (09-17/18): pi-claude-bridge, workspace-history, plannotator (plan mode did not block bash). `gsd-pi` (last use April) with `gsd-web`, `gsd-update`; `~/.gsd` kept.
- `@tintinweb/pi-subagents` (big schema, deletes worktrees), `@ayulab/pi-rewind` (`git clean` data loss), memory packages, `pi-hashline-edit-pro` (disables `edit`), per-turn prompt changers; others heavy, overlapping or dead.

## History

find-gaps details: `wip/find-gaps/DESIGN.md`. Daily harness review details: `reviews/<date>.md`.

- 2026-11-09 — pi 1.4.0 → 1.5.0, pi-lens 4.4.11, subagents 25.0.5, web-access 0.47.0, auth 3.4.4, advisor 2.15.0 (+ our prompt), pi-web 0.15.0 (13 scratch checks first); `lsp-exit` removed; `tool-trim` hides the new params; kit pin 0.99.1 → 1.5.0. Rollback `wip/pi-update-1.5/rollback.sh`.
- 2026-11-09 — Claude Fable 5.2 added via `models.json` (not in pi 1.5.0); real turn with a tool call works on the subscription login. Same day: the user made it the default main model (loop cycles and harness review follow; sub-agents and advisor keep their own).
- 2026-11-09 — Loop trial on Fable 5.2 cycles: c478–c497, `--no-pr` (no push), after research rejected Fable-orchestrates-Opus (est. +55 % per commit; delegation showed no gain). Design, baselines and how to judge: `wip/find-gaps/DESIGN.md` (last note).
- 2026-11-11 — Fable loop trial ended (111 local commits, 32 kept findings, 0 of 17 reviews failed, $603 list) and used up the week's Fable allowance; the 05:00 harness review got a 429. Runner: `FG_CYCLE_MODEL` (default Opus 5.5), `FG_DISCOVER_MODEL` (discovery-only cycles); harness review `HARNESS_REVIEW_MODEL` (Fable 5.2, Opus retry at a 429). Hybrid trial started (c498); push approved, direct mode from c499. Review: `compact-at` real size after 429s ($3.38 miss); `reviews/2026-11-11.md`. Afternoon: `rpiv-todo` removed; J1's loop changes deployed (lens brief file, fresh-look attack list, background waits, a refused discovery pass stays due; suites 0 FAIL); discovery on Opus; two Fable audits (10 + 10 findings) handed to the loop; five parallel jobs froze pi-web at 11:13 (memory cap), jobs now run one at a time. Evening: direct push 899e275d deployed green (136 commits); J2 extension review (Opus): three fixes live (bg-bash mid-run delivery, cache-ttl stops pi's cache warmer, tool-trim drops the 1.5 `<tools>` section); Opus halves of the two audits (11 + 8 findings, about $17 each against Fable's $19 and $23, half the time) handed to the loop with their origin named, to compare by skeptic verdicts.
- 2026-11-12 — Harness review: a red direct push now asks for its failed CI step in `prereview.sh` (xenon failed after the commit in 5 of 11 cycles, 1 red deploy); `analyze-loop.py` prints main cost by context size (42 % above 300k). `reviews/2026-11-12.md`. Model selection settled (open item 1): skeptic verdicts on the two audits favour Opus (10 of 14 kept against Fable's 9 of 15, cheaper), G611 round d keeps the z.ai search (claim precision 0.989 against Opus 0.724); G600 purge applied 11-11 (219 rows).
- 2026-11-01 — G536 C2 on prod (owner yes): `stance-rerun --apply` re-judged 89 articles (119 of 1,172 stances changed). Search Console waits for the rename; name pick Mnohohlas.
- 2026-11-03 — Loop run c439–c477 ended itself 02:32 (done-check confirmed; $513.85 list incl. GLM). Delivered: Reach, Trust, G550–G567. Next dated item: G550 re-measure 11-08. Waiting on the user: PR #408 (Dependabot, green) merge, site name.
- 2026-11-02 — Loop GLM sub-agents exhausted the shared z.ai 5-hour quota (prod enrichment stalled 65 min): sub-agents back on Claude; runner withholds z.ai keys at >= 50 % (5 h) / 80 % (week). "Lookups in one turn" tried, removed. pi-lens #5169 posted.
- 2026-10-08…11-10 — Daily harness reviews (05:00; every change in `reviews/changes.md`). 11-06: `ext-fresh`. 11-09: bg-bash ends a `sleep N` poll when a background command finishes; compact-on-return proven ($0.50 vs ~$1.40). 11-10: pi-lens `contextInjection.retain` (cycle mains lost $21.75 of $160 to re-written cache); `tool-trim` hides `fetch_content.redirects`. `reviews/<date>.md`
- 2026-10-31 — Loop sub-agents on GLM-5.3 (the user): runner `FG_SUBAGENT_MODEL` writes project copies of the agents (off again 11-02); `FG_SUBAGENT_CONCURRENCY` 2. Restarted at c439 with owner projects Reach and Trust.
- 2026-10-29 — G511 AP identity apply (563 articles); identity-catalog applies automatic (G527). Loop stopped 11:44 at the owner's request ($241, c407–c433).
- 2026-10-26 — G489 site simplification live (3-group nav); G488 deleted 27,040 namesake rows; loop stopped 23:29 at the owner's request ($128.60).
- 2026-10-25 — Loop restarted at c380 (stopped since 10-22). Host power cut 10-23 08:40–15:00, prod recovered. Sonnet builder kept (0/13 fails). `reap_cycle` keeps podman's pause process.
- 2026-10-22 — Loop down 17:28–18:28 (revoked sign-in token; a 401 now waits 30 min); G460 identity apply on prod (11,129 articles); gh 2.103.0; network re-runs case-sensitive; host `apt` upgrade (Docker 29.9.2, live-restore).
- 2026-10-21 — Advisor audit kept; no Fable (the user): reviewer, gate and advisor → `claude-opus-5-5`; reviews use a 5-min cache; `builder` → Sonnet 5.5 (trial, kept 10-23).
- 2026-10-20…21 — find-gaps runner: a refused sign-in waits like a usage limit; `review_owed`; `reap_cycle` stops a cycle's leftover jobs (c340: ~4 GB for 3 h); prereview `tsc` from scratch. `wip/find-gaps/DESIGN.md`
- 2026-10-20 — `pi-maint` update installed as `pi`: `sql` takes backslashes, `\d TABLE`, `\dt`; writes, `cli` on the ro key and shells still refused. Old sha256 b8adc684…
- 2026-10-19 — Protection in proportion (the owner: maybe-failure guards are bloat) in SKILL.md, review prompts, APPEND_SYSTEM.md; discovery every 8th cycle, a 2 h pause instead of idle cycles; 8 h `FG_PUSH_GAP` reverted.
- 2026-10-18 — Critical review (`project-check`, `Audience: owner`, frozen browser-spec count); loop down 12:36–19:00 (a builder's pattern kill, now denied); `prereview.sh` before every reviewer call; `explore-glm` in loop sessions.
- 2026-10-17 — Advisor → `claude-fable-5-1`; cache-ttl hashes `undefined` under `--no-tools`; G332 cascade approved; pi-lens #4554
- 2026-10-16 — Anthropic trial cap 30 → 80 USD (the user); find-gaps: a reviewer usage limit is no rejection; `/deeper <task>` prompt template (in pi-kit)
- 2026-10-22 — pi 1.2.0 → 1.4.0 + package updates (12 scratch checks first), pi-web 0.12.2, Node 24.22.1 (security), uv 0.13.5 (= CI). Rollback `wip/pi-update-1.4/rollback.sh`; old Node in `~/.local/node-v24.21.0`.
- 2026-10-15 — pi 0.99.1 → 1.2.0 (permission-system fork dropped; `wip/pi-update-1.2/rollback.sh`); find-gaps: parallel builders in own worktrees
- 2026-10-13/14 — `pi-maint` (the user's choice; read-only key for unattended sessions, AGENTS.override.md); host journal persistent; prod jobs G235, G292, G293
- 2026-10-04…07 — Loop moved to the Pi; public repo `SlanyCukr/pi-lab`; find-gaps: OOM-proof units, affected suites only, `hold-push`, UI explorers, re-judging declined findings; prod jobs G180 backfills, organisation merge, ParlamentníListy replay, title backfill.
- 2026-09-17…24 — Original install on pi 0.85.1 (23 extensions probed, 9 kept; advisor patched); own extensions bg-bash, cache-ttl, compact-at, tool-groups, arg-fixes, hide-tools; pi-subagents (#962 fix), pi-anthropic-auth; ADHD append, lean since 09-24 (−26 %/task); tool defs 24.7K → 13.1K; `pi-kit`; default Opus 5.5; pi-web published.
