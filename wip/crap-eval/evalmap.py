"""Map every reviewed find-gaps range to the TS functions its diff touched and the ones a defect points into.

Needs defects.json (defects.py) and a built effect-crap (EFFECT_CRAP=path/to/dist/bin.js).
Writes $CRAP_OUT/map.json.
"""

import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

WORKTREE = Path.home() / "Documents/personal/projects/media_monitoring.find-gaps"
OUT = Path(os.environ.get("CRAP_OUT", Path(__file__).parent / "out"))
EFFECT_CRAP = os.environ.get("EFFECT_CRAP", str(Path(__file__).parent / "effect-crap/dist/bin.js"))
INCLUDED = re.compile(r"^frontend/(app/api/.*\.ts|lib/.*\.ts|features/.*\.tsx?)$")
TEST_FILE = re.compile(r"\.(test|spec)\.tsx?$|/__tests__/")
HUNK = re.compile(r"^@@ -\S+ \+(\d+)(?:,(\d+))? @@", re.M)


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(WORKTREE), *args], capture_output=True, text=True).stdout


def norm(name: str) -> str:
    """Drop effect-crap's @line:col suffix so a function keeps its key across commits."""
    return re.sub(r"@\d+:\d+", "", name)


def field(text: str, name: str) -> str:
    m = re.search(rf"^{name}: (\w+)", text, re.M)
    return m.group(1) if m else ""


def analysable(path: str) -> bool:
    return bool(INCLUDED.match(path)) and not TEST_FILE.search(path)


def snapshot(head: str, files: list[str]) -> tuple[Path, list[str]]:
    root = OUT / "snap" / head
    kept = []
    for path in files:
        content = subprocess.run(["git", "-C", str(WORKTREE), "show", f"{head}:{path}"], capture_output=True).stdout
        if not content:
            continue
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        kept.append(path)
    return root, kept


def functions_by_file(root: Path, files: list[str]) -> dict[str, list[dict]]:
    cmd = ["node", EFFECT_CRAP, "--root", str(root), *files, "--format", "json", "--threshold", "1000000"]
    report = json.loads(subprocess.run([*cmd, "--no-default-exclusions"], capture_output=True, text=True).stdout)
    by_file: dict[str, list[dict]] = defaultdict(list)
    for fn in report["functions"]:
        by_file[fn["file"]].append(fn)
    return by_file


def innermost(fns: list[dict], line: int) -> dict | None:
    hits = [fn for fn in fns if fn["range"]["start"]["line"] <= line <= fn["range"]["end"]["line"]]
    return min(hits, key=lambda fn: fn["range"]["end"]["line"] - fn["range"]["start"]["line"]) if hits else None


def main() -> None:
    defects = json.loads((OUT / "defects.json").read_text())
    defect_locs: dict[str, list[tuple[str, int, int]]] = defaultdict(list)
    for i, d in enumerate(defects):
        for path, line in d["locs"]:
            defect_locs[d["head"]].append((path, line, i))
    touched: Counter = Counter()
    defect_fns: dict[tuple[str, str], set[int]] = defaultdict(set)
    ranges = 0
    for verdict in sorted((WORKTREE / ".find-gaps/verdicts").glob("*.txt")):
        text = verdict.read_text()
        head, base = field(text, "head"), field(text, "base")
        files = {p for p in git("diff", "--name-only", base, head).split() if analysable(p)}
        files |= {p for p, _, _ in defect_locs.get(head, []) if analysable(p)}
        root, kept = snapshot(head, sorted(files))
        if not kept:
            continue
        ranges += 1
        by_file = functions_by_file(root, kept)
        seen = set()
        for path in kept:
            for m in HUNK.finditer(git("diff", "-U0", base, head, "--", path)):
                start, count = int(m.group(1)), int(m.group(2) or 1)
                for line in range(start, start + max(count, 1)):
                    fn = innermost(by_file[path], line)
                    if fn:
                        seen.add((path, norm(fn["name"])))
        touched.update(seen)
        for path, line, i in defect_locs.get(head, []):
            fn = innermost(by_file.get(path, []), line)
            if fn:
                defect_fns[(path, norm(fn["name"]))].add(i)
    result = {
        "ranges": ranges,
        "touched": [[p, n, c] for (p, n), c in touched.items()],
        "defects": [[p, n, sorted(v)] for (p, n), v in defect_fns.items()],
    }
    (OUT / "map.json").write_text(json.dumps(result))
    covered = set().union(*defect_fns.values()) if defect_fns else set()
    print("ranges", ranges, "touched fns", len(touched), "defect fns", len(defect_fns), "defects covered", len(covered))


if __name__ == "__main__":
    main()
