#!/usr/bin/env python3
"""Regression safety net for the redesign (Phase 0a).

Hits a fixed set of DETERMINISTIC /api endpoints and saves their JSON responses
as "golden" snapshots. `--compare` re-fetches and diffs against the golden files,
so a refactor can be proven not to change any response shape/content.

Because there is no local server (bible.db is PA-only), this verifies a deploy
AFTER it lands — capture golden on the current live site, refactor + deploy, then
`--compare` against the live site again. Any diff = a regression to investigate
(or an intended change to re-baseline with `--update`).

AI / non-deterministic endpoints (ai-search, ai-description, curated cross-refs)
are intentionally EXCLUDED — they call Haiku and won't reproduce byte-for-byte.

Usage:
  python scripts/snapshot_endpoints.py --capture          # save golden from BASE_URL
  python scripts/snapshot_endpoints.py --compare          # diff live vs golden
  python scripts/snapshot_endpoints.py --update           # re-baseline (intended changes)
  python scripts/snapshot_endpoints.py --base http://localhost:5000 --compare
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

BASE_URL_DEFAULT = "https://appssanding720.pythonanywhere.com"
SNAP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests", "snapshots")

# Deterministic, DB-driven endpoints spanning the subsystems Phases 1-3 touch.
# Keep this list small but representative (library ABP/KJV, verse-words, lexicon,
# lsj/bdb, kjv strongs, metav person/place, cross-refs, counts).
ENDPOINTS = [
    "/api/books",
    "/api/chapter/Gen/1",
    "/api/chapter/Joh/1",
    "/api/chapter/Psa/23",
    "/api/chapter/1Ch/1",            # proper-noun heavy (Adam/H121) — exercises tipnr + metav routing
    "/api/kjv/chapter/Gen/1",
    "/api/kjv/chapter/Joh/1",
    "/api/verse-words/Gen/1/1",
    "/api/verse-words/Joh/1/1",
    "/api/verse-words/Eze/31/9",     # the ζηλόω/G2206 canary from the strongs_base saga
    "/api/kjv/verse_words/Gen/1/1",
    "/api/search?q=spirit&phrase=0",        # exercises the search() lexicon joins (1429/1453/1474, 1366)
    "/api/search?q=G4151&phrase=0",
    "/api/lexicon/english?q=spirit&corpus=ABP",  # exercises lexicon_english joins (2090, 2115)
    "/api/lexicon/lookup?q=G4151",
    "/api/lexicon/lookup?q=spirit",
    "/api/lexicon/profile/G4151",
    "/api/lexicon/books/G4151",
    "/api/lexicon/verses/G4151/Joh",
    "/api/lsj/" + urllib.parse.quote("πνεῦμα"),
    "/api/bdb/H7307",
    "/api/kjv/strongs-count/G4151",
    "/api/kjv/strongs-search/G4151",
    "/api/strongs-count/G4151",
    "/api/pn-count/Adam",
    "/api/metav/person/Adam",
    "/api/metav/place/Bethlehem",
    "/api/cross-references/Joh/3/16",
]


def _slug(path: str) -> str:
    """Filesystem-safe filename for an endpoint path."""
    s = path.lstrip("/").replace("/", "__")
    s = urllib.parse.unquote(s)
    for ch in '?&=%:"<>|*':
        s = s.replace(ch, "_")
    return s + ".json"


def _fetch(base: str, path: str, timeout: int = 30):
    """Return (status_code, normalized_json_text). Errors captured, not raised."""
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, headers={"User-Agent": "lexica-snapshot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as e:
        return e.code, json.dumps({"__http_error__": e.code, "body": e.read().decode("utf-8", "replace")[:500]})
    except Exception as e:  # noqa: BLE001
        return None, json.dumps({"__fetch_error__": str(e)})
    try:
        obj = json.loads(raw)
        # Canonical form: sorted keys + stable indentation so diffs are meaningful.
        return status, json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2)
    except json.JSONDecodeError:
        return status, raw  # non-JSON (shouldn't happen for these routes) — store as-is


def capture(base: str, update: bool = False) -> int:
    os.makedirs(SNAP_DIR, exist_ok=True)
    verb = "Updated" if update else "Captured"
    n_ok = 0
    for path in ENDPOINTS:
        status, text = _fetch(base, path)
        if status != 200:
            print(f"  ! SKIP {path} — status {status} (not saved)")
            continue
        with open(os.path.join(SNAP_DIR, _slug(path)), "w", encoding="utf-8") as f:
            f.write(text)
        n_ok += 1
        print(f"  {verb}: {path}")
    print(f"\n{verb} {n_ok}/{len(ENDPOINTS)} snapshots -> {os.path.relpath(SNAP_DIR)}")
    return 0 if n_ok == len(ENDPOINTS) else 1


def compare(base: str) -> int:
    if not os.path.isdir(SNAP_DIR):
        print("No golden snapshots yet — run --capture first.")
        return 2
    n_diff = 0
    n_checked = 0
    for path in ENDPOINTS:
        fn = os.path.join(SNAP_DIR, _slug(path))
        if not os.path.exists(fn):
            print(f"  ? NO GOLDEN  {path}")
            continue
        with open(fn, encoding="utf-8") as f:
            golden = f.read()
        status, current = _fetch(base, path)
        n_checked += 1
        if status != 200:
            print(f"  ! ERROR      {path} — status {status}")
            n_diff += 1
            continue
        if current == golden:
            print(f"  OK          {path}")
        else:
            n_diff += 1
            print(f"  *** DIFF *** {path}")
            _print_first_diff(golden, current)
    print(f"\n{n_checked} checked, {n_diff} differing.")
    if n_diff:
        print("Investigate diffs. If intended, re-baseline with --update.")
    return 1 if n_diff else 0


def _print_first_diff(golden: str, current: str, context: int = 2) -> None:
    g = golden.splitlines()
    c = current.splitlines()
    for i in range(max(len(g), len(c))):
        gl = g[i] if i < len(g) else "<missing>"
        cl = c[i] if i < len(c) else "<missing>"
        if gl != cl:
            lo = max(0, i - context)
            for j in range(lo, i):
                print(f"      | {g[j] if j < len(g) else ''}")
            print(f"    - | {gl}")
            print(f"    + | {cl}")
            return


def main() -> int:
    ap = argparse.ArgumentParser(description="Endpoint snapshot regression net (Phase 0a).")
    ap.add_argument("--base", default=BASE_URL_DEFAULT, help="Base URL (default: live PA).")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--capture", action="store_true", help="Save golden snapshots.")
    g.add_argument("--compare", action="store_true", help="Diff live vs golden.")
    g.add_argument("--update", action="store_true", help="Re-baseline golden (intended changes).")
    args = ap.parse_args()
    print(f"Base: {args.base}\n")
    if args.compare:
        return compare(args.base)
    return capture(args.base, update=args.update)


if __name__ == "__main__":
    sys.exit(main())
