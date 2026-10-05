#!/usr/bin/env bash
# mk.sh <commit-ish> <dir>: snapshot of media_monitoring at <commit-ish>, sharing node_modules and the venv
R=~/Documents/personal/projects/media_monitoring
rm -rf "$2" && mkdir -p "$2" && git -C $R archive "$1" | tar -x -C "$2"
ln -s $R/frontend/node_modules "$2/frontend/node_modules"; ln -s $R/backend/.venv "$2/backend/.venv"
(cd "$2" && git init -q && git add -A >/dev/null && git -c user.email=x@x -c user.name=x commit -qm base)
