#!/usr/bin/env bash
# Start pi in the pi-kit box, keeping logins and sessions between runs.
#   box/run.sh [project-folder]   (default: current folder, mounted at /workspace)
# The container is kept (not --rm), so /login only has to happen once.
# The project folder is fixed when the container is first created;
# to switch folders: docker rm pi-kit, then run this script again.
set -euo pipefail
NAME=pi-kit
if docker container inspect "$NAME" >/dev/null 2>&1; then
  exec docker start -ai "$NAME"
fi
DIR="$(cd "${1:-.}" && pwd)"
exec docker run -it --name "$NAME" -v "$DIR":/workspace pi-kit-box
