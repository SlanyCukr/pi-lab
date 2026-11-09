#!/usr/bin/env python3
"""Poll audit for bg-bash's early wake (harness review 2026-11-09).

A poll is a main-session foreground bash call that starts with `sleep N` (N >= 30, optional `cd dir &&` first).
For each poll this measures, from the session files, how long its result came back after a background command
of the same session had finished (the job's end is its start plus the "ran Ns" of its result). Polls are timed by
their real result timestamp, so a poll that woke early counts as on time.

Usage: poll-audit.py SINCE [UNTIL]   (ISO dates, e.g. 2026-11-09)
Prints: polls; polls while a background command ran (per session); polls whose result came after a job's end and
the minutes lost; results that woke early ("the sleep ended after").
"""
import datetime
import glob
import json
import os
import re
import sys

since = sys.argv[1]
until = sys.argv[2] if len(sys.argv) > 2 else "9999"
POLL = re.compile(r"\s*(?:cd\s+(?:\"[^\"]*\"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*)?sleep\s+(\d+)\s*(?:;|&&|\n|$)")
ROOTS = ["~/.pi/agent/sessions", "~/projects/media_monitoring.find-gaps/.find-gaps/sessions"]


def ts(s):
    if isinstance(s, (int, float)):
        return s / 1000
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


polls = during = late = woke = 0
lost = 0.0
sessions = set()
for root in ROOTS:
    for f in glob.glob(os.path.expanduser(root) + "/**/*.jsonl", recursive=True):
        if os.path.getmtime(f) < ts(since + "T00:00:00Z"):
            continue
        starts, jobs, rows, calls = {}, [], [], {}
        for line in open(f, errors="ignore"):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            t = e.get("timestamp", "")
            if not isinstance(t, str) or not (since <= t < until):
                continue
            if e.get("type") == "custom_message" and e.get("customType") == "bg-bash":
                for m in re.finditer(r"Background command (bg\d+) finished: .*?ran (\d+)s", e.get("content", "")):
                    if m.group(1) in starts:
                        jobs.append((starts.pop(m.group(1)), int(m.group(2))))
                continue
            msg = e.get("message") or {}
            if msg.get("role") == "assistant":
                for b in msg.get("content", []):
                    if b.get("type") == "toolCall" and b.get("name") == "bash":
                        calls[b["id"]] = (ts(t), b.get("arguments") or {})
            elif msg.get("role") == "toolResult" and msg.get("toolCallId") in calls:
                t0, a = calls[msg["toolCallId"]]
                text = "".join(x.get("text", "") for x in msg.get("content", []) if x.get("type") == "text")
                for m in re.finditer(r"background as (bg\d+)", text):
                    starts[m.group(1)] = t0
                # an early-woken poll carries the job's result inline: count it as finished too
                for m in re.finditer(r"Background command (bg\d+) finished: .*?ran (\d+)s", text):
                    if m.group(1) in starts:
                        jobs.append((starts.pop(m.group(1)), int(m.group(2))))
                p = POLL.match(a.get("command") or "")
                if p and int(p.group(1)) >= 30 and not a.get("background") and not a.get("monitor"):
                    rows.append((t0, ts(t), "the sleep ended after" in text))
        for t0, t1, early in rows:
            polls += 1
            woke += early
            # a job ran at the poll's start: finished after it, or never finished in this file
            if any(s < t0 < s + ran for s, ran in jobs) or any(s < t0 for s in starts.values()):
                during += 1
                sessions.add(f)
            ends = [s + ran for s, ran in jobs if s < t0 < s + ran < t1]
            if ends:
                late += 1
                lost += t1 - min(ends)
print(f"polls {polls}; during a background command {during} in {len(sessions)} sessions")
print(f"result after the job had ended: {late} polls, {lost / 60:.0f} min (early wake makes this ~1-2 s each)")
print(f"woke early (\"the sleep ended after\"): {woke}")
