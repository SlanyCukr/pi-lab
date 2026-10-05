#!/usr/bin/env python3
"""Mine real pi sessions for decision points: moments where the main session ended a turn and the user
had to push it on ("continue", "keep going", "do it"), plus accepted endings and questions as controls.

  mine.py > cases.json

A case is the session file, the id of the entry the context ends at (the parent of the assistant message
under test), the cwd, and what happened. replay.mjs rebuilds the context up to that entry and samples the
next assistant message with tools blocked.
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.expanduser('~/.pi/agent/sessions')
PUSH = re.compile(r"^\s*(continue|keep going|keep working|go on|go ahead|do it|proceed|carry on|yes,? do it|yes)\b", re.I)
QUESTION = re.compile(r"^\s*(what|how|why|is|are|can|could|does|do|should|would|which|where|anything)\b.*\?\s*$", re.I | re.S)
SKIP_USER = re.compile(r"^(Monitor |Background command|\[loop|Your full task|You are |Review the |Read and follow|<)", re.S)


def text_of(m):
    c = m.get('content')
    if isinstance(c, str):
        return c
    return '\n'.join(x.get('text', '') for x in c or [] if isinstance(x, dict) and x.get('type') == 'text')


def has_tool_call(m):
    return any(isinstance(x, dict) and x.get('type') == 'toolCall' for x in m.get('content') or [])


def ending_kind(t):
    last = [ln for ln in t.strip().splitlines() if ln.strip()][-3:]
    tail = ' '.join(last)
    if re.search(r"(want me to|should i|shall i|say the word|reply [`\"']|tell me (if|whether|to)|let me know|do you want)", tail, re.I):
        return 'offer'
    if tail.rstrip().endswith('?'):
        return 'question'
    if re.search(r"(:\s*$|^(now|next)\b|\b(coming up|let me|i'll|i will|checking|running|launching)\b[^.]*$)", last[-1].strip(), re.I):
        return 'narration-stop'
    if re.search(r"^(next|then):?\s", last[-1].strip(), re.I) or re.search(r"\b(run|open|check)\b.*`", last[-1], re.I):
        return 'hands-off'
    return 'other'


cases = []
for f in sorted(glob.glob(os.path.join(ROOT, '*', '*.jsonl'))):
    if '/tasks/' in f:
        continue
    try:
        ents = [json.loads(line) for line in open(f) if line.strip()]
    except ValueError:
        continue
    head = next((e for e in ents if e.get('type') == 'session'), {})
    msgs = [e for e in ents if e.get('type') == 'message']
    for i, e in enumerate(msgs[:-1]):
        m, nxt = e['message'], msgs[i + 1]
        if m.get('role') != 'assistant' or has_tool_call(m) or m.get('stopReason') not in ('stop', 'end_turn'):
            continue
        prev = msgs[i - 1] if i else None
        if not prev or prev['message'].get('role') not in ('user', 'toolResult'):
            continue  # continue() needs a user or tool-result message last
        if nxt['message'].get('role') != 'user':
            continue
        ut = text_of(nxt['message']).strip()
        if SKIP_USER.match(ut):
            continue
        at = text_of(m)
        if not at.strip():
            continue
        base = {'session': f, 'cwd': head.get('cwd'), 'leaf': prev['id'], 'target': e['id'], 'ts': e.get('timestamp', '')[:16],
                'orig_ending': ending_kind(at), 'orig_tail': ' | '.join(at.strip().splitlines()[-2:])[:300], 'next_user': ut[:200]}
        if PUSH.match(ut) and len(ut) < 160:
            cases.append({**base, 'kind': 'pushed'})  # the user had to push: the turn should not have ended here
        elif prev['message'].get('role') == 'user' and QUESTION.match(text_of(prev['message']).strip()) \
                and len(text_of(prev['message'])) < 400 and not SKIP_USER.match(text_of(prev['message'])):
            cases.append({**base, 'kind': 'question', 'question': text_of(prev['message']).strip()[:300]})

# one case per identical ending (repeated "continue" after the same stuck message counts once)
seen, out = set(), []
for c in cases:
    k = (c['session'], c['orig_tail'])
    if k in seen:
        continue
    seen.add(k)
    c['id'] = f"{c['kind']}-{len(out):03d}"
    out.append(c)
json.dump(out, sys.stdout, indent=1)
print(f"{len(out)} cases: " + ', '.join(f"{k}={sum(1 for c in out if c['kind'] == k)}" for k in ('pushed', 'question')), file=sys.stderr)
