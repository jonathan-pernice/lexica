#!/usr/bin/env python3
"""
Migrate bible.db to apply the G* proper noun parse fix.

Re-parses all ABP text files and updates only the changed english/english_head
values in the words table. Does NOT insert or delete rows — safe to run on
the live DB.

Changes made:
  1. "Abel becameG1096 G*" → G1096 gets english="became", G* gets english="Abel"
  2. "to PhilemonG*" → G* gets english="Philemon" (leading stop words stripped)
  3. "of JesusG*" → G* gets english="Jesus"

Usage:
    python migrate_pn_fix.py [bible.db] [abp_nt_texts/] [abp_ot_texts/]
"""

import re
import sqlite3
import sys
from pathlib import Path

DB       = sys.argv[1] if len(sys.argv) > 1 else "/home/appssanding720/bible-db/bible.db"
NT_DIR   = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/home/appssanding720/bible-db/abp_nt_texts/abp_nt_texts")
OT_DIR   = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("/home/appssanding720/bible-db/abp_ot_texts/abp_ot_texts")

# ── Re-use parse_abp logic ────────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
from parse_abp import parse_text, _head_word


def migrate(db_path: str, text_dirs: list[Path]) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    total_checked = 0
    total_updated = 0

    for text_dir in text_dirs:
        txt_files = sorted(text_dir.glob("*.txt"))
        print(f"Processing {len(txt_files)} files from {text_dir.name}…")

        for f in txt_files:
            text = f.read_text(encoding="utf-8", errors="replace")
            parsed = parse_text(text)

            for book, chapter, verse, words in parsed:
                # Get verse_id
                row = conn.execute(
                    "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                    (book, chapter, verse),
                ).fetchone()
                if not row:
                    continue
                verse_id = row["id"]

                # Get existing words for this verse
                existing = {
                    r["position"]: r
                    for r in conn.execute(
                        "SELECT id, position, english, english_head, strongs FROM words WHERE verse_id=? ORDER BY position",
                        (verse_id,),
                    ).fetchall()
                }

                for pos, new_eng, strongs, gpos, bid in words:
                    total_checked += 1
                    if pos not in existing:
                        continue

                    old_row = existing[pos]
                    old_eng = old_row["english"]
                    new_head = _head_word(new_eng) if new_eng else None

                    # Only update if something changed
                    if old_eng != new_eng:
                        conn.execute(
                            "UPDATE words SET english=?, english_head=? WHERE id=?",
                            (new_eng, new_head, old_row["id"]),
                        )
                        total_updated += 1

    conn.commit()
    conn.close()
    print(f"\nChecked {total_checked:,} word positions")
    print(f"Updated {total_updated:,} rows")
    print("Done.")


if __name__ == "__main__":
    print(f"Database: {DB}")
    migrate(DB, [d for d in [NT_DIR, OT_DIR] if d.exists()])
