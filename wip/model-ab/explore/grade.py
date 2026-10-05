#!/usr/bin/env python3
"""Grade the Explore A/B: recall of key items, false list items, bad citations, cost, time."""
import glob
import json
import os
import re
import subprocess
import tempfile
from collections import defaultdict

# The A/B's scratch folder (run1.sh writes out/, sess/ and times.tsv there); override with ABX_ROOT.
ROOT = os.environ.get('ABX_ROOT', os.path.join(tempfile.gettempdir(), 'abx'))
REPO = f'{ROOT}/repo'
tasks = {t['id']: t for t in json.load(open(f'{ROOT}/tasks.json'))}
times = {}
for line in open(f'{ROOT}/times.tsv'):
    tag, tid, rep, rc, sec = line.rstrip('\n').split('\t')
    times[(tag, tid, rep)] = (int(rc), float(sec.replace(',', '.')))

files = subprocess.run(['git', '-C', REPO, 'ls-files'], capture_output=True, text=True).stdout.split('\n')
lines_cache = {}

def resolve(path):
    path = path.lstrip('./')
    if path in lines_cache or os.path.isfile(f'{REPO}/{path}'):
        return path
    hits = [f for f in files if f.endswith('/' + path)]
    return hits[0] if len(hits) == 1 else None

def nlines(p):
    if p not in lines_cache:
        with open(f'{REPO}/{p}', 'rb') as fh:
            lines_cache[p] = sum(1 for _ in fh)
    return lines_cache[p]

CITE = re.compile(r'([\w.\-/\[\]]+\.(?:tsx?|py|sh|md|ya?ml|json|sql)):(\d+)')
q7key = {line.strip().replace('frontend/', '') for line in open(f'{ROOT}/q7.txt')}

rows = []
for out in sorted(glob.glob(f'{ROOT}/out/*/*.txt')):
    tag = out.split('/')[-2]
    tid, rep = os.path.basename(out)[:-4].rsplit('-', 1)
    if (tag, tid, rep) not in times:
        continue
    text = open(out).read()
    t = tasks[tid]
    req = t['req']
    hit = sum(1 for r in req if re.search(r, text, re.I))
    fp = 0
    if tid == 'q7-enumerate':
        found = {m.replace('frontend/', '') for m in re.findall(r'(?:frontend/)?app/api/[\w\-/\[\]\.]+?route\.ts', text)}
        fp = len(found - q7key)
    bad = total = 0
    for path, ln in CITE.findall(text):
        total += 1
        p = resolve(path)
        if p is None or int(ln) > nlines(p):
            bad += 1
    cost = turns = 0
    for s in glob.glob(f'{ROOT}/sess/{tag}/{tid}-{rep}/*.jsonl'):
        for line in open(s):
            o = json.loads(line)
            if o.get('type') == 'message' and o['message'].get('role') == 'assistant':
                turns += 1
                cost += (o['message'].get('usage') or {}).get('cost', {}).get('total', 0) or 0
    rc, sec = times[(tag, tid, rep)]
    neg = bool(t.get('neg') and re.search(t['neg'], text, re.I))
    rows.append({'tag': tag, 'tid': tid, 'rep': rep, 'rc': rc, 'sec': sec, 'recall': hit / len(req), 'fp': fp,
                 'bad': bad, 'cites': total, 'cost': cost, 'turns': turns, 'empty': len(text.strip()) == 0, 'neg': neg})

json.dump(rows, open(f'{ROOT}/graded.json', 'w'), indent=1)
agg = defaultdict(lambda: defaultdict(float))
for r in rows:
    a = agg[r['tag']]
    a['n'] += 1; a['recall'] += r['recall']; a['full'] += r['recall'] == 1; a['fp'] += r['fp']; a['bad'] += r['bad']
    a['cites'] += r['cites']; a['cost'] += r['cost']; a['sec'] += r['sec']; a['turns'] += r['turns']; a['fail'] += r['rc'] != 0 or r['empty']
print(f"{'model':32} {'n':>3} {'recall':>7} {'full':>5} {'q7fp':>5} {'badcite':>8} {'$/task':>7} {'s/task':>7} {'turns':>6} {'fail':>5}")
for tag, a in sorted(agg.items()):
    n = a['n']
    print(f"{tag:32} {int(n):3} {a['recall']/n:7.2f} {int(a['full']):5} {int(a['fp']):5} {int(a['bad']):4}/{int(a['cites']):<4} {a['cost']/n:7.3f} {a['sec']/n:7.0f} {a['turns']/n:6.1f} {int(a['fail']):5}")
print()
per = defaultdict(dict)
for r in rows:
    per[r['tid']].setdefault(r['tag'], []).append(r['recall'])
tags = sorted(agg)
print('per task recall (mean of reps): ' + ' | '.join(t.split('_')[-1] for t in tags))
for tid in sorted(per):
    print(f"  {tid:14} " + '  '.join(f"{sum(per[tid].get(t, [0]))/max(1, len(per[tid].get(t, []))):.2f}" for t in tags))
