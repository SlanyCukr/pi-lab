"""Score how well CRAP and simpler signals pick out the functions review defects landed in.

Needs map.json (evalmap.py) and an effect-crap JSON report for the current HEAD ($CRAP_OUT/fe-crap.json).
"""

import json
import os
import random
import re
from pathlib import Path

OUT = Path(os.environ.get("CRAP_OUT", Path(__file__).parent / "out"))
PREDICTORS = ["crap", "cc", "unc", "churn", "loc"]


def norm(name: str) -> str:
    return re.sub(r"@\d+:\d+", "", name)


def load_rows() -> list[dict]:
    head: dict[tuple[str, str], dict] = {}
    for f in json.loads((OUT / "fe-crap.json").read_text())["functions"]:
        key = ("frontend/" + f["file"], norm(f["name"]))
        if key not in head or (f["crap"] or 0) > (head[key]["crap"] or 0):
            head[key] = f
    mapping = json.loads((OUT / "map.json").read_text())
    touched = {(p, n): c for p, n, c in mapping["touched"]}
    defect_fns = {(p, n) for p, n, _ in mapping["defects"]}
    rows = []
    for key in set(touched) | defect_fns:
        f = head.get(key)
        if not f or f["crap"] is None:
            continue
        rows.append(
            {
                "k": key,
                "y": key in defect_fns,
                "crap": f["crap"],
                "cc": f["complexity"],
                "unc": 1 - f["coverage"]["ratio"],
                "churn": touched.get(key, 1),
                "loc": f["range"]["end"]["line"] - f["range"]["start"]["line"] + 1,
            }
        )
    print("population", len(rows), "defect fns", sum(r["y"] for r in rows), "of", len(defect_fns))
    return rows


def auc(pos: list[float], neg: list[float]) -> float:
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def top_hits(rows: list[dict], key: str, frac: float = 0.1) -> tuple[int, int]:
    ranked = sorted(rows, key=lambda r: -r[key])
    n = max(1, int(len(ranked) * frac))
    return sum(r["y"] for r in ranked[:n]), n


def main() -> None:
    rows = load_rows()
    pos_rows = [r for r in rows if r["y"]]
    neg_rows = [r for r in rows if not r["y"]]
    base = len(pos_rows) / len(rows)
    print(f"base rate {base:.3f}")
    for key in PREDICTORS:
        hits, n = top_hits(rows, key)
        score = auc([r[key] for r in pos_rows], [r[key] for r in neg_rows])
        print(f"{key:6s} AUC {score:.2f}  top10%: {hits}/{n} ({hits / n:.2f}, lift {hits / n / base:.1f}x)")
    rng = random.Random(1)
    for key in ("crap", "churn"):
        samples = sorted(
            auc([rng.choice(pos_rows)[key] for _ in pos_rows], [rng.choice(neg_rows)[key] for _ in neg_rows])
            for _ in range(300)
        )
        print(key, "AUC 90% CI", round(samples[15], 2), "-", round(samples[284], 2))
    print("defect fns:")
    for r in sorted(pos_rows, key=lambda r: -r["crap"]):
        print(f"  crap {r['crap']:6.1f} cc {r['cc']:2d} unc {r['unc']:.2f} churn {r['churn']:2d} {r['k'][0][9:]} {r['k'][1][:40]}")


if __name__ == "__main__":
    main()
