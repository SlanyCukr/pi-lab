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
