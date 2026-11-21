# Prompting guidance for the models this setup uses

Compiled 2026-11-21 from Anthropic's own pages, for edits to `~/.pi/agent/APPEND_SYSTEM.md`, `~/.pi/agent/agents/*.md`,
the tool descriptions in `tool-trim`, the advisor prompt and the find-gaps `SKILL.md`. Read the rule here, then the
source when the wording matters. `AUDIT.md` next to this file says what was checked against it and what changed.

Sources (each has a `.md` twin: append `.md` to the URL):

- General: <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
- Fable 5.2: <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2>
- Opus 5.5: <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5>
- Sonnet 5.5: <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5>
- Tools: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools>
- Context (system prompt, skills, project files):
  <https://claude.dev/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models/>
- Effort and model choice: <https://claude.dev/blog/which-claude-model-should-you-build-with/>
- Sub-agents or one loop:
  <https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop>

## Rules for every current Claude model

1. **Fewer rules, more judgement.** Anthropic removed over 80 % of Claude Code's system prompt for the Claude 5 models
   with no loss on its coding evaluations. A rule earns its place by a failure that happened without it.
2. **No conflicting instructions.** Two rules that pull apart (a system prompt against a skill against the request)
   make the model stop and weigh them. When adding a rule, find the one it contradicts.
3. **Say why.** A reason lets the model apply the rule to cases the rule did not name.
4. **Plain wording, no shouting.** "Use this tool when…" instead of "CRITICAL: you MUST…": these models follow the
   system prompt closely, so emphasis makes a rule fire too often.
5. **Say what to do**, not only what to avoid.
6. **`never` is read as absolute.** Write the scope and the reason, or name the approval ("ask before deleting files").
7. **A tool's instructions go in its description, once.** Not in the system prompt as well.
8. **Design the interface before adding an example.** An enum, a clear parameter name and a result that says what to
   do next steer better than an example, and examples narrow what the newer models try. A tool description says what
   the tool does, when to use it and when not, what each parameter does, and what it does not return.
9. **Progressive disclosure.** A long skill or project file is split into files that load when needed. A project
   file holds what cannot be seen from the repository (gotchas), not what is obvious.
10. **No "think carefully", no "think less".** The effort level controls thinking; prompt lines do not (Fable 5.2 and
    Sonnet 5.5 ignore "answer directly" at medium and above).
11. **Never ask for the reasoning in the reply** (prompts, skills, tool parameters). It can be refused as
    `reasoning_extraction`. A short explanation of an answer is fine.
12. **Append only.** Changing the system prompt, the tool list or an earlier message in a running conversation
    invalidates the thinking blocks after it and the prompt cache. New instructions go in the newest turn. Prompt
    edits take effect in new sessions.
13. **Measure one change at a time**, on your own tasks, with its token cost.

## Claude Fable 5.2 (main session, harness review)

- **Effort:** `high` is the default and gives most of the gain; `medium` suits interactive coding; above `high` gains
  are uneven. Effort does not change reply length: prompt for that.
- **Style rules are followed to the letter.** A hard limit such as "one instruction per sentence, in 20 words or
  fewer" makes prose choppy. Describe the reader instead (low context, has not seen the tool calls, key points
  first, Simplified Technical English, no terms made up during the work).
- **Stops early** by listing what is left, offering to continue, or at an ordinary obstacle (more at low and
  medium). Say that ordinary obstacles are worked through, that deliberate blockers are reported, and that risky
  actions still need confirmation.
- **Approval rules are taken broadly.** Name the exact actions that need approval and the routine ones that do not.
- **Cautions pile up** in notes, memory and instruction files, some written by the model itself. Delete the ones
  whose reason is gone.
- **Ownership:** "You are the owner and long-term maintainer of this codebase" turns adding into consolidating
  (under 10 % to about 75 % of small tasks), with 70-80 % more output and unrequested changes. Leave it out where the
  user wants minimal change.
- **Updates:** ask for one line before the first tool call, brief updates, and a recap that stands alone.
- **Sub-agents:** it delegates when the prompts invite it. A standing "delegate X" line is the first thing to review.
  The sub-agent tool's description states the cost, when it pays and when not, and how to brief.
- **A token budget shown in the prompt** changes how much it spends; test without it.

## Claude Opus 5.5 (loop cycles, reviewer, advisor, `Explore` during the 11-21..11-28 trial)

- **Effort:** the default is `medium`, which matches or beats Opus 5 at `high`; `low` comes close on several coding
  evaluations. `xhigh` and `max` only where a gain was measured. Lower effort, not a prompt line, to get less thinking.
- **Unattended runs:** a turn that ends in text ends the work. Name the unwanted endings (a summary that announces
  the next step, an offer to continue, a list of decisions none of which blocks, "a good place to report") and the
  wanted ones (nothing can move without the user; the blocker is deliberately protected). Keep a checklist the model
  updates. A harness may send two or three "your list still has open items" messages, not more.
- **Time:** it paces itself to a stated time budget and may verify less under pressure. A deadline in the prompt is a
  lever, not a neutral fact.
- **Starts quickly:** on a loosely specified task, tell it to look through the relevant sources before acting.
- **Chat:** "treat an earlier answer as done" cuts re-thinking, and also cuts self-correction: not for agentic work.
- **Review:** more real defects and fewer false alarms than Opus 5; no special prompt needed.

## Claude Sonnet 5.5 (not in use since 2026-11-21; `Explore` before the trial)

- Start at `high`. At `low` it can skip verification and report work as checked that was not; at `low` and `medium`
  it stops to check in more.
- It under-uses search when a prompt says to minimise tool calls.
- It adds unrequested tests and docs; say when to stop and report.
- Anthropic sends the hardest long-horizon work to Opus.

## GLM-5.3 (`explore-glm`, loop only, when Anthropic is rate-limited)

Z.ai publishes settings, no prompting guidance: reasoning is always on, effort is `low`, `high` or `max` (default
`max`, recommended for coding), text input only.
