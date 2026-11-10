#!/usr/bin/env python3
"""Prompt-cache audit of main sessions: how often a turn re-wrote context it had already written.

usage: cache-audit.py SINCE [--by-day]      SINCE = YYYY-MM-DD or YYYY-MM-DDTHH:MM (UTC, as in the session files)

Reads the find-gaps loop's cycle and review sessions and the pi-lab sessions. For each assistant turn it compares the
cache read with the previous turn's whole context (read + write + input):
  partial miss  the read fell short by more than 1,500 tokens but stayed above half: the tail was written again
                (a pi-lens injection that the next request no longer carries, see reviews/2026-11-10.md)
  full break    the read fell below half: the context was written again from the system prompt
                (a run of injections longer than Anthropic's 20-block look-back, an expired cache, a head change)
Dollars use the 1 h cache-write price of the turn's model (2 x input). "thinking dropped" counts turns whose
request lost earlier thinking blocks (`thinking_dropped`, reason prefix_binding_mismatch).
"""
import collections
import glob
import json
import os
import sys

HOME = os.path.expanduser("~")
ROOTS = [
    ("cycle", HOME + "/projects/media_monitoring.find-gaps/.find-gaps/sessions/*.jsonl"),
    ("review", HOME + "/projects/media_monitoring.find-gaps/.find-gaps/sessions/reviews/*/*.jsonl"),
    ("lab", HOME + "/.pi/agent/sessions/--home-loop-pi-lab--/*.jsonl"),
]
WRITE_1H = {"claude-fable-5-2": 16, "claude-fable-5-1": 20, "claude-opus-5-5": 8, "claude-sonnet-5-5": 4}  # $ per M tokens


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    since = sys.argv[1]
    by_day = "--by-day" in sys.argv
    rows: dict = collections.defaultdict(lambda: collections.Counter())
    for role, pattern in ROOTS:
        for path in glob.glob(pattern):
            prev = 0
            for line in open(path, errors="replace"):
                if '"usage"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                message = entry.get("message") or {}
                if entry.get("type") != "message" or message.get("role") != "assistant":
                    continue
                usage = message.get("usage") or {}
                read, write = usage.get("cacheRead", 0), usage.get("cacheWrite", 0)
                context = read + write + usage.get("input", 0)
                stamp = entry.get("timestamp", "")
                if stamp >= since:
                    row = rows[(stamp[:10] if by_day else "all", role)]
                    row["turns"] += 1
                    row["cost"] += (usage.get("cost") or {}).get("total", 0)
                    if any(
                        t.get("type") == "thinking_dropped"
                        for d in message.get("diagnostics") or []
                        for t in (d.get("details") or {}).get("transformations") or []
                    ):
                        row["dropped"] += 1
                    miss = prev - read
                    if prev and miss > 1500:
                        kind = "partial" if read > prev * 0.5 else "full"
                        rewritten = min(miss, write)
                        row[kind] += 1
                        row[kind + "_tokens"] += rewritten
                        row[kind + "_usd"] += rewritten * WRITE_1H.get(str(message.get("model")), 8) / 1e6
                prev = context
    print(f"cache audit since {since} (UTC)")
    print(f"{'':22} {'turns':>6} {'cost $':>8} | {'partial':>7} {'tokens':>9} {'$':>7} | {'full':>4} {'tokens':>9} {'$':>7} | thinking dropped")
    for key in sorted(rows):
        r = rows[key]
        share = 100 * r["dropped"] / r["turns"] if r["turns"] else 0
        print(
            f"{key[0]:10} {key[1]:11} {r['turns']:6d} {r['cost']:8.2f} | {r['partial']:7d} {r['partial_tokens']:9d} {r['partial_usd']:7.2f} |"
            f" {r['full']:4d} {r['full_tokens']:9d} {r['full_usd']:7.2f} | {r['dropped']} turns ({share:.0f} %)"
        )


if __name__ == "__main__":
    main()
