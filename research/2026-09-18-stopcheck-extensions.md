**Yes. Several existing Pi extensions implement this loop.** The closest matches are:

- **`@harms-haus/pi-til-done`** for unfinished task-list items.
- **`pi-supervisor`** for judging whether the agent stopped with incomplete work.
- **`@narumitw/pi-goal`** for continuing until an explicitly tracked goal is completed.
- **`@recynie/pi-goal`** for continuing until a separate verifier accepts the result.

I researched this on **September 18, 2026**, without installing packages or modifying files. Release dates and download counts below are the latest shown by the linked package catalog snapshots; they are not runtime compatibility tests.

**1. Candidates found**

| Package and source | Latest release observed; adoption | What triggers continuation, and what stops it | Maintenance assessment |
|---|---|---|---|
| **[`@narumitw/pi-goal`](https://www.npmjs.com/package/@narumitw/pi-goal)** · [GitHub](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal) | **0.54.6, September 18, 2026**; approximately **39,200 monthly downloads**. [Catalog](https://pi.dev/packages/@narumitw/pi-goal) | An active goal creates a continuation intent when a run ends. It dispatches once at `agent_settled`, after retries, compaction, and queued messages finish. Completion requires `goal_complete` with the current goal identifier and an evidence summary. Supports explicit blocked/waiting states, budgets, and no-progress limits. **It validates completion declarations but explicitly does not independently prove the work is complete.** | Strongest current maintenance signal among the focused goal extensions: release on the research date and documented current lifecycle handling. |
| **[`pi-codex-goal`](https://www.npmjs.com/package/pi-codex-goal)** · [GitHub](https://github.com/fitchmultz/pi-codex-goal) | **0.3.0, September 7, 2026**; **3,104 monthly downloads**, **190 repository stars**. [Catalog](https://pi.dev/packages/pi-codex-goal) | Tracks a session goal through `create_goal`, `get_goal`, and `update_goal`. Sends hidden continuation messages when idle while the goal remains active. Completion is model-declared through `update_goal`; it is not an independent acceptance test. Includes interruption, provider-error, compaction, and budget handling. | Recently released; substantial documented lifecycle and platform testing. |
| **[`@harms-haus/pi-til-done`](https://www.npmjs.com/package/@harms-haus/pi-til-done)** · [GitHub](https://github.com/harms-haus/pi-til-done) | **1.2.0, May 25, 2026**; **0 repository stars**; downloads unavailable. [Catalog](https://pi.dev/packages/@harms-haus/pi-til-done) | **Direct task-list match.** Registers `write_todos`, `list_todos`, and `edit_todos`. At `agent_end`, unfinished items schedule a three-second countdown and a continuation prompt. Stops when items are `completed` or `abandoned`, on interruption, or at its continuation limit. Task status is model-maintained, not independently verified. | Published and source available, but no recent release demonstrated. Current Pi compatibility needs checking. |
| **[`pi-supervisor`](https://www.npmjs.com/package/pi-supervisor)** · [GitHub](https://github.com/tintinweb/pi-supervisor) | **0.5.0, May 31, 2026**; **191 monthly downloads**, **71 repository stars**. [Catalog](https://pi.dev/packages/pi-supervisor) | **Closest semantic “done check.”** A separate model evaluates the conversation against `/supervise <outcome>`. At run end it chooses `done` or sends corrective instructions through `pi.sendUserMessage`. Can recognize incomplete work, questions, and partial progress without a task-list tool. Customizable through `SUPERVISOR.md`. | Described as an early release; no newer release demonstrated. Important implementation caveats below. |
| **[`@recynie/pi-goal`](https://www.npmjs.com/package/@recynie/pi-goal)** · [GitHub](https://github.com/recynie/pi-goal) | **0.2.1, August 30, 2026**; **484 monthly downloads**, **1 repository star**. [Catalog](https://pi.dev/packages/@recynie/pi-goal) | Establishes a user-approved goal specification and automatically continues active work. When the worker calls `goal_submit`, a **fresh-context verifier inspects the workspace and runs checks**. Rejection sends feedback to the worker and resumes execution. Includes automatic-run and no-progress limits. | Recent but small and young project. Best architectural match for independently checked completion. |
| **[`pi-until-done`](https://www.npmjs.com/package/pi-until-done)** · [GitHub](https://github.com/srinitude/pi-until-done) | **0.3.1, July 22, 2026**; **232 monthly downloads**, **32 repository stars**. [Catalog](https://pi.dev/packages/pi-until-done) | Approved goal contract, dependency-aware plan, bounded continuation at `agent_settled`, verification commands, and a mandatory model judge. A judge’s `continue` verdict rejects completion. **Judge infrastructure failures can fail open with a warning.** | Published, but deliberately tied to exact Pi releases. The catalog’s compatibility table still describes version 0.3.0 against Pi 0.81.1; verify the selected artifact before adopting. |
| **[`@signalridge/pi-ralph-wiggum`](https://www.npmjs.com/package/@signalridge/pi-ralph-wiggum)** | **1.2.4, September 9, 2026**; **576 monthly downloads**. [Catalog](https://pi.dev/packages/@signalridge/pi-ralph-wiggum) | Iterates **inside the same Pi session**, using a persisted Markdown checklist. `ralph_done` queues the next prompt. Completion uses a completion promise and verification guidance; the default maximum is 50 iterations. This is an explicit Ralph workflow, rather than a transparent check on every ordinary answer. | Recently released. |
| **[`@lnilluv/pi-ralph-loop`](https://www.npmjs.com/package/@lnilluv/pi-ralph-loop)** · [GitHub](https://github.com/lnilluv/pi-ralph-loop) | **2.1.0, September 8, 2026**; **349 monthly downloads**, **10 repository stars**. [Catalog](https://pi.dev/packages/@lnilluv/pi-ralph-loop) | Runs campaigns across **fresh child Pi processes**, with fresh command evidence, completion promises, and optional required acceptance gates. Required gates can demand outputs and successful acceptance-command reruns. Also stops for cancellation, iteration limits, or exhausted progress. | Recently released. Relevant for unattended campaigns, less direct for preserving one interactive conversation. |
| **[`@hank-warren/pi-loop`](https://www.npmjs.com/package/@hank-warren/pi-loop)** | **1.2.0, September 6, 2026**; **2,568 monthly downloads**. [Catalog](https://pi.dev/packages/@hank-warren/pi-loop) | Records continuation at `agent_end` and delivers at settled idle boundaries. Tracks an objective, completion evidence, durable progress, and repeated no-progress responses. | **Explicitly deprecated.** Still installable from npm, but receives no new features; its author moved toward a supervising-session approach. |
| **[`@linimin/pi-letscook`](https://www.npmjs.com/package/@linimin/pi-letscook)** | **0.1.91, June 26, 2026**; **396 monthly downloads**. [Catalog](https://pi.dev/packages/@linimin/pi-letscook) | Larger `/cook` workflow with persisted `.agent/` state, completion roles, stop-check history, and verification artifacts. Completion checks are integrated into that workflow rather than attached transparently to ordinary chat. | Published; no recent release demonstrated. Considerably more machinery than the requested small stop checker. |

Two source-level qualifications matter:

- **`pi-til-done` really does inject another message.** Its implementation tests unfinished items and calls `pi.sendUserMessage(prompt)`, falling back to `{ deliverAs: "followUp" }`. However, its nominal 20-iteration breaker is reset by task mutations, so do not interpret it as a hard total-run budget. [Continuation source](https://github.com/harms-haus/pi-til-done/blob/main/src/events.ts), [counter documentation](https://pi.dev/packages/@harms-haus/pi-til-done).
- **`pi-supervisor` is not a strict completion guarantee.** Its source assumes `agent_end` means fully idle, which conflicts with current Pi documentation. After five consecutive idle steering interventions, it requests a more lenient final evaluation. That makes it a useful semantic supervisor, but a questionable choice for “never stop until every condition genuinely holds.” [Supervisor source](https://github.com/tintinweb/pi-supervisor/blob/master/src/index.ts), [Pi lifecycle documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#agent_start--agent_end--agent_settled).

**The specifically requested packages and repositories**

- **`@gotgenes/pi-subagents`: no general completion checker found.** It supplies child execution, results, notifications, steering, and session resumption. A child finishing can wake the parent, but that is result delivery, not a judgment that the parent’s task remains incomplete. Latest catalog release: **21.7.1, September 15, 2026**, approximately **13,200 monthly downloads**. [Package](https://pi.dev/packages/@gotgenes/pi-subagents), [source documentation](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/README.md).
- **`pi-lens`: no general task/goal completion checker found.** It supplies diagnostics, turn-end findings, formatting, automatic fixes, and optional commit/push blocking. Those checks concern code findings, not whether the user’s entire request is fulfilled. Its documentation also describes a **Claude Code Stop hook**, which should not be mistaken for a general Pi goal loop. Latest catalog release: **4.2.1, September 17, 2026**, approximately **96,000 monthly downloads**. [Package](https://pi.dev/packages/pi-lens), [feature documentation](https://github.com/apmantza/pi-lens/blob/master/docs/features.md).
- **`@juicesharp/rpiv-todo`** tracks and displays tasks; its documented behavior does not include forcing continuation at turn end. The broader `rpiv-*` family provides orchestrated workflows and has moved into `juicesharp/rpiv-mono`. **`@tintinweb/pi-tasks`** can automatically dispatch newly unblocked tasks through its subagent integration, but that is dependency execution rather than a generic final-answer checker. [rpiv task documentation](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo), [Pi Tasks](https://github.com/tintinweb/pi-tasks).

The [Awesome Pi list](https://github.com/BubblePtr/awesome-pi) also identifies goal and loop packages. **This capability is not missing from the ecosystem**, although I did not find one universal extension that automatically understands every third-party task list and independently verifies arbitrary goals.

**2. Pi events, message injection, and task access**

The relevant lifecycle is:

| Event or method | Use |
|---|---|
| `pi.on("turn_end", …)` | Observe one model response and its tool results; often too early for a completion decision. |
| `pi.on("agent_end", …)` | Inspect `event.messages` from the completed low-level run; record the final response and a continuation intent. |
| `pi.on("agent_settled", …)` | Check completion after automatic retries, compaction continuations, and queued follow-ups have drained. |
| `ctx.isIdle()` and `ctx.hasPendingMessages()` | Recheck that another extension has not already started or queued work. |
| `session_start`, `session_tree`, `session_shutdown` | Restore branch-specific state and invalidate outstanding checks when sessions change. |

Sources: [extension event documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [current extension types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts).

The injection itself is small:

```typescript
pi.sendMessage(
  {
    customType: "done-check",
    content: "Unfinished work remains: … Continue with the next required action.",
    display: true,
  },
  { deliverAs: "followUp", triggerTurn: true },
);
```

`followUp` waits until tool work finishes; `triggerTurn: true` starts a response when idle. Alternatively, `pi.sendUserMessage(text, { deliverAs: "followUp" })` injects a user-role message and always triggers a turn. `nextTurn` does **not** wake the agent. [Message API documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#pisendmessagemessage-options).

**There is no documented `{ block: true }` return contract for `agent_end` or `agent_settled`.** The extension creates continuation by sending a message; it does not veto stopping through a Claude-style Stop-hook return value. [Event handler types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts).

**Reading the active task list**

Pi core explicitly has **no built-in task list**. You must adapt to the task extension actually installed. [Pi philosophy](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#philosophy).

Concrete options:

- **Official `todo.ts` example:** walk `ctx.sessionManager.getBranch()`, find `toolResult` messages with `toolName === "todo"`, and reconstruct the latest `details.todos`; each item has `done`. Use the active branch rather than every session entry. [Example source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/todo.ts).
- **`rpiv-todo`:** successful tool results contain the full snapshot in `details.tasks`, with `pending`, `in_progress`, `completed`, and `deleted` statuses. Replay the active branch and take the latest valid snapshot. Child task state is deliberately separate. [Snapshot schema](https://github.com/juicesharp/rpiv-mono/blob/main/packages/rpiv-todo/docs/tool-schema.md), [session isolation](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo).
- **`@tintinweb/pi-tasks`:** use its configured task store. Default storage is `.pi/tasks/tasks-<sessionId>.json`; project-wide and external shared-list modes also exist. Do not assume a single universal filename. [Storage documentation](https://github.com/tintinweb/pi-tasks#task-storage).
- **`@gotgenes/pi-subagents`:** import `getSubagentsService()` and use `listAgents()`, `getRecord(id)`, or `hasRunning()`. Records expose lifecycle status, result, pending question, and transcript path—not a universal task checklist. Use `resume(id, prompt)` for a settled child and `steer(id, message)` for a running child. Lifecycle subscriptions use **`pi.events.on("subagents:completed", …)`**, distinct from core **`pi.on(...)`**. [Public service contract](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/src/service/service.ts).

A completed child process is therefore **not evidence that its assigned acceptance criteria passed**. Your checker needs a separate task-to-child mapping and completion evidence.

**Does Pi cover this natively?**

**No built-in `/loop` appears in the current core command list.** Existing `/loop` commands are supplied by extensions. The upstream community discussion explicitly notes this distinction. [Current commands](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#commands), [upstream discussion](https://github.com/earendil-works/pi/discussions/3373).

Pi does natively support queued steering and follow-up messages. That supplies delivery, not unfinished-work detection. A queued “continue” runs once; something must evaluate the outcome and enqueue the next one. [Message queue documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#message-queue).

**3. Recommendation**

**Adopt `@narumitw/pi-goal` for the normal “keep working instead of ending with a plan” requirement.** It has the clearest current handling of `agent_end` versus `agent_settled`, stale continuations, interruption, and no-progress limits. Its source explicitly records continuation before dispatching it at settlement. [Lifecycle implementation](https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-goal/src/lifecycle.ts).

```text
pi install npm:@narumitw/pi-goal
```

**If independent acceptance is essential, choose `@recynie/pi-goal` instead.** Its verifier can inspect the workspace rather than merely accepting the worker’s completion flag. It is less established, so I would validate it on a representative task before relying on unattended execution. [Verification design](https://github.com/recynie/pi-goal#independent-verification).

Write a roughly 50-line extension only for a **narrow, existing task-store integration**. My logic sketch would be:

1. Enable checking explicitly for the current session and task.
2. Capture the latest assistant response and abort/error state at `agent_end`.
3. At `agent_settled`, skip paused, aborted, busy, already-queued, or superseded work.
4. Read the authoritative task snapshot or run a configured completion check.
5. If unfinished, inject one follow-up naming the missing requirement and next action.
6. Track consecutive continuations and unchanged evidence; pause on a limit or genuine external blocker.
7. Invalidate pending checks on user input, session replacement, and shutdown.

For detecting “a plan or promise” in prose, use a separate judge with the original request and evidence. A phrase matcher for “I will” or “next I’ll” is too unreliable. **Fifty lines can implement the continuation mechanism; a dependable semantic completion checker is a larger undertaking.**
