#!/usr/bin/env python3
"""
fix_orphan_greek_pos.py — null greek_pos on NON-bracket words.

greek_pos is an ABP reorder number meaningful only WITHIN a bracket group. The
rebuild let some non-bracket words inherit a BH-scrape greek_pos (orphaned). That
number does nothing in Prose (it only reorders bracket words) or Library Chip, but
the Search/Corpus view renders it as a stray superscript. Null it. greek_pos only,
non-bracket words only — safe and re-runnable.

Usage:
  python3 scripts/fix_orphan_greek_pos.py bible.db --dry-run
  python3 scripts/fix_orphan_greek_pos.py bible.db
"""
import sqlite3
import sys

DB  = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv

conn = sqlite3.connect(DB)
n = conn.execute(
    "SELECT count(*) FROM words WHERE bracket_id IS NULL AND greek_pos IS NOT NULL"
).fetchone()[0]
print(f"{'[DRY RUN] ' if DRY else ''}orphan greek_pos (non-bracket words): {n}")

if not DRY:
    conn.execute("UPDATE words SET greek_pos=NULL WHERE bracket_id IS NULL AND greek_pos IS NOT NULL")
    conn.commit()
    print(f"  nulled {n}.")
else:
    print("[DRY RUN] no changes written.")
conn.close()
