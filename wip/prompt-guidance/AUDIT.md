# Audit of this setup's prompts against Anthropic's guidance (2026-11-21)

The rules are in `GUIDANCE.md`. This file says what was checked, what changed, and what was left alone and why.

## What was checked

| Prompt | Size | Read by |
|---|---|---|
| `~/.pi/agent/APPEND_SYSTEM.md` | 8.9 KB | every session and sub-agent |
| Tool descriptions (`tool-trim`) | 13 KB | every session |
| `agents/Explore.md`, `agents/reviewer.md` | 1.9 KB each | the sub-agents |
| `rpiv-advisor/prompts/advisor-system.txt` and `advisor.json` guidelines | 1.9 KB | the advisor, the main session |
| find-gaps `SKILL.md` and the prompts in `run.sh` | 54 KB | loop cycles |

## Changed

1. **When to delegate moved from the system prompt into the `subagent` tool description** (`tool-trim`,
   `subagentRewrite`). Rule 7, and the Fable 5.2 guide: the description states what a sub-agent costs, when it pays,
   when it does not, and how to brief one; a standing "delegate X" line in the system prompt is the first thing to
   review. The append's "Delegation" list (6 lines, 670 characters) is gone. It also still called `Explore` "Claude
   Sonnet 5.5, lighter on the subscription", which stopped being true with the Opus trial.
2. **"Plain language" describes the reader instead of setting word limits** (append). The Fable 5.2 guide names
   "one instruction per sentence, in 20 words or fewer" as the kind of hard limit that makes its prose choppy; the
   append had almost those words ("about 20 words for instructions, 25 for explanation, one instruction per
   sentence, … at most 6 sentences"). The new paragraph is adapted from the guide's "Communicating clearly" text and
   keeps this setup's own points (literal wording, exact paths and commands).
3. **The advisor tool's description no longer says "a stronger reviewer model"** (`tool-trim`). In a Fable 5.2
   session the advisor (Opus 5.5) is the smaller model.
4. **The advisor's system prompt lost its capitals** ("You NEVER call tools and NEVER produce…" became "You have no
   tools, and the executor reads your answer, not the user"). Rule 4. It was the only shouted line in all the prompts.

## Measured (Fable 5.2 high, `pi -p`, 2 runs per prompt per side; pi 1.5.0)

| | Before | After |
|---|---|---|
| One-grep question: sub-agent calls | 0, 0 | 0, 0 |
| Search across 11 small extensions: sub-agent calls | 0, 0 | 0, 0 |
| Same: bash calls, cost | 8 and 6, $0.38 and $0.27 | 4 and 4, $0.30 and $0.25 |
| Trace a pipeline through the media_monitoring repository: sub-agents started | 3, 4 (`Explore` on Opus 5.5 medium, 28 to 57 tool calls each) | 0, 0 |
| Same: time | 200 s, 217 s | 91 s, 110 s |
| Same: cost of the main session | $0.72, $0.99, plus the explorers (not in the main session's sum; about $0.8 each at 11-20 rates scaled to Opus, so $3 to $4 in all) | $1.59, $1.39 in all |
| Same: main-session context at the end | 28.5k, 50.6k tokens | 71.4k, 70.0k tokens |
| "Read two files and explain": words | 373, 420 | 563, 475 |
| Same: mean words per sentence | 17.0, 16.5 | 14.6, 13.5 |

**Delegation changed on the large question.** With the standing line ("`Explore` handles searching or reading
beyond the files already named") Fable started 3 and 4 explorers for one 15-line answer. With the tool description
alone it read the code itself with about 20 shell calls, in half the time and for about half the money (the
explorers' cost is an estimate). The price is 20k to 40k more tokens in the main session's context per such
question. The four answers name the same stages; 8 of the 23 files cited appear in all four. This replaces the
2026-09-22 decision "Exploration goes to `Explore`", made when the explorer was a cheap model and Opus 5 delegated
0 of 22 times without the line.

The explain answers came out with shorter sentences and about 30 % more words; two runs a side cannot separate
that from run-to-run spread.

To judge later: `subagent` calls and cost per interactive session and per build cycle, the main session's context
size at each compaction, and words in final answers. Rollback: `git -C ~/pi-lab show 2fa4f76:pi-kit/home/.pi/agent/APPEND_SYSTEM.md`
and `2fa4f76:wip/tool-trim/index.ts` (copy the second to `~/.pi/agent/extensions/tool-trim/index.ts`).

A model run confirmed the new text arrives: it quoted the "Not worth it…" sentence and the advisor description, and
said its system prompt has no "Delegation:" list.

## Left alone, with the reason

- **`Explore.md` and `reviewer.md` prompts.** Each rule in them comes from a recorded failure (invented line
  numbers, pasted code blocks, a first finding returned as the whole review). Their "never" lines carry a scope.
  The Opus 5.5 guide says review needs no special prompt. Nothing in the guides argues against them.
- **The response-style budgets** ("about 8 lines", "at most 5 bullets"). The guide says to add length instructions
  where wanted; these are the user's choice for an ADHD reader. Both the before and the after answers ran to about
  20 lines on an "explain" question, so the budget is not what limits them.
- **The two `Example: {…}` lines in tool descriptions** (`lens_diagnostics`, `lsp_navigation`). The context post
  says examples narrow what the model tries; these two exist because calls without them failed on argument shape.
- **The advisor's when-to-use rules** stay in the system prompt (`advisor.json`). They are not repeated in the
  description, and the call rate was tuned with them there.
- **No thinking instructions, no token budget, no deadline shown to the model** in any prompt: checked with grep
  over the append, the agents, the advisor prompt, `SKILL.md`, `run.sh` and the harness-review prompt. Nothing to do.
- **Capitals** (NEVER, MUST, CRITICAL, IMPORTANT, ALWAYS): 1 file had them (the advisor prompt, now fixed).

## Open

- **`SKILL.md` is 54 KB and every loop cycle reads all of it.** The sections "discover" and "Lenses" (13 KB, 24 %)
  matter only in a discovery pass. Split into a file a discovery pass reads (rule 9), a build cycle would carry
  about 3,300 fewer tokens on every turn: roughly $0.25 a cycle and $7 a day at the current rates. This estimate was
  not measured. Not done on 11-21 because the `Explore` model, the discovery pace and the pi version all change this
  week, and one more loop change would blur each of them.
- Explorers do not read `SKILL.md` (0 of 283 sub-agent sessions on 11-20 and 11-21), so there is nothing to split
  for them.
