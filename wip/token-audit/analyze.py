#!/usr/bin/env python3
"""Token/cost audit of pi session logs.

Usage: analyze.py [--since YYYY-MM-DD] [--json out.json]

Reads ~/.pi/agent/sessions/**/*.jsonl. Uses the per-request `usage` pi records
(input, cacheRead, cacheWrite, output, and their dollar cost from model pricing).

Attribution: each request's prompt is modelled as
  [static prefix (system + tools)] + [context items in order].
Item sizes are estimated from characters and scaled so they sum to the real
prompt token count. Prompt tokens are then assigned in order: first cacheRead,
then cacheWrite, then uncached input (Anthropic prefix-cache order), and each
slice is priced at that request's per-token rate for that billing type.
Output cost goes to "output". Compaction and cache-warm calls are their own sources.
"""

import argparse
import collections
import datetime
import glob
import json
import os
import sys

TOOL_SRC = {
    "read": "tool: file reads",
    "bash": "tool: command output",
    "edit": "tool: edit/write",
    "write": "tool: edit/write",
    "web_search": "tool: web",
    "fetch_content": "tool: web",
    "subagent": "tool: subagent results",
    "get_subagent_result": "tool: subagent results",
    "steer_subagent": "tool: subagent results",
    "advisor": "tool: advisor",
    "lens_diagnostics": "tool: pi-lens",
    "lsp_navigation": "tool: pi-lens",
}
PROMPT_KEYS = ("cacheRead", "cacheWrite", "input")
ALL_KEYS = ("input", "cacheRead", "cacheWrite", "output")
CHARS_PER_TOKEN = 3.6


class ToolStat:
    def __init__(self):
        self.calls = 0
        self.errors = 0
        self.chars = 0
        self.maxchars = 0
        self.sessions: set = set()


