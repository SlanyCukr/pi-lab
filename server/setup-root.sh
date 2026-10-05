#!/usr/bin/env bash
# Root side of a headless pi host (Debian/Raspberry Pi OS): a dedicated unprivileged user that can run
# pi and pi-web around the clock without touching the rest of the machine. Idempotent; run with sudo.
#   sudo ./setup-root.sh --user loop [--memory-high 6G] [--memory-max 7G] [--cpu 250%] [--deny /home/pi ...]
# What it does:
#   - installs the system packages pi and the kit need (git, rsync, jq, curl, podman for a rootless `docker`);
#   - creates the user (no sudo, no docker group) with subuid/subgid ranges for rootless podman;
#   - enables linger, so the user's systemd units (pi-web) run without a login and survive reboots;
#   - caps the user's slice (memory, swap, CPU, tasks) so a runaway session cannot starve other services;
#   - removes the user's access to the given paths with an ACL (other users' homes, secrets, CI runners).
# Reverse: `loginctl disable-linger <user>`, delete /etc/systemd/system/user-<uid>.slice.d/50-pi-host.conf,
# `setfacl -x u:<user> <path>`, `userdel -r <user>`.
set -euo pipefail

user="" mem_high="6G" mem_max="7G" cpu="250%" deny=()
while [ $# -gt 0 ]; do
  case $1 in
    --user) user=$2; shift 2 ;;
    --memory-high) mem_high=$2; shift 2 ;;
    --memory-max) mem_max=$2; shift 2 ;;
    --cpu) cpu=$2; shift 2 ;;
    --deny) deny+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
[ -n "$user" ] || { echo "--user is required" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git rsync jq curl ca-certificates xz-utils acl podman uidmap slirp4netns > /dev/null

if ! id "$user" > /dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$user"
  echo "created user $user"
fi
uid=$(id -u "$user")
# Rootless podman needs subordinate id ranges; useradd adds them on recent Debian, older systems do not.
grep -q "^$user:" /etc/subuid || usermod --add-subuids 200000-265535 "$user"
grep -q "^$user:" /etc/subgid || usermod --add-subgids 200000-265535 "$user"

loginctl enable-linger "$user"

mkdir -p "/etc/systemd/system/user-$uid.slice.d"
cat > "/etc/systemd/system/user-$uid.slice.d/50-pi-host.conf" <<EOF
# pi-lab server/setup-root.sh: everything $user runs shares this budget (2026-10-04 on the Pi: 16 GB host, prod alongside).
[Slice]
MemoryHigh=$mem_high
MemoryMax=$mem_max
MemorySwapMax=2G
CPUQuota=$cpu
TasksMax=4096
EOF
systemctl daemon-reload

for p in "${deny[@]}"; do
  [ -e "$p" ] || { echo "skip --deny $p (does not exist)"; continue; }
  setfacl -m "u:$user:---" "$p"
  echo "denied $user access to $p"
done

echo "root side ready for $user (uid $uid): linger on, slice capped at $mem_max (high $mem_high), CPU $cpu."
echo "Next, as $user: ./server/install-user.sh --sub openai   (see server/README.md)"
