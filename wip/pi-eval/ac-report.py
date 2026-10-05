#!/usr/bin/env python3
"""Pass rate of <variant> without and with auto-continue (continued samples take the grade of the turn after the nudge).
  ac-report.py <variant>"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
v = sys.argv[1]
cases = {c['id']: c for c in json.load(open(os.path.join(HERE, 'cases.json')))}
for split in ('train', 'test'):
    base = auto = n = cont = fixed = broke = 0
    for p in glob.glob(os.path.join(HERE, 'runs', v, '*.grade.json')):
        g = json.load(open(p))
        if cases[g['id']]['split'] != split:
            continue
        n += 1
        b = g['verdict'] == 'PASS'
        a = b
        q = os.path.join(HERE, 'runs-ac', v, os.path.basename(p))
        if os.path.exists(q):
            cont += 1
            a = json.load(open(q))['verdict'] == 'PASS'
            fixed += a and not b
            broke += b and not a
        base += b
        auto += a
    print(f"{v} {split}: without {base}/{n} = {100*base/n:.0f}%, with auto {auto}/{n} = {100*auto/n:.0f}%  (continued {cont}, fixed {fixed}, broke {broke})")
