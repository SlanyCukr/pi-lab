# Testing and CI/CD when agents write the code: what the sources say (2026-11-21)

Research for the CI discussion in `NOTES.md`. Anthropic's own guidance first, then independent sources, then how
the find-gaps loop on media_monitoring compares. Nothing here is decided.

## Anthropic

**"How the Claude Code team thinks about verification"** (2026-11-16,
<https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/>). About 90 % of that team's code is
written and reviewed by Claude.

- Slow tests make the agent test less often and in bigger batches, so a failure is harder to pin down. Flaky tests
  teach it to run again instead of fixing. Heavy tests belong before the commit.
- Three kinds of test are worth the investment:
  - End-to-end tests of real user flows: hard to fool, and they say concretely what broke. Pick these if you pick one.
  - Property tests: a statement that must always hold, checked with thousands of generated inputs. They find the
    edge cases the agent did not think of, because the inputs do not share its bias.
  - Differential tests: run the old and the new code on the same inputs and compare. Best for rewrites and migrations.
- "Verification means running the change": a `verify` skill that starts the app and smoke-tests it, kept fast and
  reliable. "This is how we test nearly all changes at Anthropic."
- A check that still fails after three rounds goes to a person.
- A reliability checklist of 39 items, each with a trigger that can be read from the diff; only the 3 to 10 that
  match a change are checked.
- One reviewer tuned well, not several stacked; later rounds build on earlier ones.
- A change cannot modify the check that judges it: review rules are read from the base or default branch. A review belongs to
  one commit. Cheap checks run locally before anything is pushed.
- A new gate starts in observe mode (it logs what it would block) before it enforces.
- The checks are tested too: reverts, rejections, and an eval built from past incidents with clean changes as control.
- Misses become rules only when they happened twice and can be seen in a diff.
- Flaky tests: no skip, no sleep, no retry. Find the cause, or delete the test and write down why.
- "Test suites, verification steps and .md files only grow if you let them, so we tidy them up on a routine."

**"Agentic coding is straining CI"** (2026-09-14,
<https://claude.com/resources/articles/agentic-coding-is-straining-ci-heres-how-we-scaled-test-impact-analysis-at-anthropic>).
CI jobs grew 25 times in six months and tests 10 times.

- Running every test on every change does not scale: gates get long, costly and untrusted.
- Their answer is deterministic test selection: one component records the result of every test in every run, another
  picks the tests for a change from that history and from which package changed.
- An agent works better with a specific set of valid tests than with a wall of unrelated failures.
- Plan for the load to keep multiplying, and instrument CI so the agent can see and fix it.

**"How the Claude Code team does code review"** (2026-10-15,
<https://claude.dev/blog/solving-code-review-at-anthropic/>): work is verified before review; automated checks
block; a merge queue re-runs every check against main with the change applied; flags and staged release; fast
rollback; incidents and reverts become an eval set for the reviewer.

**Harness posts and the prompting guide**: an agent marks work done without testing it end to end unless it is given
browser tools and told to test as a user would; an agent grading its own work is lenient, a separate skeptical
evaluator is easier to tune; an agent must not remove or weaken a test to get green, and reports a test it thinks
is wrong (<https://www.anthropic.com/research/effective-harnesses-for-long-running-agents>,
<https://www.anthropic.com/research/harness-design-long-running-apps>).

## Independent sources

- **Böckeler, "Harness engineering for coding agent users"** (martinfowler.com, 2026-04-02): guides steer before the
  agent acts, sensors check after. Deterministic sensors (tests, linters, type checks) beat asking the model. Keep
  quality left: fast checks before the commit, expensive ones (mutation testing, a broad review) after integration,
  and drift sensors that run on a schedule (dead code, test quality, dependencies). Her warning: relying on the
  agent's own green test suite "puts a lot of faith into the AI-generated tests, that's not good enough yet".
- **"CI wasn't built for coding agents"** (The New Stack, 2026-05-21): a 10 to 15 minute remote verdict is too slow
  for an agent, so it ships on what the local loop can show. The fix is a unit of validation small enough to
  select and run against a real environment in seconds, used by both the local loop and CI.
- **Test selection write-ups** (Negi 2026-06-17; Bush 2026-08-27): tiers (touched-code tests, then integration, then
  everything), and selection that fails safe: unknown reach widens the run; migrations, auth, schema and CI
  config always get the full suite. Run the full suite in the shadow for a while and count what selection missed.
- **Test bloat** (Pan 2026-05-17; Kiran 2026-10-22; "High coverage, zero signal" 2025-12-19): an agent writes tests
  by reading the code, so many restate what the code does and cannot fail. It mocks more than people do (36 %
  against 26 % of test commits in one study). Coverage counts lines run, not lines checked, so it hides this.
  Mutation testing is the honest measure: break the code on purpose and see whether a test notices. A test that
  kills no mutant, or only mutants another test already kills, can go.

## Where the sources agree

1. Speed of the verdict is a quality lever, not a comfort: seconds to a few minutes locally.
2. Select tests for the change; run everything before release; make selection prove itself.
3. Record every test result. Selection, pruning and finding slow tests all need that history.
4. Judge tests by whether they can fail (mutation, red first), not by count or coverage.
5. Prefer end-to-end, property and differential tests to mock-heavy unit tests.
6. No retries for flaky tests. Fix or delete with a reason.
7. The checks are out of reach of the change they judge, and they are pruned on a routine.

## media_monitoring against that (measured 2026-11-21)

| Point | State |
|---|---|
| Verify by running the app, fresh-context review, review tied to a commit range | in place |
| Cheap checks before push; selected tests locally, full suite before deploy | in place (pre-review script, then CI) |
| No retries | in place (Playwright `retries: 0`, no pytest reruns) |
| One writer to main, CI before deploy, rollback | in place (the runner pushes one batch at a time) |
| Time to a verdict | far off: about 17 min pre-review, then about 20 min CI and deploy |
| Per-test result and duration history | missing: nothing records which test failed or how long it took |
| Test quality measure | coverage gates (75 % line, 60 % branch); `mutmut` is configured, a regular run was not found |
| Test mix | 6,012 backend and 1,848 frontend unit tests, 51 browser specs; no property tests (0 files use Hypothesis or fast-check); mocks in nearly every backend test file and in 178 of 295 frontend test files |
| Checks out of reach of the change | not so: 12 commits in 14 days changed CI workflows, the pre-review script or test config, judged only by the reviewer |
| Routine pruning | started 11-21 (the prune request); no evidence yet to prune on |
