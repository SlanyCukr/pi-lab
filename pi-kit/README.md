# pi-kit

A portable copy of this machine's pi setup.
The main session runs on the Claude Code subscription (Anthropic). Explore, reviewer and the advisor run on GitHub Copilot, or on Codex with `--sub codex`.

## Use on another machine

1. Copy this folder over (for example `git clone`, or `rsync -a pi-kit/ other:pi-kit/`).
2. Run `./install.sh --install-pi`. Pick `--sub codex` to stay on Codex. It needs Node ≥ 22.19 and rsync. On the Pi (ChatGPT login stored as provider `openai`), pick `--sub openai`.
3. Run `pi`, type `/login` and pick Anthropic. Then run `/login` again and pick GitHub Copilot.

Files that would be overwritten are backed up to `~/.pi-kit-backup-<timestamp>/`.

## Use in Docker

1. `docker build -t pi-kit-box -f box/Dockerfile .`
2. `box/run.sh ~/some/project` starts pi with that folder at `/workspace`. Log in once; the container keeps the login.
3. `docker run --rm pi-kit-box bash /opt/pi-kit/box/test.sh` is a test that needs no credentials. A mock model drives pi through a `subagent` call and an `advisor` call.

## Refresh from the live setup

Run `./export.sh` on the source machine. It rebuilds `home/` from `~/.pi/agent` and friends, and it:
- replaces `openai-codex/` and the Codex wording with placeholders that `install.sh` fills in;
- skips secrets and machine-specific files (auth, sessions, `models.json`, `code-intel.json`, pi-web, the skills `.venv`);
- drops permission rules for paths under this home folder;
- aborts if anything that looks like a token slips in.

`model-check` (one of the exported extensions) warns at startup about sub-agent or advisor models that have no login.
pi-subagents falls back silently in that case: first to a fuzzy-matched model, then to the main model. So without it, Explore would quietly spend Anthropic usage.

## Not included

The find-gaps loop, the local Gemma provider, and the semvex code-intel config. pi-web (browser UI as a service) comes with `../server/install-user.sh`; the Cloudflare tunnel stays manual.
`web_search` works only if the machine has search-provider keys. `explore-glm` needs a Z.AI login.
