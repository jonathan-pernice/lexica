#!/usr/bin/env python3
"""
fix_bracket_gaps.py — Find bracket groups with greek_pos gaps and patch from bh_scrape.db

Usage:
  python3 scripts/fix_bracket_gaps.py bible.db bh_scrape.db --dry-run
  python3 scripts/fix_bracket_gaps.py bible.db bh_scrape.db
"""

import sys
import sqlite3

DB      = "bible.db"
BH_DB   = "bh_scrape.db"
DRY_RUN = "--dry-run" in sys.argv

args = [a for a in sys.argv[1:] if not a.startswith("--")]
if len(args) >= 1: DB     = args[0]
if len(args) >= 2: BH_DB  = args[1]

print(f"{'[DRY RUN] ' if DRY_RUN else ''}fix_bracket_gaps.py")
print(f"  bible.db  : {DB}")
print(f"  bh_scrape : {BH_DB}\n")

main_conn = sqlite3.connect(DB)
main_conn.row_factory = sqlite3.Row
bh_conn   = sqlite3.connect(BH_DB)
bh_conn.row_factory = sqlite3.Row

# ── Step 1: Show bh_scrape.db schema ─────────────────────────────────────────
print("=== bh_scrape.db tables ===")
tables = bh_conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
for t in tables:
    cols = bh_conn.execute(f"PRAGMA table_info({t['name']})").fetchall()
    col_names = [c['name'] for c in cols]
    cnt = bh_conn.execute(f"SELECT COUNT(*) FROM {t['name']}").fetchone()[0]
    print(f"  {t['name']} ({cnt:,} rows): {col_names}")
print()

# ── Step 2: Find gap verses ───────────────────────────────────────────────────
gap_verses = main_conn.execute("""
    WITH stats AS (
      SELECT verse_id, bracket_id,
        COUNT(*) as cnt,
        MAX(greek_pos) as max_pos
      FROM words
      WHERE bracket_id IS NOT NULL AND greek_pos IS NOT NULL
      GROUP BY verse_id, bracket_id
    )
    SELECT v.book, v.chapter, v.verse, s.bracket_id,
           s.cnt, s.max_pos, (s.max_pos - s.cnt) as gap, v.id as verse_id
    FROM stats s
    JOIN verses v ON v.id = s.verse_id
    WHERE s.max_pos != s.cnt
    ORDER BY gap DESC, v.book, v.chapter, v.verse
""").fetchall()

print(f"=== {len(gap_verses)} bracket groups with gaps ===\n")

for gv in gap_verses[:10]:  # inspect top 10
    book, ch, vs = gv['book'], gv['chapter'], gv['verse']
    bid = gv['bracket_id']
    print(f"--- {book} {ch}:{vs} bracket_id={bid} "
          f"(cnt={gv['cnt']} max_pos={gv['max_pos']} gap={gv['gap']}) ---")

    # Current words in bible.db for this verse
    cur = main_conn.execute("""
        SELECT position, english, greek_pos, strongs_base, bracket_id
        FROM words WHERE verse_id=? ORDER BY position
    """, (gv['verse_id'],)).fetchall()
    print("  Current bible.db words:")
    for w in cur:
        marker = " ← GAP?" if (w['bracket_id'] == bid and w['greek_pos'] is None and
                                any(x['bracket_id'] == bid for x in cur)) else ""
        print(f"    pos={w['position']} greek_pos={w['greek_pos']} "
              f"bracket={w['bracket_id']} strongs={w['strongs_base']} "
              f"english={w['english']!r}{marker}")
    print()
