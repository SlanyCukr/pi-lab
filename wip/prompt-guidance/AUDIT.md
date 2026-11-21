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

## Second pass, the same day (the user: "Why don't we actually make the edits")

The first pass changed four things and left the rest because each rule traced to a past failure. That kept text the
guidance says to move or merge. This pass made those edits.

5. **Every tool's when-to-use text is in its description, once** (`tool-trim`, `bg-bash`, `advisor.json`). Out of
   the system prompt: the append's "Tool use" section (filter output, `gh`, edit instead of `sed -i`), the two
   bash guideline lines (background, monitor), pi's write line, the read-before-edit line, and the advisor's
   when-to-call rules. Into the descriptions of `bash`, `edit`, `write` and `advisor`. The `<rules>` block went from
   1,790 to 243 characters. One advisor line stays there (repeat the advice in the reply): it is about the reply,
   and an empty list makes the package fall back to its own seven lines.
6. **The append says each thing once.** Who decides what was stated three times (Working rules, Delivering work,
   the "Execution" paragraph); it is now one paragraph in Working rules, which also names what waits for the user,
   as the Fable guide asks. The bullet "A second issue found along the way" repeated "Completeness" and is gone.
   8,209 to 7,181 characters.
7. **`Explore` and `reviewer` prompts give the reason and drop the bare "never"s.** Each opens with who reads the
   report and what they do with it (the caller acts without opening the files; a gate ships on the verdict). The
   rules are the same rules. `explore-glm` keeps the old wording: it is a weaker model and is off on this host.

Sizes, main session in `~/pi-lab` (characters): system prompt 27,089 to 24,514; tool definitions 11,623 to 13,520;
total 38,712 to 38,034. An explorer has no bash, edit or advisor, so it only loses text: about 2,600 characters.

### Checks (regressions looked for; none found)

| Check | Before | After |
|---|---|---|
| Rename a setting in 5 files (2 runs): edits through `edit`, files written through bash | 6 and 6, 0 | 7 and 6, 0 |
| "Thinking out loud" question (2 runs): files changed | 0, 0 | 0, 0 |
| Add a CLI flag (2 runs): ran the tests, ended with an offer | yes, no | yes, no |
| Wait for a 70 s deploy (2 runs, RPC): `background: true` used, foreground sleep | 2 of 2, 1 | 2 of 2, 0 |
| Those 8 runs, cost | $2.48 | $2.13 |
| Explorer test (`wip/model-ab/explore`, 8 questions x 2, Opus 5.5 medium): fully correct | 16 of 16 | 16 of 16 |
| Same: $ and seconds per task, citations | $0.144, 35 s, 309 | $0.141, 34 s, 266 |
| Review replay, one failed and one clean case (Opus 5.5 high) | fail (same defect), pass | fail (same defect), pass |

These show the rules still hold from their new place. They do not show a gain: the old prompts already passed
every check, and the explorer test is at its ceiling. The measured gain of the day is the delegation change above.
The rule-following eval of 09-30 (`wip/pi-eval`) could not be run here: its cases are laptop sessions and its
grader needs the OpenAI login.

## Left alone, with the reason

- **The response-style budgets** ("about 8 lines", "at most 5 bullets"). The guide says to add length instructions
  where wanted; these are the user's choice for an ADHD reader.
- **The two `Example: {...}` lines in tool descriptions** (`lens_diagnostics`, `lsp_navigation`). The context post
  says examples narrow what the model tries; these two exist because calls without them failed on argument shape.
- **No thinking instructions, no token budget, no deadline shown to the model** in any prompt: checked with grep
  over the append, the agents, the advisor prompt, `SKILL.md`, `run.sh` and the harness-review prompt. Nothing to do.

## Open

- **`SKILL.md` is 54 KB and every loop cycle reads all of it.** A split by cycle kind (rule 9) would save a build
  cycle about 3,300 tokens on every turn, roughly $7 a day (estimate, not measured). It is not a cut-and-paste: the
  build steps cite the scoring rule inside "discover", and the "headless" section is one 4.6 KB paragraph that
  mixes build and discovery instructions. It needs its own rewrite and real cycles to check it.
- Explorers do not read `SKILL.md` (0 of 283 sub-agent sessions on 11-20 and 11-21), so there is nothing to split
  for them.

Rollback of the second pass: `git -C ~/pi-lab show 2a08e8c:<path>` for `pi-kit/home/.pi/agent/APPEND_SYSTEM.md`,
`pi-kit/home/.pi/agent/agents/Explore.md`, `pi-kit/home/.pi/agent/agents/reviewer.md`,
`pi-kit/home/.config/rpiv-advisor/advisor.json`, `wip/tool-trim/index.ts` and `wip/bg-bash/index.ts`.
