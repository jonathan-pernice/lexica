#!/usr/bin/env python3
"""Position-INDEPENDENT diff of two bible.db builds (READ-ONLY).

Compares, per verse, the multiset of (strongs, english) over non-empty-english
word slots -- IGNORING position. _split_compounds changes shift word positions,
so a per-position diff inflates one real change into many spurious shuffles
(attempt 1's bogus "11,036 verses"). Keying on the content multiset isolates
genuine english redistribution (a word moved to a different Strong's slot, or a
gloss that stayed whole vs got split) from mere reordering.

Use to validate the _split_compounds leading-run fix:
    python3 scripts/diff_split_fix.py bible.db bible_test.db

Output: for each changed verse, '-' lines = content only in the FIRST db (live),
'+' lines = content only in the SECOND db (test/fixed); then a total count.
Neither db is modified (opened read-only).
"""
import sqlite3
import sys
from collections import Counter


def load(db: str) -> dict:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    rows = conn.execute(
        "SELECT v.book, v.chapter, v.verse, w.strongs, w.english "
        "FROM words w JOIN verses v ON w.verse_id = v.id "
        "WHERE w.english IS NOT NULL AND TRIM(w.english) != ''"
    ).fetchall()
    conn.close()
    verses: dict = {}
    for book, ch, vs, strongs, eng in rows:
        verses.setdefault((book, ch, vs), Counter())[(strongs, eng)] += 1
    return verses


def fmt(items) -> list:
    out = []
    for (sn, eng), n in sorted(items, key=lambda x: (str(x[0][0]), x[0][1])):
        out.append(f"[{sn or '-'}] {eng!r}" + (f" x{n}" if n > 1 else ""))
    return out


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    live = load(sys.argv[1])
    test = load(sys.argv[2])
    keys = sorted(set(live) | set(test))
    changed = 0
    for k in keys:
        ca, cb = live.get(k, Counter()), test.get(k, Counter())
        if ca == cb:
            continue
        changed += 1
        book, ch, vs = k
        print(f"{book} {ch}:{vs}")
        for line in fmt((ca - cb).items()):
            print(f"   - {line}")
        for line in fmt((cb - ca).items()):
            print(f"   + {line}")
    print(f"\n=== {changed} verse(s) changed (of {len(keys)} verses) ===")


if __name__ == "__main__":
    main()
