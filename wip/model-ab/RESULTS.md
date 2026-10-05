# Model A/B, 2026-09-29 (Sonnet 5.5 released 2026-09-28)

Question: move `Explore` or `builder` to Claude Sonnet 5.5, or `Explore` to GPT-6 Luna?
Constraint from the user: Anthropic subscription usage is not a concern; judge on quality and speed.

## Explore (8 questions × 2 reps, snapshot media_monitoring a6caf826, low thinking, Explore prompt + read/grep/find/ls)
Keys verified by grep (q1 key corrected after Sonnet showed `matrix-long-lists` only calls the endpoint; q7 keys regex-escaped).

| model | fully correct | mean recall | s/task | turns | citations | $/task (list) |
|---|---|---|---|---|---|---|
| gpt-5.6-luna (current) | 16/16 | 1.00 | 28 | 4.8 | 113 | 0.007 |
| claude-sonnet-5-5 | 15/16 | 0.98 | 22 | 4.3 | 247 | 0.081 |
| gpt-6-luna | 14/16 | 0.96 | 26 | 5.6 | 100 | 0.003 |

All misses are on q3 (count 38 importers: Sonnet 37 once; GPT-6 Luna 30 and 37). No invalid file:line citations
(3 flagged by the grader were grader bugs: `.github/` prefix stripped, one ambiguous basename).
Verdict: keep gpt-5.6-luna. Sonnet is faster and cites more but is not more accurate; GPT-6 Luna is worse.

## Builder (3 real find-gaps commits, parent snapshot, spec = commit message minus test details, hidden test = the commit's own test)

| task | opus-5-5 medium | sonnet-5-5 medium |
|---|---|---|
| G80 share formatter | 2/2 pass (102, 134 s) | 0/2: prints "-0 %" for tiny negative noise (61, 71 s) |
| G23 per-thread chat lock | 2/2 pass (313, 211 s) | 2/2 pass (148, 74 s) |
| G68 backup catch-up | 0/2* | 0/2* |

*Both fail the same unspecified tie-break (week before month dump with one stamp): spec gap, not counted.
Verdict: keep Opus 5.5 for `builder` (4/4 vs 2/4 on fair runs); Sonnet is ~2× faster but misses edge cases.
