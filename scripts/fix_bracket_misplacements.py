#!/usr/bin/env python3
"""
fix_bracket_misplacements.py — Remove words placed in the wrong bracket

A word is "misplaced" when its greek_pos (= the bracket's max_pos) also exists
in another bracket of the same verse, inflating max_pos and creating a false gap.

Usage:
  python3 scripts/fix_bracket_misplacements.py bible.db --dry-run
  python3 scripts/fix_bracket_misplacements.py bible.db
"""

import sys
import sqlite3

DB      = "bible.db"
DRY_RUN = "--dry-run" in sys.argv
args    = [a for a in sys.argv[1:] if not a.startswith("--")]
if args: DB = args[0]

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

print(f"{'[DRY RUN] ' if DRY_RUN else ''}fix_bracket_misplacements.py → {DB}\n")

removed_total = 0
passes = 0

while True:
    # Find brackets with positive gaps where max_pos word exists in another bracket
    gaps = conn.execute("""
        WITH stats AS (
          SELECT verse_id, bracket_id,
            COUNT(*) cnt, MAX(greek_pos) max_pos
          FROM words
          WHERE bracket_id IS NOT NULL AND greek_pos IS NOT NULL
          GROUP BY verse_id, bracket_id
        )
        SELECT v.book, v.chapter, v.verse, s.bracket_id,
               s.cnt, s.max_pos, (s.max_pos - s.cnt) as gap, v.id as verse_id
        FROM stats s
        JOIN verses v ON v.id = s.verse_id
        WHERE s.max_pos > s.cnt
        AND EXISTS (
          SELECT 1 FROM words w2
          WHERE w2.verse_id = s.verse_id
          AND w2.bracket_id != s.bracket_id
          AND w2.bracket_id IS NOT NULL
          AND w2.greek_pos = s.max_pos
        )
        ORDER BY gap DESC
    """).fetchall()

    if not gaps:
        break

    passes += 1
    removed_this_pass = 0

    for g in gaps:
        book, ch, vs = g['book'], g['chapter'], g['verse']
        bid  = g['bracket_id']
        vid  = g['verse_id']
        max_pos = g['max_pos']

        # Find the misplaced word (with greek_pos = max_pos in this bracket)
        word = conn.execute("""
            SELECT rowid AS wid, position, english, greek_pos, strongs_base
            FROM words WHERE verse_id=? AND bracket_id=? AND greek_pos=?
            LIMIT 1
        """, (vid, bid, max_pos)).fetchone()
        if not word:
            continue

        # Confirm it also lives in another bracket with the SAME strongs_base
        # (different english at same gpos = legitimate parallel bracket, not duplicate)
        other = conn.execute("""
            SELECT bracket_id, english FROM words
            WHERE verse_id=? AND bracket_id!=? AND greek_pos=?
              AND bracket_id IS NOT NULL
              AND strongs_base = ?
            LIMIT 1
        """, (vid, bid, max_pos, word['strongs_base'])).fetchone()
        if not other:
            continue

        print(f"  {book} {ch}:{vs} bid={bid}: remove gpos={max_pos} "
              f"'{word['english']}' ({word['strongs_base']}) "
              f"[duplicate of bid={other['bracket_id']}]")

        if not DRY_RUN:
            conn.execute("DELETE FROM words WHERE rowid=?", (word['wid'],))

        removed_this_pass += 1

    removed_total += removed_this_pass

    if DRY_RUN:
        break  # single pass in dry-run (no changes to re-evaluate)
    if removed_this_pass == 0:
        break  # nothing left to fix

if not DRY_RUN:
    conn.commit()

print(f"\nPasses  : {passes}")
print(f"{'Would remove' if DRY_RUN else 'Removed'}: {removed_total} misplaced words")
if DRY_RUN:
    print("[DRY RUN] No changes written.")

conn.close()
