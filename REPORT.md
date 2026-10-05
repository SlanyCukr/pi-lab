# pi setup and extension survey, 2026-09-17

Log of the user's pi setup: what is installed, why, and what was tried.

## Current setup (as of 2026-09-29, pi 0.99.1)

This section is the source of truth; the sections below explain how it got here.

**On the Pi (`loop` user, since 2026-10-04):** this table describes the laptop's setup. The Pi copy differs: Explore, reviewer and the advisor run on `openai/*` (pi 0.99 stores the ChatGPT login as `openai`), no Z.AI login (`explore-glm` falls back), no local Gemma, no desktop notifications. ImageMagick 7 is unpacked from the trixie debs without root in `~/.local/opt/imagemagick` (wrapper `~/bin/magick`; the runner's screenshots and the stub tests need it). See `AGENTS.md` "This copy".

| Role | How it is wired |
|---|---|
| Default main session | `anthropic/claude-opus-5-5`, thinking `high` (user's choice after the 2026-09-22 effort A/B, see "Decisions: models and roles"), direct login through `@gotgenes/pi-anthropic-auth` 3.2.2 (no version pin; see AGENTS.md) |
| Explorer sub-agent `Explore` | `openai-codex/gpt-5.6-luna`, thinking low, read/grep/find/ls; main session delegates exploration to it (GPT-6 Luna tried and reverted 2026-09-22: 11/15 vs 15/15 on the hard test) |
| Explorer alternative `explore-glm` | `zai/glm-5.3`, same rules, for parallel fan-out |
| Reviewer sub-agent `reviewer` | `openai-codex/gpt-6-astra`, thinking high, read/grep/find/ls/bash |
| Builder sub-agent `builder` | `anthropic/claude-opus-5-5`, thinking medium, edit tools + pi-lens diagnostics/LSP |
| Advisor tool | `openai-codex/gpt-6-astra`, effort high, `~/.config/rpiv-advisor/advisor.json` |

Billing caveat (2026-09-22): OAuth success does not prove included-plan billing; the user checked claude.ai usage 2026-09-23: fine.

Packages (`~/.pi/agent/settings.json`): `@gotgenes/pi-anthropic-auth` 3.2.2, `@gotgenes/pi-subagents` 21.7.6 (spawn tool `subagent`),
the locally patched `~/.pi/agent/local-packages/pi-permission-system-33.0.8` (33.0.8 + tool-surface fix for pi ≥0.86, patch and its unit script in `~/pi-lab/wip/pi-permission-system-33.0.8/local-patch-962/`, upstream gotgenes/pi-packages#962; drop the patch when #962 ships), `@juicesharp/rpiv-todo` 2.11.0, 
`pi-web-access` 0.30.0, `pi-lens` 4.2.1, and the locally patched advisor `~/.pi/agent/local-packages/rpiv-advisor` (2.11.0 + cache fix for rpiv-mono#236, WebSocket cleanup, prompt edit; diff `wip/rpiv-advisor-local/local-fixes-vs-2.10.1.patch`). 
`~/.pi/agent/npm/package.json` has `allowScripts` (npm 11): `@ast-grep/cli` and `esbuild` allowed (they install or check their binaries), `protobufjs` and `@google/genai` denied (no-op / warning only).
`settings.json` also sets `"shellCommandPrefix": "unset NODE_ENV"`: pi-web's Next.js server sets `NODE_ENV=production` in its own process, and every bash command inherited it.
`settings.json` retry: `{"enabled": true, "maxRetries": 8, "baseDelayMs": 3000}` (12.7 min of backoff); `warnings.anthropicExtraUsage: false`.

Own extensions in `~/.pi/agent/extensions/` (dev copies in `~/pi-lab/wip/`):
`bg-bash` (background bash + sub-agent hand-off, `monitor: true`/`persistent` watches, `/loop` + `schedule_wakeup` + `loop` tool, pi-web liveness hold; `index.ts` + `loop.ts`), `cache-ttl` (1 h prompt cache, main session; pins the hooked system prompt in wake-up runs), `compact-at` (compact at 40 %),
`arg-fixes` (drops `"null"` placeholders in `subagent` args), `hide-tools` (hides `pi_lens_activate_tools`), `auto-continue` (on in interactive pi: an offer ending gets "go with your pick", read-only after a question, ≤ 3 per message; `/auto off`, `PI_AUTO_CONTINUE=manual|0`), `tool-groups` (collapsed tool rows, thinking display omitted), `tool-trim` (short tool descriptions, unused optional params hidden, "Available tools:" list and pi-lens skills dropped; `PI_TOOL_TRIM=0` off),
`pi-permission-system/config.json` (permission policy: allow by default, `yoloMode: true`, deny dotenv files, `~/.ssh`, the pi and Codex credential files, `rm -rf` outside `/tmp`).

Other config: `~/.pi/agent/APPEND_SYSTEM.md` (ADHD style, lean version since 2026-09-24; dev copy `wip/token-audit/APPEND_SYSTEM.lean.md`), `~/.pi/agent/agents/*.md` (sub-agents; `general-purpose`/`Plan` off via `enabled: false`), `~/.agents/skills/` (4 skills: diagnose, grill-me, desloppify, find-gaps; the rest in `~/.agents/skills.disabled/`),
`~/.pi-lens/config.json` (trimmed tools, hidden widget), `.pi-lens.json` in `~/pi-lab` and `~/Documents/personal/projects` (style-only rules off, `backup-*` ignored; copy in `wip/token-audit/pi-lens.shared.json`), `~/.config/rpiv-todo/config.json`, `~/.pi/agent/web-search.json` (`source_check` and `get_search_content` off; `webSearch.allowedProviders: [openai, exa]`).

Public repo: `~/pi-lab` is `github.com/SlanyCukr/pi-lab` (since 2026-10-05; no loop, no session data). Portable copy: `pi-kit/` (`export.sh` snapshots this setup, `install.sh --sub copilot|codex|openai` installs it; `server/` installs a headless host, `box/` has a Docker image and a credential-free test). See its README and "Decisions: portable kit".

Browser UI: `@agegr/pi-web` 0.9.3 (bundles pi 0.87.1) as user service `~/.config/systemd/user/pi-web.service` on `127.0.0.1:30141`,
public through a Cloudflare tunnel since 2026-10-04 (URL in `AGENTS.override.md`, not in git); password in `~/.config/pi-web/env`. See "Decisions: pi-web".
find-gaps loop and its run page (board): on the Pi as user units; host details in `AGENTS.override.md`. Setup: `wip/find-gaps/DESIGN.md` (not in git).

Lab tool: `~/pi-lab/update-lab/wire-probe.ts`. Load it with `pi -e ~/pi-lab/update-lab/wire-probe.ts` and set `WIRE_PROBE_OUT=/tmp/wire.jsonl`. It logs each Anthropic request body, without headers, so two runs can be diffed for prompt-cache changes. The one-off `lab-run.sh` from the 09-23 update was deleted.

Removed since the original install: `@vanillagreen/pi-claude-bridge`, `@tintinweb/pi-subagents`, `pi-workspace-history`,
`@plannotator/pi-extension`, the hand-rolled `plan-billing` extension (archive deleted), `gsd-pi`.

Evaluated and not installed: NVlabs SoL-Pi (2026-09-23), see "Decisions: evaluated and rejected".

## Open items

Reviewed 2026-09-23.

1. **Upstream, waiting:** rpiv-mono#236 (advisor cache key) and gotgenes/pi-packages#962 (tool list relocation on pi ≥0.86); local patches cover both, notes next to them in `wip/`. Drop each local patch when its fix ships: switch the settings entry back to `npm:` and delete the local copy.
2. The `context7` docs tool went away with the old extension and nothing replaces it; `web_search`/`fetch_content` cover docs lookups.
3. Note, not a to-do: the `reviewer` agent is deliberately not isolated, so the permission policy applies to its bash tool. Explorers are isolated and have no bash.


Closed 2026-09-23: usage check (fine), backup deleted.

## How to work here (gotchas)

- The ISP caps concurrent connections per line (2026-10-05): over the cap, new connections fail with ICMP "administratively prohibited" (seen as "no route to host" / errno 113) from inside the ISP's network, not the router. Measured headroom was only ~300–640 extra connections. A torrent client's half-open peer attempts used ~100–140 of it (the user stopped seeding); parallel fetchers did the rest. Burst-y GitHub or scraping failures: check this first.
- Long jobs on production: one process at a time, each in its own `docker compose run --rm --no-deps -T worker …` container, with find-gaps pushes held (`hold-push`). Inside the live worker (512 MiB) three backfills OOM-killed it, and three parallel fetchers made ~35% of the host's new connections fail upstream (0% with one) (2026-10-05).

### Running pi
- `pi -p` from a script or background shell needs `< /dev/null`, or it blocks forever.
- Test runs: pass `--no-session`, or trash the test session folders after. Otherwise they show in `pi -r` and pi-web.
- `pi -ne` drops all packages, including the Anthropic auth package. Anthropic then answers `400 Third-party apps now draw from your extra usage, not your plan limits`. Do not use `-ne` for Anthropic runs.
- Every monitor event, loop tick or wake-up is a full turn that re-reads the context. Run long watches in a small dedicated session.
- `pi update --models` refreshes the model catalog (it added `gpt-6-luna`/`gpt-6-sol`).
- Do not use SDK scripts that call `bindExtensions` again against Anthropic: two such requests got a ToS "reverse engineering" block. The CLI path is fine.

### Testing extensions
- Never develop inside `~/.pi/agent/extensions/`. Children of live sessions load it immediately. Develop in `~/pi-lab/wip/<name>/`.
- Test a dev copy with a separate agent dir: `PI_CODING_AGENT_DIR=/tmp/mt/agent`, filled with symlinks to the live `~/.pi/agent`, with the one extension swapped for the dev copy. A project `.pi/settings.json` path exclusion does not reach user-level extensions.
- Two extensions registering `bash` make pi refuse to start ("Tool bash conflicts"). bg-bash owns `bash`, so swap it, do not add a second one.
- Children do not load `-e` CLI extensions, only persisted ones.
- A bare `<active_agent>` substring check marks every session as a child: `APPEND_SYSTEM.md` contains that text. Check `<active_agent name=` plus the `ask_parent`/`notify_parent` tools.
- Check cache-sensitive changes on the wire: log `payload` in `before_provider_request` (`update-lab/wire-probe.ts`) and diff. Remove the probe after.
- pi-subagents falls back silently when an agent's `model` has no login (fuzzy match, then the parent's model): a lapsed Codex login makes Explore run on Opus. Only the kit has a `model-check` warning.
- Run prompt A/B tests from a scratch copy, not from `~/pi-lab`: a test session there edited the live `REPORT.md` (2026-09-23).
- `SYSTEM.md` replaces only pi's opening line and the pi-docs block; tool list and Guidelines stay. A neutral custom opening passed a real Opus 5.5 turn (200, 2026-09-23).
- Sub-agent transcripts are saved under `~/.pi/agent/sessions/<dir>/<parent-session>/tasks/*.jsonl`.
- Do not edit a bash script while it runs. Bash reads scripts incrementally, so running copies break.

### npm and packages
- Global installs use the system node: `PATH=/usr/bin:/bin npm i -g …`, never fnm's.
- Local packages: `npm install --omit=dev --omit=peer`. Without `--omit=peer` npm pulls a 520 MB second copy of pi.
- npm 11 skips install scripts unless `allowScripts` in `~/.pi/agent/npm/package.json` lists them. After an update, run `npm approve-scripts --allow-scripts-pending` in `~/.pi/agent/npm`; it should list none.
- `pi update` does not touch local packages under `~/.pi/agent/local-packages/`.

### Permission policy
- The matcher has no literal `*`, and the last matching rule wins. Current `rm` rules: deny `rm -rf /*`, allow `rm -rf /tmp/*`, deny `rm -rf /tmp/* /*` and `rm -rf /tmp/* ~*`, deny `rm -rf ~*`.
- `rm -rf /tmp/a /tmp/b` is denied too: split it into two commands. `/tmp/../x` is not caught.
- Bash deny rules can be bypassed by quoting (`r""m`) or double spaces. Path rules are the stronger guard.
- Any tool that spawns its own shell (not `bash`) bypasses the bash rules. Reject packages that do this.
- `yoloMode: true` auto-approves "ask" rules (sudo, force push, `reset --hard`, `git clean`, `timeout`/`env` wrappers). Explicit denies still hold.
- The `*.env` path rule also blocks `git ls-files --error-unmatch .env`.

### pi-web and secrets
- Restart pi-web from inside a pi-web session only detached: `systemd-run --user --on-active=30 systemctl --user restart pi-web`. A direct restart kills the session doing it.
- Update: `PATH=/usr/bin:/bin npm i -g @agegr/pi-web@latest && systemctl --user restart pi-web`.
- systemd never reads `~/.zshenv`. Env for pi-web goes in the unit file or `~/.config/pi-web/env`.
- pi-web evicts a session after 10 min idle (`PI_WEB_IDLE_TIMEOUT_MS`). Extensions hold it via the `Symbol.for("@agegr/pi-web/session-liveness/v1")` registry; bg-bash does.
- Never read or print `~/.pi/agent/auth.json`, `~/.config/pi-web/env`, `~/.codex/auth.json`. Pass the pi-web password to curl from inside `bash -c`.
- Missing todo panel in pi-web: reload the page. The `rpiv-todos` button sits bottom-left, below the message box.

### Config and context files
- Editing `settings.json` while pi runs is safe: pi re-reads it under a lock and merges only its own changes.
- pi loads `~/.pi/agent/AGENTS.md` (or `CLAUDE.md`), then one file per directory from cwd up to `/`. Nested files below cwd are never loaded. Never put an `AGENTS.md` in `~` or `~/.pi/agent/`.
- `/tmp/pi-bg-bash-*` log folders stay after pi exits (one per process). `/tmp` is tmpfs, so a reboot clears them.

### pi-lens
- "Clean" means something only in a project that type-checks on its own (real `tsconfig.json`, `node_modules`).
- The first LSP run per project under-reports (`lsp cold`). Run `lens_diagnostics mode=full` before claiming clean.
- In projects under `/tmp`, pi-lens writes a `.pi-lens-probe-home/` folder.
- `pi_lens_activate_tools` cannot be disabled in config (PILENS_CFG_0009); `hide-tools` hides it instead.
- Changing active tools mid-session is one full cache miss, even on Opus 5.5: `pi-permission-system` returns a full `systemPrompt` from `before_agent_start` (real test 2026-09-24). Hiding a tool from session start is free.
- pi-lens `rules.<id>.disable` and `ignore` work only in a project `.pi-lens.json`, found by walking up from the project but not reaching `~` (home-level files are ignored, tested 2026-09-24). Files created by bash (`cp`, `mv`, redirects) count as new, so every finding in them shows.

## Decisions and why

### Models and roles
- **Main: Opus 5.5, thinking high** (2026-09-22). Replaced Fable 5.1. In the effort A/B all levels passed; high was better at nothing measured ($0.23 vs $0.21 medium per task). The user chose high. Low broke the bash-edit rule.
- **Builder: Opus 5.5, thinking medium** (2026-09-22). Faster than Opus 5 (feature task 40 s vs 62 s) and cheaper per token (4/20/0.2 vs 5/25/0.5 USD per M). Low was faster but not chosen.
- **Explore: GPT-5.6 Luna, low** (2026-09-17, reconfirmed 09-22). Accurate and fast (18–22 s) in the first bake-off; 15/15 on the hard test.
- **GPT-6 Sol not used** (2026-09-22): 15/15 with half the tokens, but a far smaller Codex allowance, shared with Astra.
- **Opus 5.5 not used as explorer** (2026-09-22): 22/22 at medium on the follow-up, but it spends Anthropic usage.
- **Exploration goes to `Explore`** (2026-09-22). Before this rule Opus delegated 0 of 22 runs. After: broad traces delegated 2/2; quick targeted greps stay local (2–3x faster than a spawn).
- **explore-glm: GLM-5.3** for parallel fan-out, only when Codex is rate-limited. GLM-5.3-Flash rejected: invented line numbers in 2 of 4 answers. GPT-5.6 Terra: same accuracy as Luna, more quota.
- **Reviewer: GPT-6 Astra, high** (2026-09-17). 4 of 5 real reviews found a real defect; $1–3 and 2.5–5 min each.
- **Sonnet 5.5 not used as explorer or builder** (2026-09-29, `wip/model-ab/RESULTS.md`; the user: Anthropic usage is no constraint). Explore: 15/16 vs Luna 16/16, 22 s vs 28 s. Builder on 3 real commits with hidden tests: 2/4 vs Opus 4/4, ~2x faster, missed an edge case twice. GPT-6 Luna explorer 14/16.
- **Codex allowance** (2026-09-22, Pro 5x per 5 h, estimates): Luna 1,250–10,000, Sol 70–700, Astra 25–225.

### Anthropic auth and billing
- **Root cause of the 400s** (2026-09-18): pi's "Pi documentation" prompt block made Anthropic classify the request as third-party. Org overage is disabled, so such requests are refused, not billed.
- **`@gotgenes/pi-anthropic-auth` instead of own `plan-billing`** (2026-09-18). It shapes every request, including compaction calls; `before_agent_start` hooks do not reach compaction.
- **Auth 2.0.10 → 3.2.2, version pin removed** (2026-09-23). 2.x supports only pi ≤0.85 and cut pi 0.87's prompt badly (stray `</docs>`, extra first message). A pin disables 3.x's automatic version raise and retry.
- **Billing is not proven by a 200** (2026-09-22). The adapter uses Claude Code billing framing. The user's usage page on 2026-09-23 looked fine.
- **`warnings.anthropicExtraUsage: false`** (2026-09-18): pi printed the warning every session.

### Prompt cache and context size
- **1 h cache TTL in the main session** (`cache-ttl`, 2026-09-20). $75.50 of one session's $79.82 re-billing came from 5–23 min pauses. 1 h writes cost 2x base instead of 1.25x; since then 4.9M tokens were read from cache after pauses vs 0.6M rewritten.
- **`PI_CACHE_RETENTION` stays unset** (2026-09-20): it would switch sub-agents to 1 h too. Sub-agents keep 5 min.
- **Sub-agent hand-off at 240 s** (bg-bash, 2026-09-20) keeps the child's 5 min cache warm.
- **Advisor session id patch** (2026-09-17): repeat advisor calls went from 0 to ~21k cached tokens; cost per repeat 0.21 → 0.025 USD.
- **pi's built-in `cacheWarming`**: fired twice in total (checked 2026-09-23). Nothing to change.
- **No per-turn prompt rewrites.** Payload stays byte-identical between turns; verified for `tool-groups`, `arg-fixes` and the #962 patch.
- **`compact-at` at 40 %** (2026-09-20). pi 0.85.1 ignored `compaction.modelOverrides`; one `reserveTokens` cannot fit 1M and 272k windows. Re-prompts after compacting, waits for background sub-agents; inert in children and (since 2026-09-28) in print/JSON mode, where its abort killed `pi -p` runs.
- **`compaction.reserveTokens` 65536** (2026-09-29). The summary may use 0.8 × reserve output tokens, thinking included: 13,107 at the default; this session's summaries grew to 11.5–12.5K and then failed with "hit the token cap". A test compaction of its copy used 15.8K.
- **Auto-retry raised to 8 tries, 3 s base** (2026-09-20). Defaults covered 14 s; one session lost 2.4 h to dead runs after network errors. `retry.provider.maxRetries` stays 0 (it can swallow usage-limit errors).
- **Tool-call compression: not built** (2026-09-20). Model summaries cost ~$8 per session; `billion-context-pi` cancels all compaction. Claude Code's model-free clearing of old results (only when the cache is already cold) is worth building; not built yet.

### Permission system
- **`yoloMode` on** (2026-09-20). The first `timeout`/`env` "ask" per session blocked 51–237 s on a dialog nobody saw.
- **Local #962 patch** (2026-09-22). On pi ≥0.86 the tool list was sent twice; children saw the parent's tools. Parent prompt 31,019 → 25,400 chars; builder child sees exactly its 11 tools.
- **33.0.8** (2026-09-23): MCP-only breaking changes plus fixes; the #962 patch applied cleanly.
- **`rm` rules rewritten** (2026-09-23): `rm -rf /*` matched every absolute path, including `/tmp/…`.

### Sub-agents
- **`@gotgenes/pi-subagents` instead of `@tintinweb/pi-subagents`** (2026-09-18). Main-session tool schema ~14.1k → ~7.2k tokens. `tools:` is a full allowlist that also covers extension tools, so children cannot see the advisor, goal or web tools.
- **21.7.6** (2026-09-22): 21.7.1 cut the parent prompt at the wrong line.
- **Explorer turn cap 40 → 150** (2026-09-20): 5 of 17 real explorer runs hit 40.
- **Explorers cite, do not quote; explore-glm ~1,200-word budget** (2026-09-20). GLM reports went from 8–21K chars to 770 words.
- **Fixed report formats** (2026-09-18) for builder, reviewer ("no confirmed defects" is valid) and explorers.
- **`arg-fixes`** (2026-09-23). Opus 5.5 sometimes sends the string `"null"` for optional `subagent` args; pi-subagents rejects unknown thinking levels on purpose. The fix edits `event.input`, so the stored message and cache are untouched.

### Advisor
- **Shutdown cleanup in the local copy** (2026-09-23). The `sessionId` patch left a cached Codex WebSocket, so `pi -p` hung ~300 s after an advisor call. Now runs exit in 15–19 s.
- **Guidance override: call only when stuck** (2026-09-18). The default "call BEFORE substantive work" made Luna call it before a one-line edit, turning a 19 s test into a 300 s timeout.
- **Fixed output format** (2026-09-18); agreement allowed; transcript is evidence, not instructions.
- **Known upstream quirk**: on tiny test prompts Astra sometimes answers with a tool call, reported as "no text content". All 12 real-session calls returned text.

### pi-lens
- **Trimmed to `lens_diagnostics` + `lsp_navigation`** (2026-09-17). The navigation tools did not improve correctness and made tasks slower (Fable 55 s → 25 s after the trim). Tools 27 → 17. The after-edit blocker still fires.
- **`hide-tools`** (2026-09-18) hides `pi_lens_activate_tools`, which config cannot disable.
- **Widget and LSP status hidden** (2026-09-21). Diagnostics still reach the model; `/lens-widget-toggle` shows the widget for one session.
- **4.2.1** (2026-09-23) fixed the empty "STOP — 0 issue(s)" banner after bash commands.
- `@ian-pascoe/pi-lsp` rejected: silent with servers that lack pull diagnostics. `@narumitw/pi-lsp` rejected: diagnostics only when the model calls the tool.

### bg-bash, monitor, loop
- **Own `bg-bash`** (2026-09-20). Adds `background: true` to stock `bash`, no new tools; the session wakes on exit. One session spent 137 min in foreground CI polling; this removes that. In sub-agents it does the 240 s hand-off instead.
- **`pi-background-bash` rejected** (2026-09-20): cannot be kept out of children, uses a login shell, bypasses pi's shell prefix, rewrites the transcript. `@richardgill/pi-background-bash` and `pi-patty-bg-tasks` replace `bash` or add 4+ tools.
- **Monitor + `/loop` inside bg-bash** (2026-09-23). As a `bash` parameter it stays under the permission rules. Design: `wip/bg-bash/DESIGN-monitor-loop.md`.
- **Monitor packages rejected** (2026-09-23): `clankercode/pi-monitor`, `codesoda/pi-event-monitor`, `gregjohnso/pi-monitor`, `pi-better-background-tasks`. Each spawns `sh -c` itself (bypasses bash rules); two wake with `steer` + `triggerTurn`, which can race.
- **pi-web liveness** (2026-09-23): bg-bash holds the session open while a job runs or a loop is scheduled.
- Known residual: a job finishing between prompt submit and bg-bash's `input` handler can make pi reject the prompt ("Agent is already processing"). Needs a busy state inside pi.

### pi-web
- **`@agegr/pi-web`** (2026-09-22). Browser UI sharing `~/.pi/agent/sessions`; binds `127.0.0.1:30141` only; public through a Cloudflare tunnel. Password only, no Cloudflare Access (user's choice).
- **`shellCommandPrefix: "unset NODE_ENV"`** (2026-09-23). Next.js set `NODE_ENV=production`, so `npm ci` silently skipped devDependencies.
- **T3 Code dropped** (2026-09-22): stable has no Pi provider; the preview cannot resume Pi threads (t3code#12467).

### Prompt and system-append tuning
- **ADHD style append** (2026-09-18): copied (not symlinked) from the user's claude-config. Children inherit it; `# Scope` exempts them from the style rules.
- **Skills trimmed 18 → 3** (2026-09-18): the skills block went 7.4 KB → 3.1 KB. caveman moved out: it fought the style rules.
- **Working rules from Anthropic's Fable 5.1 guide** (2026-09-18). A scan of 694 user messages found "continue" (57) and "verify" (37) as the top corrections.
- **Instruction boundary reworded** (2026-09-20): Fable took a pasted recap for a tool message and waited. Now everything in a user turn is from the user.
- **`edit`, not bash, for file changes** (2026-09-20): one session had 33 heredoc rewrites; the replay had 0.
- **Todo tool instead of plan files** (2026-09-20): `rpiv-todo`, guidance trimmed 8 → 4 lines; sub-agents do not get it.
- **Opus 5.5 edits** (2026-09-22): when to delegate, scope rule aligned with Completeness, correct earlier statements only when it matters. Not added: thinking instructions, verification steps (Opus over-verifies), `<pasted_content>` tags.
- **Output-length pass** (2026-09-23): answers were walls of text. Fix: Concise-style "Response style" and a "Final message" shape (outcome, detail, `Open:` up to 3 lines, next action; ~8 lines, 15 for large tasks). A `style-reminder` extension was tried and removed (dev copy `wip/style-reminder/`).
- **Opus 5.5 guide check** (2026-09-23): mostly covered; `compact-at`'s continue message now says to run `todo list` first.
- **Tool-definition size** (2026-09-23): 29.5K chars → 13.1K (`web_search` allowlist, pi-goal gone, built-in agents off, `tool-trim`). A/B 4 tool-heavy tasks: all pass, no bad tool args.
- **Token-efficiency pass** (2026-09-23; details and tools in `wip/token-audit/`). Baseline week $544, 47 % cache writes. Lean append live 2026-09-24 (19.0K → 7.7K chars): A/B 35/35 both, cost per task −26 %, tool errors 0.40 → 0.17.
- **Offers instead of work** (2026-09-26): 40 of 212 user messages were "continue" nudges. 2026-09-30 replay eval (`wip/pi-eval/RESULTS.md`, 36 real decision points): 3 append rewrites gained nothing; `auto-continue` on by default raised passes 68→85% train, 71→79% test, 0 made worse.
- **`find-gaps` skill** (2026-09-26/28; details `wip/find-gaps/DESIGN.md`): autonomous multi-day run in a `<repo>.find-gaps` worktree; in pi by default, `--headless` for systemd. Classes fixed repo-wide, projects for big work; the runner enforces a review per commit and a skeptic per finding. Batched PRs, one open; `--merge` merges green PRs. Board: own server, pi-web's cookie, writes via `run.sh answer`/`stop`.
- **`pi-goal` removed** (2026-09-23; installed 09-18, chosen over `@recynie/pi-goal` and `pi-supervisor`). No independent evaluator (the working model grades its own completion) and its tools were never called in 169 sessions.

### UI
- **`tool-groups`** (2026-09-21): consecutive tool calls draw as one line ("Read 2 files, ran 1 command"); ctrl+o expands. Payload byte-identical with and without it. `PI_TOOL_GROUPS=off` disables it.
- **Thinking display omitted** (2026-09-21, main session): thinking still happens and is billed. The advisor and compaction no longer see thinking summaries. `PI_THINKING_DISPLAY=summarized` restores it.

### Portable kit
- **`pi-kit` with Copilot for sub-agents** (2026-09-23). Copilot has the same `gpt-5.6-luna`/`gpt-6-astra`, so the swap is placeholders. Docker test: Explore and the advisor route to `github-copilot`; a real Copilot turn needs a GitHub login. GPT-6 Astra needs Copilot Pro+.
- **pi-lab public on GitHub** (2026-10-05): the only off-machine copy of the setup, and reusable. `.gitignore` keeps out the find-gaps loop (user's choice), eval cases and runs (excerpts of private sessions), the chat-message research file (held a password) and `*.jsonl`. Host details (URLs, host name, prod paths, loop operations) live in the gitignored `AGENTS.override.md`, which pi loads instead of `AGENTS.md`; the first push still had them, so `main` was rewritten (a deleted-and-recreated repo would also drop the old commit). `gitleaks` 8.30 plus a password grep found nothing in the 521 files. `server/setup-root.sh` + `install-user.sh` replace the one-shot move script for the host layer; `server/test/` checks the user side in Debian.
- **Left out of the kit**: pi-web, `models.json` (local Gemma), `code-intel.json` (semvex), the skills `.venv` (667 MB), and the project `.env` permission allows.

### Evaluated and rejected
- **OmO Native (`omo-ai` 5.0.0 on senpi, a pi fork)** (2026-09-26, mock capture in Docker): 3× our static prompt, telemetry on, 5-min cache (ours 1 h). Worth borrowing: `tool_search`, per-category routing.
- **NVlabs SoL-Pi** (2026-09-23): neither mechanism fired in 6 runs; best case on real sessions 2.6 % saving. Its `then_run` runs shell commands inside `edit`/`write`, bypassing bash rules.
- **`@vanillagreen/pi-claude-bridge`** (2026-09-18): removed at the user's request; direct login fixed instead.
- **`@tintinweb/pi-subagents`** (2026-09-18): ~8,200 schema tokens; silently falls back to the parent model; force-removes a worktree on a failed commit.
- **`gsd-pi`** (2026-09-17): uninstalled, with its `gsd-web` service and `gsd-update` timer. Last use April. `~/.gsd` kept.
- **T3 Code, monitor, background-bash and pi-lsp packages, `billion-context-pi`**: see their topics above. **context7**: see Open items.
- **`pi-workspace-history`, `@plannotator/pi-extension`** (2026-09-17): removed at the user's request. Plannotator plan mode blocked only `write`/`edit`, not bash.
- `@henryqw/pi-subagent` (3 companion packages), `@ayulab/pi-rewind` (archived, `git clean` data loss), `pi-hermes-memory`/`pi-memory` (background calls, memory in the system prompt).
- `pi-hashline-edit-pro`: disables `edit`, weak checksums, no measured saving.
- `pi-agent-browser-native`, `gentle-pi`: change the prompt between turns (cache); gentle-pi also downloads a binary.
- `pi-goal-x`: manifest requires pi below 0.85. `pi-repl-py`: 107 MB venv in `~/.pi/agent`.
- `@mjasnikovs/pi-task`, `bigpowers`, `pi-gsd`, `@devinat1/pi-debugger`, `pi-papercuts`: heavy, overlapping or dead.

## History

- 2026-10-05 — Public repo `SlanyCukr/pi-lab` (pi-kit refreshed, `server/` installers + test); find-gaps: OOM-proof units, affected suites only, `hold-push`, scheduled-run failures handed to cycles (G184); G180 prod backfills done (echo24 codes 1264; missing bylines: 709 credited, 3006 recredited)
- 2026-10-04 — Pi loop check; auto-continue stops on prices; stale PRs riot-api-project#9, security-money-maker#2 closed; cycles get 45 min past 3 h for a running review; ImageMagick on the Pi

- 2026-09-24 — Lean append (A/B −26 %/task); `/loop` tools hidden; pi-lens style rules off; Guidelines 3.6K → 2.2K
- 2026-09-23 — `rpiv-ask-user-question` removed; `tool-trim` (tool defs 24.7K → 13.1K, pi-lens skills hidden); ADHD rule 1 "lead with the outcome"
- 2026-09-23 — Token pass (prompt pin, built-in sub-agents off, `analyze.py`); pi-goal removed; `web_search` allowlist; output-length pass
- 2026-09-23 — `pi-kit` + Docker test; `arg-fixes`; monitor + `/loop` in bg-bash; npm `allowScripts`, advisor 2.11.0
- 2026-09-23 — Updates: pi 0.87.1, auth 3.2.2 (pin removed), permission-system 33.0.8, minor packages; `NODE_ENV` fix; `rm` rules
- 2026-09-23 — SoL-Pi trial: not installed
- 2026-09-22 — Delegation audit, model-role check, explorer tests (Opus 5.5 vs Sol, 12 scenarios), pi-web todo check; no changes
- 2026-09-22 — Default model Opus 5.5; pi-web installed and published
- 2026-09-22 — Tool list sent twice: pi-subagents 21.7.6, local #962 patch
- 2026-09-22 — Opus 5.5 tuning: append edits, effort A/B, builder on Opus 5.5, Explore rule, GPT-6 Luna tried and reverted
- 2026-09-21 — `tool-groups` extension; pi-lens widget hidden
- 2026-09-20 — `bg-bash`, `cache-ttl`, `compact-at`, `rpiv-todo`; `edit`-not-bash rule; instruction boundary; auto-retry raised; real-session review
- 2026-09-18 — `@gotgenes/pi-subagents` and `pi-anthropic-auth`; prompt parity and ADHD append; `pi-goal`, `hide-tools`; advisor over-calling fixed
- 2026-09-17 — Original install on pi 0.85.1 (23 extensions probed, 9 installed); advisor patched; pi-lens trimmed
