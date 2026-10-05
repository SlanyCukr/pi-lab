# pi-lab

Workbench for the user's pi coding-agent setup: research, tests and dev copies of own extensions.
The live configuration is NOT in this folder; this folder documents and tests it.

`REPORT.md` is the log. Its "Current setup" section at the top is the source of truth for what is installed;
read it before changing anything. Below it: open items, gotchas, decisions (with the reason), and a one-line history.

## This copy

The live copy runs on a Raspberry Pi as an unprivileged user (no sudo, no host docker, no access to production).
Host-specific details (host name, public URLs, services, the find-gaps loop and its standing instructions) live in `AGENTS.override.md`, which is not in git.

## Where things live

| What | Path |
|---|---|
| pi settings (default model, packages, retry) | `~/.pi/agent/settings.json` |
| System-prompt append (ADHD style) | `~/.pi/agent/APPEND_SYSTEM.md` |
| Sub-agents | `~/.pi/agent/agents/*.md` |
| Own extensions (live) | `~/.pi/agent/extensions/<name>/index.ts` |
| Own extensions (dev copies, tests, critic verdicts) | `~/pi-lab/wip/<name>/` |
| Patched advisor package | `~/.pi/agent/local-packages/rpiv-advisor` |
| Advisor / todo / pi-lens config | `~/.config/rpiv-advisor/advisor.json`, `~/.config/rpiv-todo/config.json`, `~/.pi-lens/config.json` |
| Skills | `~/.agents/skills/` (disabled ones in `~/.agents/skills.disabled/`) |
| Sessions | `~/.pi/agent/sessions/` |
| pi-web service + password | `~/.config/systemd/user/pi-web.service`, `~/.config/pi-web/env` |
| Claude Code version for Anthropic auth | none set: pi-anthropic-auth ≥3.1 follows pi's version and retries on `claude_code_version_too_old`. A `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` pin would disable that (removed 2026-09-23) |
| Patched permission-system | `~/.pi/agent/local-packages/pi-permission-system-<version>/` (dev copy `~/pi-lab/wip/`) |

## Rules

- **This folder is the public repo `github.com/SlanyCukr/pi-lab`.** After a change: `pi-kit/export.sh` if the live setup changed, then `git add -A`, `gitleaks dir` over the staged files (`git ls-files` copied to a temp dir) plus a grep for plain-text passwords, commit, push. Nothing derived from sessions, no credentials, no find-gaps loop (see `.gitignore`).
- **No backup folders.** The user never opens them (2026-09-29). Rollback is the `wip/` dev copy, the pi-kit copy or the previous package version; for a live file with neither, note the old value in the REPORT History line.
- **Develop extensions in `wip/`, then copy to `~/.pi/agent/extensions/`.** Keep the dev copy and the live copy in sync.
- **Update `REPORT.md` after every change, briefly:** fix "Current setup" if what is installed changed; add or edit one bullet under "Decisions and why" (what, why, key number, date) or "How to work here" for a new gotcha; add one line to "History". No run tables or long verification narratives; keep the file under ~30 KB. Detailed notes for a big piece of work go next to its code (e.g. `wip/<name>/DESIGN-*.md`).
- **Clean up after tests:** use `--no-session` or trash test session folders; keep scratch in `/tmp`.
- **Verify with real runs, not by reading config.** A change is done when a real pi turn shows it working (the session JSONL records the model, errors and tool calls).
- **`pi -p` from a script or background shell needs `< /dev/null`**, or it blocks forever.
- **Install global npm packages as this user** (`npm i -g …` goes to `~/.npm-global` with Node 24); the units use the same PATH.
- **Never read or print secrets:** `~/.pi/agent/auth.json`, `~/.config/pi-web/env`, `~/.config/gh/hosts.yml`. Pass the pi-web password to curl from inside a `bash -c` so it never shows in output.
- **Never put an `AGENTS.md` in `~` or `~/.pi/agent/`.** pi loads every `AGENTS.md` from the working directory up to `/`, so one there would apply to every session.
- **Test cache-sensitive changes against the real payload.** The main session relies on a stable prompt cache: avoid extensions that rewrite the system prompt per turn, and diff request payloads when in doubt.
