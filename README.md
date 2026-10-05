# pi-lab

My setup for the [pi coding agent](https://github.com/earendil-works/pi): the configuration, my own extensions, the research behind each choice, and scripts to install it all on another machine.
It runs on a Raspberry Pi 5 as a headless host: pi in the terminal, pi-web in the browser.

## Install it elsewhere

- **Just the pi setup** (any Linux or macOS with Node ≥ 22.19): `cd pi-kit && ./install.sh --install-pi --sub openai`. See [pi-kit/README.md](pi-kit/README.md); `pi-kit/box/` has a Docker image and a credential-free test.
- **A whole headless host** (dedicated user, memory caps, pi-web as a service): see [server/README.md](server/README.md).

Logins are never in the repo: run `pi`, then `/login`.

## What is here

| Path | What |
|---|---|
| `pi-kit/` | Portable snapshot of the live setup (`export.sh` refreshes it, `install.sh` installs it) |
| `server/` | Root and user installers for a headless host, plus a container test |
| `wip/<name>/` | Dev copies of my extensions with their tests and evaluation results |
| `research/` | Notes behind decisions (prompting, model choices, extension surveys) |
| `REPORT.md` | The log: current setup, open items, gotchas, decisions with reasons, history |
| `AGENTS.md` | Instructions for agents working in this repo |

## Main pieces

- Main session on Claude (Anthropic subscription); Explore, reviewer and advisor sub-agents on a ChatGPT, Codex or Copilot plan.
- Own extensions: `auto-continue`, `bg-bash` (background commands and monitors), `cache-ttl`, `compact-at`, `tool-trim`, `tool-groups`, `arg-fixes`, `hide-tools`, `model-check`.
- Locally patched packages: `pi-permission-system`, `rpiv-advisor` (both MIT, vendored with their licenses).
- A system-prompt append written for a reader with ADHD: outcome first, short, one next action.

Not included: the autonomous find-gaps loop, session transcripts, and anything with credentials.
