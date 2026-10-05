Implement this change. Context: commit 55700542 made a retried chat question be stored once; a reviewer found this race in it:

Reviewer P2 on 55700542: the resend check read the thread and then applied
removals without synchronization. Request B snapshotted A's unfinished tool
call; A finished; B removed A's question and tool-call message but not its
tool result and answer, so B's model input held a tool result without its
call.

What changed (backend/media_monitoring/chat/app.py): `ThreadLocks` keeps one
asyncio.Lock per thread while a request holds or awaits it (deleted when the
last one leaves). `_stream_events` holds the thread's lock across the state
read (`_turn_input`) and the whole graph run; the lock is taken before the
question deadline starts, so waiting for the thread's earlier question
(bounded by its own deadline) does not spend this one's. In-process is
enough and the docstring says why: `run` passes uvicorn an app object (no
worker processes possible), compose runs one chat-api container, no
replicas, and the prod override adds none; a second process would need a
Postgres advisory lock.

The registry is a module-level `THREAD_LOCKS` in `backend/media_monitoring/chat/app.py`; `len(THREAD_LOCKS)` is the number of threads whose lock is held or awaited (0 when idle).

This is a snapshot of the media_monitoring repo (git-initialised; do not commit). Write or extend tests for your change and run them. Acceptance: an independent test file is run after you finish.
Scope: `backend/media_monitoring/chat/app.py`, `backend/tests/test_chat_agent.py`.
Command: `cd backend && PYTHONPATH=$PWD .venv/bin/python -m pytest -q tests/test_chat_agent.py`.
