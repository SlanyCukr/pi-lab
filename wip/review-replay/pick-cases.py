#!/usr/bin/env python3
"""Pick past reviews for replay.sh: pick-cases.py [state-dir] [--since YYYY-MM-DD] [--per-group N] > cases.txt

Three groups from the loop's verdict files (.find-gaps/verdicts/<head>.txt), newest first, each review by the
reviewer model in --by (default Opus 5.5) and of a range of at most --max-commits commits:
  fail      the reviewer found a must-fix defect: does another model find the same one?
  followup  a pass that listed follow-ups: does another model call one of them a defect?
  clean     a pass with nothing listed: does another model raise a false alarm, or see something missed?
A head is taken only when its review session (with the prompt) still exists. One line per case: `<head> <group>`.
"""
import argparse
import glob
import os
import re
import subprocess

p = argparse.ArgumentParser()
p.add_argument("state", nargs="?", default=os.path.expanduser("~/projects/media_monitoring.find-gaps/.find-gaps"))
p.add_argument("--since", default="2026-11-14")
p.add_argument("--per-group", type=int, default=10)
p.add_argument("--max-commits", type=int, default=3)
p.add_argument("--by", default="anthropic/claude-opus-5-5")
a = p.parse_args()
wt = os.path.dirname(a.state)

prompts = set()  # "base..head" of every review session that still exists
for f in glob.glob(a.state + "/sessions/reviews/*/*.jsonl"):
    with open(f, errors="replace") as fh:
        for line in fh:  # the session stores its system prompt first; the prompt is the first user message
            if '"role":"user"' in line:
                m = re.search(r"commit\(s\) ([0-9a-f]{40})\.\.([0-9a-f]{40})", line)
                if m:
                    prompts.add(m.group(1) + ".." + m.group(2))
                break

rows = []
for f in glob.glob(a.state + "/verdicts/*.txt"):
    t = open(f, errors="replace").read()
    h = dict(re.findall(r"^(base|head|by|at): (.*)$", t, re.M))
    if h.get("by") != a.by or h.get("at", "") < a.since or h.get("base", "") + ".." + h.get("head", "") not in prompts:
        continue
    v = re.search(r"^VERDICT: *(pass|fail)", t, re.M | re.I)
    if not v:
        continue
    n = subprocess.run(["git", "-C", wt, "rev-list", "--count", h["base"] + ".." + h["head"]], capture_output=True, text=True).stdout.strip()
    if not n.isdigit() or not 1 <= int(n) <= a.max_commits:
        continue
    group = "fail" if v.group(1).lower() == "fail" else ("followup" if re.search(r"^Follow-ups:\s*\n\s*- ", t, re.M) else "clean")
    rows.append((h["at"], h["head"], group, n))

rows.sort(reverse=True)
print(f"# picked {a.per_group} per group from reviews by {a.by} since {a.since}, ranges of at most {a.max_commits} commits")
for group in ("fail", "followup", "clean"):
    for at, head, g, n in [r for r in rows if r[2] == group][: a.per_group]:
        print(f"{head} {g}  # {at}, {n} commit(s)")
