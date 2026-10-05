Read-only adversarial review. Do not modify anything. Your job is to reject.

Files in cwd: index.ts (new version) and index.v1.ts (previous version, which went through seven review rounds; do not re-review what is unchanged), plus cache-ttl.ts. Both are extensions for the pi coding agent v0.85 on one Linux workstation.

What changed in index.ts:
- Main-session foreground commands still delegate to stock bash untouched.
- `background: true` (main session) and EVERY command in a sub-agent now run through the stock tool with a custom `operations.exec` (function `exec`): pipes instead of a log fd, output written to a log and forwarded to stock's onData until hand-off, hand-off = the exec promise resolves {exitCode: 0} while the process keeps running, then the tool result is patched with a notice.
- Sub-agents: automatic hand-off after 240 s so the model's next request keeps its 5-minute prompt cache warm; the child continues with the pseudo-command `pi-bg-wait <id>` (answered by the tool, never executed), which blocks up to another 240 s and returns new output; a command still running at the child's agent_end is killed (stopAll).
- Exit detection mirrors stock's waitForChildProcess (exit + both streams ended, or 100 ms idle after exit).

cache-ttl.ts: in the main session only, rewrites Anthropic `cache_control: {type:"ephemeral"}` breakpoints to `ttl: "1h"` in before_provider_request; sub-agents keep 5 minutes.

A first review of this version led to four fixes: no hand-off once aborted, timed out or terminating; cache-ttl rewrites only system blocks, tool definitions and top-level message content blocks; stopAll records a result and wakes pending waiters; shell config resolved before the log fd opens. Check those.

A second review led to: group SIGKILL moved into the exit handler for an outside kill plus a 1 s hard cap on the output drain; completion messages queued by job identity and dropped when pi-bg-wait returns the final result. Check those.

Accepted (do not report): everything in the "Known limit" header; project-level shell settings not honoured; pid-space-wrap reuse; deliberate daemons surviving a normal exit; Windows falls back to stock; the permission gate sees `pi-bg-wait bgN` as an ordinary allowed command.

Find real defects in the CHANGED logic, each with line number, concrete failure scenario and minimal fix. Look hard at: the settled/finished/handedOff state machine in exec (double resolve, a promise that never settles, fd double-close or leak, log unlink races), abort and timeout before vs after hand-off, stdout pipes held by pi after hand-off (backpressure, SIGPIPE on shutdown), exit-before-hand-off races at exactly the timer boundary, waiters vs the follow-up message (lost or duplicated result), stopAll at a child's agent_end while a pi-bg-wait is pending, parity with stock for an ordinary short command in a sub-agent, and in cache-ttl.ts anything that could corrupt a payload or break Anthropic's rule that longer-TTL breakpoints precede shorter ones. Max 450 words, ranked. Say explicitly whether you would ship.
