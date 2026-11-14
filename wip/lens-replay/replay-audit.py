#!/usr/bin/env python3
"""replay-audit.py [SESSIONS_DIR]: does lens-replay record every pi-lens message a session got?

Per main session that pi-lens logged (~/.pi-lens/latency.log*, phase cache_context): the number of pi-lens messages in
its last request (resultMessageCount - existingMessageCount) against the lens-replay entries in its session file.
A session with fewer entries loses its prompt cache when another process continues it.
Then every continuation by a new process within the hour (a find-gaps fix round): cache read of its first turn against
the context of the turn before. Default SESSIONS_DIR: the find-gaps loop's.
"""
import datetime as dt
import glob
import json
import os
import sys

D = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/projects/media_monitoring.find-gaps/.find-gaps/sessions')
last = {}
for log in sorted(glob.glob(os.path.expanduser('~/.pi-lens/latency.log*')), reverse=True):
    for line in open(log, errors='replace'):
        if '"phase":"cache_context"' not in line or '"sessionRole":"primary"' not in line: continue
        try: r = json.loads(line)
        except ValueError: continue
        m = r.get('metadata') or {}
        if 'sessionId' in m and r['ts'] > last.get(m['sessionId'], ('',))[0]: last[m['sessionId']] = (r['ts'], m)
short = total = 0
for sid, (ts, m) in sorted(last.items(), key=lambda x: x[1][0]):
    files = glob.glob(f'{D}/*_{sid}.jsonl')
    if not files: continue
    entries = sum(1 for line in open(files[0]) if '"lens-replay"' in line and json.loads(line).get('timestamp', '') <= ts)
    live = m['resultMessageCount'] - m['existingMessageCount']
    if not live and not entries: continue
    total += 1; short += entries < live
    print(f"{ts[:16]} {sid[:13]} pi-lens messages in the last request {live:3d}, recorded {entries:3d}{'  MISSING ' + str(live - entries) if entries < live else ''}")
print(f'{short} of {total} sessions with pi-lens messages have fewer entries than messages')

def P(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
for f in sorted(glob.glob(f'{D}/*.jsonl')):
    prev = None; pending = False
    for line in open(f):
        if '"type":"message"' not in line[:60]: continue
        r = json.loads(line); m = r['message']
        if m['role'] == 'user' and prev and prev[2] == 'stop': pending = True
        elif m['role'] == 'assistant':
            u = m.get('usage') or {}
            ctx = sum(u.get(k, 0) for k in ('input', 'cacheRead', 'cacheWrite'))
            if pending and prev and 60 < (P(r['timestamp']) - P(prev[0])).total_seconds() < 3600 and prev[1] > 50000:
                print(f"continued {r['timestamp'][:16]} {os.path.basename(f)[:19]}: read {u.get('cacheRead', 0):,} of {prev[1]:,} (the turn before), wrote {u.get('cacheWrite', 0):,}, ${(u.get('cost') or {}).get('total', 0):.2f}")
            pending = False; prev = (r['timestamp'], ctx, m.get('stopReason'))
