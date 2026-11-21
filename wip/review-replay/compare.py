#!/usr/bin/env python3
"""Put the original verdicts next to replay arms: compare.py <cases-file> <out-dir> [<out-dir> ...] [--full]

Per case: the group, the original verdict, and each arm's verdict, time and cost. Totals per arm and group. With
--full, each answer's first lines too, for reading what was found: whether two reviewers name the SAME defect is a
judgement this script does not make.
"""
import os
import re
import sys

args = [x for x in sys.argv[1:] if x != "--full"]
full = "--full" in sys.argv
cases, arms = args[0], args[1:]
state = os.environ.get("FG_STATE", os.path.expanduser("~/projects/media_monitoring.find-gaps/.find-gaps"))


def read(path):
    if not os.path.isfile(path):
        return None
    t = open(path, errors="replace").read()
    v = re.search(r"^[*# -]*VERDICT: *(pass|fail)", t, re.M | re.I)
    n = len(re.findall(r"^\s*- ", t.split("Follow-ups:", 1)[1], re.M)) if "Follow-ups:" in t else 0
    h = dict(re.findall(r"^(secs|cost|by): (.*)$", t, re.M))
    return {"v": v.group(1).lower() if v else "none", "fu": n, "secs": int(h.get("secs", 0) or 0), "cost": float(h.get("cost", 0) or 0), "text": t}


rows = []
for line in open(cases):
    line = line.split("#")[0].split()
    if line:
        rows.append((line[0], line[1] if len(line) > 1 else "?"))

names = [os.path.basename(a.rstrip("/")) for a in arms]
print(f"{'head':10} {'group':9} {'original':12} " + " ".join(f"{n[:26]:26}" for n in names))
tot = {n: {} for n in names}
for head, group in rows:
    o = read(f"{state}/verdicts/{head}.txt")
    cells = []
    for a, n in zip(arms, names, strict=True):
        r = read(f"{a}/{head}.txt")
        if not r:
            cells.append(f"{'-':26}")
            continue
        cells.append(f"{r['v'] + ('+' + str(r['fu']) if r['fu'] else ''):8} {r['secs']:5}s ${r['cost']:<9.2f}"[:26].ljust(26))
        g = tot[n].setdefault(group, {"n": 0, "fail": 0, "agree": 0, "cost": 0.0, "secs": 0})
        g["n"] += 1
        g["fail"] += r["v"] == "fail"
        g["agree"] += bool(o) and r["v"] == o["v"]
        g["cost"] += r["cost"]
        g["secs"] += r["secs"]
    print(f"{head[:9]:10} {group:9} {(o['v'] + ('+' + str(o['fu']) if o['fu'] else '')) if o else '?':12} " + " ".join(cells))
    if full:
        for label, r in [("original", o)] + [(n, read(f"{a}/{head}.txt")) for a, n in zip(arms, names, strict=True)]:
            if r:
                body = r["text"].split("\n\n", 1)[-1].strip().replace("\n", "\n      ")
                print(f"   [{label}]\n      {body[:1500]}\n")
print()
for n in names:
    for group, g in tot[n].items():
        print(f"{n}: {group}: {g['n']} cases, fail {g['fail']}, same verdict as the original {g['agree']}, ${g['cost']:.2f}, {g['secs'] // max(g['n'], 1)} s a case")
