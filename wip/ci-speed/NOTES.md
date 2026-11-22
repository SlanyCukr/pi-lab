# CI speed for media_monitoring: notes for a discussion (2026-11-21)

The user showed a prompt ("Make this repo's CI as fast as possible without letting it lie", target under 1 minute
at the median) and asked to discuss before doing anything like it. Nothing here is decided or sent to the loop.

## Measured (the last 150 workflow runs, 2026-11-15 to 11-21; `gh run list` and the jobs API)

- Push to `main` until deployed (workflow `deploy`, 120 runs): 20.6 min at the median, 26.0 min at p95; 8 failed.
- Every job runs on one self-hosted runner: the Raspberry Pi 5 (4 cores) that also serves production and the loop.
  So the jobs run one after another.

| Job | Waiting (p50 / p95) | Setup | Running |
|---|---|---|---|
| `quality` | 2 s / 419 s | 31 s | 716 s / 965 s (pytest 439 s, frontend unit tests with coverage 156 s, pyright 78 s) |
| `dashboard-postgres-contract` | 732 s / 972 s (it queues behind `quality`) | 32 s | 335 s / 423 s |
| `deploy` | 2 s | 8 s | 53 s |

- Before a push, the loop's pre-review script already ran most of the same checks on the same machine
  (browser specs 747 s, contracts 140 s, unit tests 71 s in the last review). The same work runs twice.
- pytest already uses all cores with one database per worker. `cancel-in-progress` is off for `deploy`.
- The scheduled browser suite takes 27 min at the median, 61 min at p95.

## What fits from the prompt

- Audit first and fix the biggest bucket: done above. The buckets are the queue (12 min) and work done twice.
- The three rules: the full suite runs before anything deploys (it does: a red build is never deployed), never
  hide failures (no retries, no wider timeouts), never check less.
- A budget per job, and a job that exceeds it fails.
- Fewer tests on evidence: for two weeks, log every test failure as a caught regression or a change detector, then
  delete the files that only detect change. This is the same aim as the prune request of 11-21.
- One small change at a time with before and after numbers from real runs.

## What does not fit

- **Under 1 minute.** Setup is 31 s and the deploy itself 53 s, so the floor on this host is about 1.5 min with no
  tests at all. A reachable target is push to deployed in about 6 min with rented runners, about 12 min on the Pi.
- **Tool swaps (bun, oxlint, TypeScript 7).** The time is in pytest, the browser contracts and the queue. Frontend
  lint (5 s) and tsc (9 s) are not where it goes. The backend is Python.
- **A merge queue.** The loop pushes reviewed commits straight to `main`; there are no pull requests to queue.
- **Local hooks (hk).** The loop's pre-review script already is that gate, enforced by the runner.

## Choices for the user

1. **Rented runners for the two check jobs** (the deploy stays on the Pi). Blacksmith lists ARM runners at $0.0025
   a minute for 2 vCPU, with 3,000 free minutes a month (its pricing page, read 2026-11-21). Estimate: 20 pushes a
   day at about 8 runner-minutes on 8 vCPU is about 4,800 minutes a month, roughly $20 to $50. It also takes the
   test load off the production host. Needs an account and a card.
2. **Pi only.** Stop running in CI what the pre-review already ran on the same tree, or run the two check jobs side
   by side. The first risks "letting CI lie" unless CI can prove the tree is the one that was tested; the second
   competes with production for 4 cores.
3. **Test pruning on evidence**, as in the prompt. No cost; two weeks of logging first.

## Can the tests themselves be faster? (measured the same day from the CI log of run 44917668112)

Yes. The first version of these notes only showed where the time goes.

- **Frontend unit tests (vitest), 125 s.** Vitest's own summary: environment 42 %, import 33 %, tests 13 %,
  transform 6 %, worker 4 %, setup 2 %. Running the 1,338 tests takes about 16 s; the rest is building a browser-like
  environment and importing modules again for each of 243 files. This is what the prompt's "isolate modules, not
  processes" is about.
- **Backend tests (pytest), 454 s for 6,012 tests on 4 workers.** 34 s pass before the first test. The time is very
  uneven: 50 % of the tests are done at 253 s, the next 25 % take 9 s, and the last 5 % take 116 s, with silences of
  30 s and 48 s near the end. A small slow group decides the total. Which tests they are is not recorded: pytest
  runs without `--durations`.
- **Pyright, 67 s**, runs after the tests, and `ty` (1 s) already type-checks the same code.

## What failed in CI (120 pushes, 2026-11-15 to 11-21): 10 red jobs

npm audit 3, database contract tests 3, frontend unit tests 2, frontend type check 1, browser specs 1, pytest 0.
The 6,012 backend tests did not fail once in CI. That is not proof they are useless: the loop runs them before
every push, and those local failures are not logged per test. Half of the backend tests take about 2 % of the
time, so deleting tests by count shortens CI little; deleting or fixing the slow ones does.


## Sent to the loop (2026-11-21 18:45, the user: "go with your pick and do it now")

One project, five parts: record per-test results and durations; speed up the measured hot spots; "without letting
it lie" rules; prune by mutation testing (not by "never failed"); property tests. Rented runners, tool swaps and a
merge queue are left out. Baseline to judge it against: push to deployed p50 20.6 min, vitest 125 s, pytest 454 s,
6,012 backend and 1,338 frontend unit tests.

Not built: a runner flag for commits that change the checks. The review prompt already fails a review for a
weakened or deleted test, and the 12 check-changing commits of the last 14 days show no weakening that hurt (two
loosened the npm audit gate with a stated reason, one raised a timeout). The project asks each deletion commit to
name its evidence instead.

## A second machine as a runner: tried, switched off (2026-11-21 evening)

The user has two more Pis. The Pi 4 (4 GB, SD card) is too slow and small. The other Pi 5 (8 GB, the user's home
server, about 2 GB of memory available) got a runner under its own user without sudo: rootless podman behind the
docker CLI, label `mm-checks`. By hand, a Postgres service container and the Playwright-style
`docker run --network=host --user $(id -u)` both worked there.

The first real job (the database contract job on a scratch branch) passed checkout, uv, Node, migrate and seed, and
then hung the whole host three minutes into `npm ci` + `next build`; the hardware watchdog reset it. All services
came back clean. The mistake was mine: I planned to measure memory on the first run and cap it afterwards. The cap
(`MemoryMax` on the runner user's slice, no swap) comes first.

Expected gain if it ran: the two check jobs side by side, about 6 minutes off each deploy (20.6 to about 15 min at
the median, estimate). The workflow change it needs is small: a `runs-on` label for the contract job, and `$HOME`
instead of `/home/pi` for its venv and build cache. Not sent to the loop.

Removed on 2026-11-22 (the user: not enough memory there): the GitHub runner, its user and podman. A second
machine for the check jobs needs about 4 GB free, which neither spare Pi has; what is left is speeding up the tests
on the production Pi (the loop's project) or rented runners.