class Audit:
    def __init__(self):
        self.cost = collections.defaultdict(float)  # (scope, source, billtype) -> $
        self.tokens = collections.defaultdict(float)
        self.tool: dict = collections.defaultdict(ToolStat)
        self.sessions: list = []
        self.model_cost = collections.defaultdict(float)
        self.static_samples: list = []
        self.rewrite = collections.defaultdict(lambda: [0.0, 0.0, 0])  # (scope, cause) -> [tokens, $, count]
        self.events: list = []
        self.current_path = ""

    def add_usage(self, scope, source, usage):
        cost = usage.get("cost") or {}
        for key in ALL_KEYS:
            self.cost[(scope, source, key)] += cost.get(key, 0)
            self.tokens[(scope, source, key)] += usage.get(key, 0)
        return cost.get("total", 0)

    def attribute_request(self, scope, usage, static, items):
        """Split one request's prompt cost over static prefix + context items."""
        cost = usage.get("cost") or {}
        prompt = sum(usage.get(k, 0) for k in PROMPT_KEYS)
        hist_tok = max(prompt - static, 0)
        scale = hist_tok / (sum(it[2] for it in items) or 1)
        segs = [("static prefix (system + tools)", min(static, prompt))]
        segs += [(it[1], it[2] * scale) for it in items]
        remaining = {b: usage.get(b, 0) for b in PROMPT_KEYS}
        rate = {b: (cost.get(b, 0) / usage[b]) if usage.get(b) else 0 for b in PROMPT_KEYS}
        for source, ntok in segs:
            left = ntok
            for bill in PROMPT_KEYS:
                take = min(left, remaining[bill])
                if take > 0:
                    remaining[bill] -= take
                    left -= take
                    self.cost[(scope, source, bill)] += take * rate[bill]
                    self.tokens[(scope, source, bill)] += take
                if left <= 0:
                    break
        self.cost[(scope, "output", "output")] += cost.get("output", 0)
        self.tokens[(scope, "output", "output")] += usage.get("output", 0)

    def process(self, path, scope):
        items = []  # [entry_id, source, chars]
        static = None
        st = {"scope": scope, "user": 0, "turns": 0, "cost": 0.0, "model_changes": 0,
              "compactions": 0, "prompt_tok": 0, "cache_read_tok": 0,
              "prev_prompt": 0, "prev_ts": None, "prev_model": None, "event": None}
        with open(path) as fh:
            lines = fh.readlines()
        for line in lines:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError as err:
                print(f"skip bad line in {path}: {err}", file=sys.stderr)
                continue
            kind = entry.get("type")
            if kind == "model_change":
                st["model_changes"] += 1
            elif kind == "compaction":
                st["compactions"] += 1
                st["event"] = "compaction"
                st["cost"] += self.add_usage(scope, "compaction call", entry.get("usage") or {})
                keep = entry.get("firstKeptEntryId")
                idx = next((i for i, it in enumerate(items) if it[0] == keep), len(items))
                summary = [entry.get("id"), "compaction summary", len(entry.get("summary", ""))]
                items = [summary] + items[idx:]
            elif kind == "usage":
                source = "cache warm" if entry.get("kind") == "cache_warm" else "other calls"
                st["cost"] += self.add_usage(scope, source, entry.get("usage") or {})
            elif kind == "custom_message":
                source = "injected: " + str(entry.get("customType"))
                items.append([entry.get("id"), source, text_len(entry.get("content"))])
                st["pred"] = source
            elif kind == "message":
                static = self.process_message(path, scope, entry, items, static, st)
        self.sessions.append(st)

    def process_message(self, path, scope, entry, items, static, st):
        msg = entry["message"]
        role = msg.get("role")
        if role == "user":
            st["user"] += 1
            st["pred"] = "user"
            items.append([entry.get("id"), "user messages", text_len(msg.get("content"))])
        elif role == "toolResult":
            name = msg.get("toolName", "?")
            size = text_len(msg.get("content"))
            source = TOOL_SRC.get(name, "tool: other")
            if name in ("bash", "read", "grep", "find"):
                source += " >8K" if size > 8000 else " <=8K"
            items.append([entry.get("id"), source, size])
            ts = self.tool[(scope, name)]
            ts.calls += 1
            ts.chars += size
            ts.maxchars = max(ts.maxchars, size)
            ts.errors += 1 if msg.get("isError") else 0
            ts.sessions.add(path)
        elif role == "assistant":
            usage = msg.get("usage") or {}
            prompt = sum(usage.get(k, 0) for k in PROMPT_KEYS)
            if prompt > 0:
                st["turns"] += 1
                st["cost"] += (usage.get("cost") or {}).get("total", 0)
                st["prompt_tok"] += prompt
                st["cache_read_tok"] += usage.get("cacheRead", 0)
                model = f"{msg.get('provider')}/{msg.get('model')}"
                self.model_cost[(scope, model)] += (usage.get("cost") or {}).get("total", 0)
                if static is None:
                    est_hist = sum(it[2] for it in items) / CHARS_PER_TOKEN
                    static = max(prompt - est_hist, prompt * 0.3)
                    self.static_samples.append((scope, static))
                self.attribute_request(scope, usage, static, items)
                self.track_rewrite(scope, entry, msg, usage, prompt, st)
            content = msg.get("content") or []
            for sub in ("thinking", "text", "toolCall"):
                parts = [p for p in content if p.get("type") == sub]
                if parts:
                    items.append([entry.get("id"), f"history: assistant {sub}", text_len(parts)])
        return static

    def track_rewrite(self, scope, entry, msg, usage, prompt, st):
        """Prompt tokens written/uncached beyond what was new since the previous request."""
        cost = usage.get("cost") or {}
        written = usage.get("cacheWrite", 0) + usage.get("input", 0)
        excess = written - max(prompt - st["prev_prompt"], 0)
        ts = entry.get("timestamp")
        when = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() if ts else None
        model = f"{msg.get('provider')}/{msg.get('model')}"
        if st["prev_ts"] is None:
            cause = "first request"
        elif st["event"] == "compaction":
            cause = "after compaction"
        elif model != st["prev_model"]:
            cause = "model switch"
        elif when and when - st["prev_ts"] > 3600:
            cause = "gap > 1h"
        elif when and when - st["prev_ts"] > 300:
            cause = "gap 5-60 min"
        else:
            cause = "no gap (prefix change?)"
        if excess > 2000:
            rate = (cost.get("cacheWrite", 0) + cost.get("input", 0)) / written if written else 0
            rec = self.rewrite[(scope, cause)]
            rec[0] += excess
            rec[1] += excess * rate
            rec[2] += 1
            self.events.append({"scope": scope, "cause": cause, "ts": ts, "model": model,
                                "prompt": prompt, "read": usage.get("cacheRead", 0), "excess": excess,
                                "cost": round(excess * rate, 3), "entry": entry.get("id"),
                                "file": os.path.basename(self.current_path),
                                "gap_s": round(when - st["prev_ts"]) if when and st["prev_ts"] else None,
                                "pred": st.get("pred"), "prev_pred": st.get("prev_pred")})
        st["prev_pred"] = st.get("pred")
        st["pred"] = "toolResult"
        st["prev_prompt"] = prompt
        st["prev_ts"] = when
        st["prev_model"] = model
        st["event"] = None

    def report(self, scope):
        tot = sum(v for (s, _, _), v in self.cost.items() if s == scope)
        sess = [s for s in self.sessions if s["scope"] == scope and s["turns"]]
        print(f"\n=== {scope}: {len(sess)} sessions, ${tot:.2f} total ===")
        by_bill = collections.defaultdict(float)
        by_src = collections.defaultdict(lambda: collections.defaultdict(float))
        for (s, source, bill), v in self.cost.items():
            if s == scope:
                by_bill[bill] += v
                by_src[source][bill] += v
        parts = sorted(by_bill.items(), key=lambda x: -x[1])
        print("billing type: " + ", ".join(f"{b} ${v:.2f} ({pct(v, tot).strip()})" for b, v in parts))
        print(f"{'source':34s} {'total':>8s} {'share':>6s} {'cRead':>7s} {'cWrite':>7s} {'input':>7s} {'output':>7s}")
        for source, d in sorted(by_src.items(), key=lambda x: -sum(x[1].values())):
            t = sum(d.values())
            if t >= 0.005 * tot:
                print(f"{source[:34]:34s} {t:8.2f} {pct(t, tot)} {d['cacheRead']:7.2f} "
                      f"{d['cacheWrite']:7.2f} {d['input']:7.2f} {d['output']:7.2f}")
        users = sum(s["user"] for s in sess)
        turns = sum(s["turns"] for s in sess)
        prompt = sum(s["prompt_tok"] for s in sess)
        cread = sum(s["cache_read_tok"] for s in sess)
        statics = sorted(v for sc, v in self.static_samples if sc == scope)
        med = statics[len(statics) // 2] if statics else 0
        print(f"user msgs {users}, requests {turns}, requests/user msg {turns / max(users, 1):.1f}, "
              f"cost/user msg ${tot / max(users, 1):.2f}, cache-read share {pct(cread, prompt).strip()}, "
              f"median static prefix ~{med:.0f} tok, compactions {sum(s['compactions'] for s in sess)}, "
              f"model switches {sum(s['model_changes'] for s in sess)}")
        models = sorted(((k[1], v) for k, v in self.model_cost.items() if k[0] == scope), key=lambda x: -x[1])
        print("models: " + ", ".join(f"{m} ${v:.2f}" for m, v in models[:6]))
        print("re-written prefix (excess >2K tok): " + ", ".join(
            f"{cause} {rec[2]}x {rec[0] / 1e6:.1f}M tok ${rec[1]:.2f}"
            for (s, cause), rec in sorted(self.rewrite.items(), key=lambda x: -x[1][1]) if s == scope))
        nsess = len(sess) or 1
        print(f"{'tool':22s} {'calls':>6s} {'sess%':>6s} {'err%':>6s} {'avgKch':>7s} {'maxKch':>7s}")
        for (s, name), ts in sorted(self.tool.items(), key=lambda x: -x[1].calls):
            if s == scope:
                print(f"{name[:22]:22s} {ts.calls:6d} {pct(len(ts.sessions), nsess)} "
                      f"{pct(ts.errors, ts.calls)} {ts.chars / ts.calls / 1000:7.1f} {ts.maxchars / 1000:7.1f}")
        return {"total": tot, "users": users, "requests": turns,
                "sources": {k: dict(v) for k, v in by_src.items()}}


def text_len(content):
    if isinstance(content, str):
        return len(content)
    size = 0
    for part in content or []:
        kind = part.get("type")
        if kind == "text":
            size += len(part.get("text", ""))
        elif kind == "thinking":
            size += len(part.get("thinking", ""))
        elif kind == "toolCall":
            size += len(json.dumps(part.get("arguments", {}))) + len(part.get("name", "")) + 20
        elif kind == "image":
            size += 6000
    return size


def pct(a, b):
    return f"{100 * a / b:5.1f}%" if b else "  -  "


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=None)
    ap.add_argument("--json", default=None)
    ap.add_argument("--root", default=os.path.expanduser("~/.pi/agent/sessions"))
    args = ap.parse_args()
    since = datetime.datetime.fromisoformat(args.since).timestamp() if args.since else 0
    audit = Audit()
    for path in sorted(glob.glob(os.path.join(args.root, "**", "*.jsonl"), recursive=True)):
        if os.path.getmtime(path) >= since:
            audit.current_path = path
            audit.process(path, "sub" if "/tasks/" in path else "main")
    out: dict = {scope: audit.report(scope) for scope in ("main", "sub")}
    out["cache_events"] = audit.events
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(out, fh, indent=1)


if __name__ == "__main__":
    main()
