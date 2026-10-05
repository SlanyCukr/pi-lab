"""Extract P1/P2 defects with file:line locations from failed find-gaps verdicts.

Usage: python3 defects.py   (writes $CRAP_OUT/defects.json; CRAP_OUT defaults to ./out)
"""

import json
import os
import re
from collections import Counter
from pathlib import Path

VERDICTS = Path.home() / "Documents/personal/projects/media_monitoring.find-gaps/.find-gaps/verdicts"
OUT = Path(os.environ.get("CRAP_OUT", Path(__file__).parent / "out"))
ITEM = re.compile(r"\*\*(P[0-3])\b[^*]*\*\*(.*?)(?=\n\s*(?:\d+\.|-)\s+\*\*P[0-3]|\Z)", re.S)
LOC = re.compile(r"`((?:backend|frontend|scripts|\.github)/[^`:\s]+):(\d+)")


def field(text: str, name: str) -> str:
    m = re.search(rf"^{name}: (\w+)", text, re.M)
    return m.group(1) if m else ""


def main() -> None:
    out = []
    for f in sorted(VERDICTS.glob("*.txt")):
        text = f.read_text()
        verdicts = re.findall(r"VERDICT:\s*(\w+)", text, re.I)
        if not verdicts or verdicts[-1].lower() != "fail":
            continue
        for m in ITEM.finditer(text):
            if m.group(1) not in ("P1", "P2"):
                continue
            body = m.group(0)
            locs = sorted({(path, int(line)) for path, line in LOC.findall(body)})
            out.append(
                {
                    "head": field(text, "head"),
                    "base": field(text, "base"),
                    "sev": m.group(1),
                    "title": body.split("**")[1][:120],
                    "locs": locs,
                }
            )
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "defects.json").write_text(json.dumps(out, indent=0))
    print(len(out), "defects;", sum(len(d["locs"]) for d in out), "locations")
    print(Counter(path.split("/")[0] for d in out for path, _ in d["locs"]))


if __name__ == "__main__":
    main()
