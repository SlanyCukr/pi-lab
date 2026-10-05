Implement this change:

Why: scripts/backup.sh mirrored only the current run's files, so the dumps
made while the backup host was unreachable (mm-20260926_013001 and
mm-20260927_013000, "No route to host") never reached it, although the
next good run reported "Local backup and off-box mirror verified". The
host is intermittently offline, so this recurs.

What changed (scripts/backup.sh mirror step only; dump, local rotation and
lock unchanged):
- one remote manifest call lists each held dump's size and sidecar checksum;
- every local dump with a sidecar is sent, oldest stamp first, when the host
  lacks it or holds another size or checksum (a cut upload);
- a dump is verified locally against its sidecar first; one that fails is
  not mirrored, is named on stderr and fails the run (exit 1);
- an upload goes to a hidden `.name.partial`, is checked there against the
  local checksum, and only then is moved to its name and given its sidecar,
  so a failed or cut transfer never looks mirrored to the next run; `scp -p`
  keeps the dump's age for remote retention;
- remote retention runs after the catch-up and also drops partial uploads
  older than a day;
- the file list is read on fd 3 so ssh/scp cannot swallow it from stdin.
README Backups paragraph describes the catch-up.

This is a snapshot of the media_monitoring repo (git-initialised; do not commit). Write or extend tests for your change and run them. Acceptance: an independent test file is run after you finish.
Scope: `scripts/backup.sh`, `README.md`, `backend/tests/test_backup_script.py` (existing tests there must keep passing).
Command: `cd backend && PYTHONPATH=$PWD .venv/bin/python -m pytest -q tests/test_backup_script.py`.
