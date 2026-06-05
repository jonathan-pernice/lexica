#!/usr/bin/env python3
"""
dump_review_verses.py — READ-ONLY full-word dump for the synthetic-reorder
review set, so a fix can be designed against the WHOLE clause (objects,
neighbouring slots) and not just the 2-word bracket.

Shows every word of each verse in position order: position, greek_pos,
bracket_id, strongs_base, english. Brackets are marked so the synthetic group
is visible in its surroundings.

READ-ONLY (mode=ro). Never writes.

Usage:
  python3 scripts/dump_review_verses.py bible.db
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")

REFS = [
    ("1Pe", 5, 10), ("Mar", 1, 45), ("Joh", 4, 51), ("Jer", 10, 16),
    ("Dan", 2, 47), ("Psa", 79, 13), ("Eze", 11, 3), ("Job", 35, 13),
]

conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

for book, ch, vs in REFS:
    row = conn.execute(
        "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
        (book, ch, vs),
    ).fetchone()
    print(f"\n=== {book} {ch}:{vs} ===")
    if not row:
        print("  (verse not found)")
        continue
    words = conn.execute(
        """SELECT position, greek_pos, bracket_id, strongs_base, english, is_pn, morph
           FROM words WHERE verse_id=? ORDER BY position""",
        (row["id"],),
    ).fetchall()
    for w in words:
        bid = w["bracket_id"]
        mark = f"  [bid {bid}]" if bid is not None else ""
        morph = (w["morph"] or "")
        print(f"  pos {w['position']:>3}  gp={str(w['greek_pos']):>4}  "
              f"{(w['strongs_base'] or ''):<8} {(w['english'] or '')!r:<28}"
              f"{mark}{('  morph='+morph) if morph else ''}")

conn.close()
