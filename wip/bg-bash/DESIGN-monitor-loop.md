# bg-bash: monitor mode + /loop (2026-09-23)

Goal: Claude Code parity for `Monitor` (incl. `persistent`) and `/loop` (+ `ScheduleWakeup`), inside bg-bash so all
wake-ups share one race-safe queue (flush only when pi is idle, no compaction, no pending prompt).

## Monitor (a mode of the `bash` tool, so pi-permission-system's bash rules apply unchanged)
- `bash {command, monitor: true, persistent?, timeout?}`; main session only (a sub-agent's run ends before events arrive).
- Starts handed off like `background: true`. Each non-empty **stdout** line is an event (stderr goes to the log only).
  Lines are cut at 500 chars, batched: first line arms a 1 s timer, then one queue entry per monitor that renders
  all lines buffered at flush time (so lines keep batching while pi is busy). Buffer keeps the newest 100 lines,
  counts the dropped ones and points to the log.
- Flood stop: more than 120 lines in a rolling minute terminates the monitor with a "tighter filter" notice.
- Expiry: `timeout` default 300 s, max 3600 s; `persistent: true` without timeout runs until stopped or the session ends.
  With `persistent: true`, an explicitly given timeout is honoured as is (no 3600 s cap): persistent means session-length.
- Stop: `pi-bg-stop <id>` (answered by the tool itself, like `pi-bg-wait`): terminates the group, no wake-up.
  Works for plain background jobs too.
- End notice: expired / flooded / exited (code, events delivered, remaining lines, log tail on non-zero exit).
- MAX_JOBS default 4 -> 8 (monitors count).

## pi-web liveness
pi-web evicts a session after 10 idle minutes. Register with `globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")]`
on session_start, `isActive = handed-off jobs running || loops scheduled`, release on session_shutdown. No-op outside pi-web.

## Loops (`loop.ts`)
- `/loop` (list), `/loop <interval> <prompt>` (recurring, first tick queued now), `/loop <prompt>` (self-paced:
  prompt runs now with instructions to call `schedule_wakeup` at the end of each turn), `/loop stop <id|all>`.
  Interval `\d+[smhd]`, minimum 60 s. Recurring loops expire after 7 days. Max 10 loops.
- Tools (main session only): `schedule_wakeup {delaySeconds 60-3600, prompt, reason}` or `{stop: true}` (one pending
  wake-up; a new one replaces it), `loop {action: create|list|cancel, interval, prompt, id}`.
- A tick is sent with `pi.sendUserMessage(text, {expandPromptTemplates: true})` when idle, so `/cmd` and `/skill:x`
  prompts work. A tick that comes due while the previous one is still queued is skipped (counted as missed).
- Custom (bg-bash) messages and user-message ticks never go out in the same flush: custom first, the tick after the
  next agent_end.
- Timers are unref'd (headless `pi -p` must still exit); state is in memory only (dies with the session, like CC).
- A self-paced loop keeps one id across runs. Stop/replace bumps a generation; the run a paced tick started (matched
  via the `input` event containing the tick text, bound at agent_start, kept until agent_settled) cannot re-arm or
  stop a newer generation. Residual: an input handler that rewrites the text entirely leaves that run unowned, so a
  stop issued during it could be undone by its own schedule_wakeup.

## Review
Cross-vendor reviewer (gpt-6-astra), 4 rounds, 15 findings: 14 fixed, 1 accepted as intended (persistent timeout),
the last one reduced to the residual above. Real-run tests T1-T12 in /tmp/mt (see REPORT.md).
