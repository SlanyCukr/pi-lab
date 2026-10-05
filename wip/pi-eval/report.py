#!/usr/bin/env python3
"""Pass rates per variant and split: report.py [variant ...]"""
import collections
import glob
import json
import math
import os
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
cases = {c['id']: c for c in json.load(open(os.path.join(HERE, 'cases.json')))}
vs = sys.argv[1:] or sorted(os.listdir(os.path.join(HERE, 'runs')))
for v in vs:
    gs = [json.load(open(p)) for p in glob.glob(os.path.join(HERE, 'runs', v, '*.grade.json'))]
    line = [v]
    for split in ('train', 'test'):
        g = [x for x in gs if cases[x['id']]['split'] == split and x['verdict'] != 'ERROR']
        p = sum(x['verdict'] == 'PASS' for x in g); n = len(g)
        se = math.sqrt(p / n * (1 - p / n) / n) if n else 0
        line.append(f"{split} {p}/{n} = {100 * p / max(1, n):.0f}% (±{100 * se:.0f})")
    errs = sum(x['verdict'] == 'ERROR' for x in gs)
    kinds = collections.defaultdict(lambda: [0, 0])
    for x in gs:
        if x['verdict'] != 'ERROR':
            kinds[x['kind']][0] += x['verdict'] == 'PASS'; kinds[x['kind']][1] += 1
    print('  '.join(line), f' errors {errs}', ' | ' + ', '.join(f"{k} {a}/{b}" for k, (a, b) in sorted(kinds.items())))
