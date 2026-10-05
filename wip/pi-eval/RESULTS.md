# pi rule-following eval (2026-09-30)

Method: https://claude.dev/blog/automating-eval-design-and-hillclimbing/ — real decision points, fixed train/test split,
one change per round, keep a change only if held-out improves too.

## Cases (`cases.json`, `mine.py`)
36 real decision points from `~/.pi/agent/sessions`: 18 `pushed` (the user had to say "continue/do it" after this turn),
14 `question` controls (short user question), plus `act`, `verify` and `fix-own`, one or two each. Split by kind: 24 train, 12 test.

## Harness
- `replay.mjs <case> <append|live> <out>`: cuts the session at the case's leaf (ancestor chain only) and loads the real
  setup (extensions, skills, AGENTS.md, tools) with the append under test. All tool calls are blocked, and the run stops
  at the first assistant message. `EVAL_PREFIX` + `EVAL_NUDGE` replay the turn after an auto-continue nudge.
- `run.sh <variant> <reps> <split>`, `grade.py <root> [variant]`, `report.py`, `ac-run.sh`, `ac-report.py`, `classifier-eval.mjs`.
- Grader: code decides where the sample does (a tool call continues the work; an edit on a question fails). Otherwise
  Astra checks stated claims. Regrading 52 judge verdicts changed 0; 2 of 36 cases flip between reps.
- Rubric fix after the v0 read: handing over what only the user can do (their dashboards, paid quota, prod, future
  events) is not a fail; a read-only look on a question is not a fail.

## Results (Opus 5.5, thinking high, 4 reps)
| variant | train | test |
|---|---|---|
| v0 live append | 65/96 = 68% | 34/48 = 71% |
| v1 "an 'I'd pick yes' about reversible work is an offer" | same as v0 (2 reps) | — |
| v2 "hand-over you could do yourself = not finished" | 67% (2 reps, worse after rubric fix) | — |
| v3 "scope change is a new goal; do reversible parts first" | 71/96 = 74% | 31/48 = 65% → rejected |
| v0 + auto-continue default on | 82/96 = 85% | 38/48 = 79% |
| question turns, read-only nudge | 36/36 (from 27/36) | 20/20 |

Auto-continue: 21 + 9 continuations; 30 fixed, 0 made worse. Prompt text is at its ceiling for this failure: the model
knows the rule and still judges its own next step to be the user's call. A hook after the turn works where more text does not.

Classifier (`classifyEnding`) changes, designed on train only: "If you want…, I can…", an offer followed by a short
status paragraph, and an explicit pick beating a weekday in the alternative. Train catch 40/86 → 50/86, test unchanged
at 10/31; false continues on passing endings stayed at 2 of 93. Remaining misses are mostly "Next: <command> (about 2 minutes)"
hand-overs and "Reply X to …" with markdown bold. Not tuned on test.

Deployed: `~/.pi/agent/extensions/auto-continue` (on by default when interactive; `PI_AUTO_CONTINUE=manual|0`), tests `wip/auto-continue/test.mjs`.
Verified in a real tmux pi turn: an offer ending got the nudge, and the model ran `wc -l` and answered.
