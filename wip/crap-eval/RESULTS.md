# CRAP score as a find-gaps discovery signal (2026-10-02)

Question: would a CRAP score (complexity² × (1 − coverage)³ + complexity; tool tried: bjacobso/effect-crap @ c298def)
point find-gaps discovery at the code where review defects land?

Setup: scratch clone of media_monitoring at run-branch 0e067183. Frontend: `vitest run --coverage` (json reporter,
200 files, 893 tests; 212 Postgres-only tests skipped) → effect-crap over `app/api lib features` (2707 functions, 1.7 s).
Backend: pytest (1854 passed) + `radon cc`. Defects: 38 P1/P2 items from the 31 failed verdicts in `.find-gaps/verdicts`,
77 file:line locations; 32 hit analysable TS source. `evalmap.py` parses each reviewed head (68 ranges), maps every diff
hunk and defect line to its innermost function; `evalscore.py` scores the 582 touched functions still present (29 with a defect).

| Predictor (current HEAD) | AUC | top 10 % hits (base 5 %) |
|---|---|---|
| CRAP | 0.59 (90 % CI 0.52–0.67) | 4–5/58, 1.4–1.7× (ties at the cutoff) |
| complexity | 0.59 | 3/58, 1.0× |
| uncovered share | 0.53 | 4–5/58, 1.4–1.7× |
| times touched (leaks: fixes touch again) | 0.58 | 8/58, 2.8× |
| length | 0.52 | 6/58, 2.1× |

Why it is weak here: both sides already cap complexity at 10 (lint, xenon), so CRAP collapses to "has unit tests";
TSX components are tested by e2e, not unit coverage, so 72 of the 96 functions over 30 are presentation; most defects are
wording or missed surfaces, and the logic defects sat in simple, covered functions (`parseDay`, `isValidIsoDate`, `parseBody`):
missing edge cases, which coverage cannot see. Bias note: scores are post-fix (fixes add tests), which works against CRAP.

Rerun: `CRAP_OUT=/tmp/x EFFECT_CRAP=<effect-crap>/dist/bin.js python3 defects.py && python3 evalmap.py && python3 evalscore.py`
(evalscore also needs `$CRAP_OUT/fe-crap.json`: effect-crap run with `--coverage <vitest coverage-final.json> --format json`).

Verdict: not adopted as a discovery input or CI gate. Side output: 3 backend functions over 30 (untested,
`_translate_validation_error` cc 10) handed to the loop as one small finding.
