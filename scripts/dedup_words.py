#!/usr/bin/env python3
"""
dedup_words.py — remove EXACT-duplicate word rows.

Some verses (found: Hab 3:14) have words inserted twice — fully identical
(verse_id, position, strongs_base, english, greek_pos, bracket_id) rows. This
keeps the lowest id of each identical group and deletes the rest.

SAFETY: only deletes rows that are byte-for-byte identical to a kept sibling, by
id. It never does a blanket `DELETE FROM words`. Back up first anyway (it's a
DELETE) and run --dry-run before applying.

Usage:
  python3 scripts/dedup_words.py bible.db --dry-run
  python3 scripts/dedup_words.py bible.db
"""
import sqlite3
import sys

DB  = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

rows = conn.execute(
    """SELECT verse_id, position,
              COALESCE(strongs_base,'') sb, COALESCE(english,'') en,
              COALESCE(greek_pos,-1) gp, COALESCE(bracket_id,-1) bid,
              group_concat(id) ids, count(*) c
       FROM words
       GROUP BY verse_id, position,
                COALESCE(strongs_base,''), COALESCE(english,''),
                COALESCE(greek_pos,-1), COALESCE(bracket_id,-1)
       HAVING c > 1"""
).fetchall()

to_delete = []
for r in rows:
    ids = sorted(int(x) for x in r["ids"].split(","))
    to_delete.extend(ids[1:])          # keep the lowest id, drop the rest

print(f"{'[DRY RUN] ' if DRY else ''}dedup words -> {DB}")
print(f"  identical-row groups: {len(rows)}")
print(f"  rows to delete: {len(to_delete)}\n")

by_verse = {}
for r in rows:
    by_verse.setdefault(r["verse_id"], 0)
    by_verse[r["verse_id"]] += len(r["ids"].split(",")) - 1
for vid, n in by_verse.items():
    ref = conn.execute("SELECT book,chapter,verse FROM verses WHERE id=?", (vid,)).fetchone()
    print(f"  {ref['book']} {ref['chapter']}:{ref['verse']}: -{n} rows")

if not DRY and to_delete:
    conn.executemany("DELETE FROM words WHERE id=?", [(i,) for i in to_delete])
    conn.commit()
    print(f"\n  deleted {len(to_delete)} duplicate rows.")
elif DRY:
    print("\n[DRY RUN] no changes written.")
conn.close()
