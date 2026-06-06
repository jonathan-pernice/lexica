#!/usr/bin/env python3
"""
fix_hab314_dupes.py — clear the Hab 3:14 double-insert RESIDUAL.

Hab 3:14 was the ONLY verse the ABP source duplicated (two byte-identical
'(Hab 3:14)' lines in abp_texts/abp_ot_texts/abp_habakkuk.txt). The build had no
per-verse-key dedup, so every rebuild inserted the verse twice. `dedup_words.py`
removes only byte-IDENTICAL rows; the second-pass BRACKET rows differ from the
first pass in `bracket_id` only, so they survived dedup — leaving a doubled
"of mighty ones" (G1413) chip plus the lone health_check warnings
(misalignment:1, fragmented:1) and the audit_bracket_order WORDSET hit.

The SOURCE is now fixed (duplicate line removed), so future rebuilds insert the
verse once. This script cleans the EXISTING live DB without a full rebuild: for
Hab 3:14 only, it collapses any duplicate (verse_id, position) rows down to the
lowest id (the first pass = correct bracket numbering).

SAFETY: scoped to Hab 3:14's verse_id ONLY. Never a blanket DELETE FROM words.
Copy-first and run --dry-run before applying.

Usage:
  python3 scripts/fix_hab314_dupes.py bible.db --dry-run
  python3 scripts/fix_hab314_dupes.py bible.db
"""
import sqlite3
import sys

DB  = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

vid_row = conn.execute(
    "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
    ("Hab", 3, 14),
).fetchone()
if not vid_row:
    sys.exit("Hab 3:14 not found in verses — aborting (nothing to do).")
vid = vid_row["id"]

# Group this verse's rows by position; any position with >1 row is a duplicate.
groups = conn.execute(
    """SELECT position, group_concat(id) ids, count(*) c
       FROM words
       WHERE verse_id = ?
       GROUP BY position
       HAVING c > 1
       ORDER BY position""",
    (vid,),
).fetchall()

to_delete = []
for g in groups:
    ids = sorted(int(x) for x in g["ids"].split(","))
    to_delete.extend(ids[1:])          # keep lowest id (first pass), drop rest

print(f"{'[DRY RUN] ' if DRY else ''}fix Hab 3:14 dupes -> {DB}")
print(f"  Hab 3:14 verse_id: {vid}")
print(f"  duplicate positions: {len(groups)}")
print(f"  rows to delete: {len(to_delete)}")
for g in groups:
    print(f"    position {g['position']}: {g['c']} rows -> keep 1")

if not DRY and to_delete:
    conn.executemany("DELETE FROM words WHERE id=?", [(i,) for i in to_delete])
    conn.commit()
    print(f"\n  deleted {len(to_delete)} residual rows.")
    remaining = conn.execute(
        """SELECT count(*) FROM (
               SELECT position FROM words WHERE verse_id=?
               GROUP BY position HAVING count(*) > 1)""",
        (vid,),
    ).fetchone()[0]
    print(f"  remaining duplicate positions (expect 0): {remaining}")
elif DRY:
    print("\n[DRY RUN] no changes written.")
conn.close()
