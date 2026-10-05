# server: a headless pi host

Sets up a machine (here a Raspberry Pi 5) so an unprivileged user runs pi and pi-web around the clock.
The pi configuration itself comes from `../pi-kit`. The find-gaps loop is not part of this.

## Install on a new machine

1. Clone this repo on the machine, as an admin user: `git clone git@github.com:SlanyCukr/pi-lab.git && cd pi-lab`.
2. Root side, once: `sudo ./server/setup-root.sh --user loop --deny /home/pi`.
   It creates the user, enables linger, caps the user's memory and CPU, and blocks the listed paths.
3. Become the user: `sudo -iu loop`, then clone the repo again (or copy it) into its home.
4. User side: `./server/install-user.sh --sub openai`.
   It installs Node 24, pi with the kit, and pi-web as a user service on `127.0.0.1:30141`.
5. Log in: run `pi`, type `/login`, pick Anthropic; `/login` again for the sub-agent plan.

Both scripts are safe to run again. `--help` lists the flags.

## Not automated

- **Public access:** the Cloudflare tunnel runs as root (`cloudflared` service). Point a hostname at `http://127.0.0.1:30141`, then rerun `install-user.sh --public-host <name>`.
- **Logins and secrets:** `/login` in pi, `gh auth login`, search-provider keys for `web_search`. None are in this repo.
- **The pi-web password:** generated into `~/.config/pi-web/env` on the first run; read it there.

## Test

`podman build -t localhost/pi-host-test -f server/test/Dockerfile .` then `podman run --rm localhost/pi-host-test` runs the user side in a fresh Debian container (no systemd) and checks the result.
