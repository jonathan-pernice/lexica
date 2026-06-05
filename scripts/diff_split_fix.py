#!/usr/bin/env python3
"""Position-INDEPENDENT diff of two bible.db builds (READ-ONLY).

Compares, per verse, the multiset of (strongs, english) over non-empty-english
word slots -- IGNORING position. _split_compounds changes shift word positions,
so a per-position diff inflates one real change into many spurious shuffles
(attempt 1's bogus "11,036 verses"). Keying on the content multiset isolates
genuine english redistribution (a word moved to a different Strong's slot, or a
gloss that stayed whole vs got split) from mere reordering.

Each changed verse is tagged [BRK] if any of the *changed* Strong's slots sits
in a bracket (in either db), else [non-brk]. This matters because bracketed
slots render in abp_pos order (via _sort_brackets) so the old fronting swap is
invisible there -- the visible garble the leading-run fix targets lives in the
NON-bracketed slots. A final summary breaks the count down by tag.

Use to validate the _split_compounds leading-run fix:
    python3 scripts/diff_split_fix.py bible.db bible_test.db

Output: for each changed verse, '-' lines = content only in the FIRST db (live),
'+' lines = content only in the SECOND db (test/fixed); then the breakdown.
Neither db is modified (opened read-only).
"""
import sqlite3
import sys
from collections import Counter


def load(db: str):
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    rows = conn.execute(
        "SELECT v.book, v.chapter, v.verse, w.strongs, w.english, w.bracket_id "
        "FROM words w JOIN verses v ON w.verse_id = v.id"
    ).fetchall()
    conn.close()
    content: dict = {}   # verse -> Counter of (strongs, eng) over non-empty english
    bracketed: dict = {} # verse -> set of strongs that occupy a bracketed slot
    for book, ch, vs, strongs, eng, bid in rows:
        key = (book, ch, vs)
        if eng and eng.strip():
            content.setdefault(key, Counter())[(strongs, eng)] += 1
        if bid is not None:
            bracketed.setdefault(key, set()).add(strongs)
    return content, bracketed


def fmt(items) -> list:
    out = []
    for (sn, eng), n in sorted(items, key=lambda x: (str(x[0][0]), x[0][1])):
        out.append(f"[{sn or '-'}] {eng!r}" + (f" x{n}" if n > 1 else ""))
    return out


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    live, live_brk = load(sys.argv[1])
    test, test_brk = load(sys.argv[2])
    keys = sorted(set(live) | set(test))
    changed = brk_verses = 0
    for k in keys:
        ca, cb = live.get(k, Counter()), test.get(k, Counter())
        if ca == cb:
            continue
        changed += 1
        # Strong's slots whose content actually changed in this verse
        changed_strongs = {s for (s, _e) in (ca - cb)} | {s for (s, _e) in (cb - ca)}
        brk = (live_brk.get(k, set()) | test_brk.get(k, set())) & changed_strongs
        tag = "[BRK]" if brk else "[non-brk]"
        if brk:
            brk_verses += 1
        book, ch, vs = k
        print(f"{book} {ch}:{vs}  {tag}")
        for line in fmt((ca - cb).items()):
            print(f"   - {line}")
        for line in fmt((cb - ca).items()):
            print(f"   + {line}")
    print(f"\n=== {changed} verse(s) changed (of {len(keys)} verses) ===")
    print(f"=== {brk_verses} involve a bracketed changed slot [BRK]; "
          f"{changed - brk_verses} are purely NON-bracketed [non-brk] ===")


if __name__ == "__main__":
    main()
