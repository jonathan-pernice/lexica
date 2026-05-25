#!/usr/bin/env python3
"""
Add greek_pos and bracket_id columns to the words table by re-parsing ABP source files.

Usage: python migrate_bracket_data.py [bible.db] [abp_texts/]
"""

import re
import sqlite3
import sys
from pathlib import Path

DB      = sys.argv[1] if len(sys.argv) > 1 else "bible.db"
ABP_DIR = sys.argv[2] if len(sys.argv) > 2 else "abp_texts"

# ── Re-use parsing logic from parse_abp ──────────────────────────────────────
STRONGS_RE = re.compile(r'G([\d]+(?:\.[\d]+)*|\*)')
VERSE_RE   = re.compile(
    r'\((\S+)\s+(\d+):(\d+)\)\s*(.*?)(?=\s*\(\S+\s+\d+:\d+\)|$)',
    re.DOTALL,
)
_LEADING_POS = re.compile(r'^(\d+)\s*')


def parse_words(verse_text: str) -> list:
    words = []
    last_end  = 0
    in_bracket = False
    bracket_id = -1

    for seq, m in enumerate(STRONGS_RE.finditer(verse_text)):
        raw = verse_text[last_end : m.start()]
        last_end = m.end()

        has_open  = '[' in raw
        has_close = ']' in raw

        if has_open:
            in_bracket = True
            bracket_id += 1

        cur_bracket_id = bracket_id if in_bracket else None
        greek_pos = None

        if in_bracket:
            segment = raw[raw.index('[') + 1:] if has_open else raw
            segment = re.sub(r'\].*$', '', segment).strip()
            pm = _LEADING_POS.match(segment)
            if pm:
                greek_pos = int(pm.group(1))

        if has_close:
            in_bracket = False

        words.append((seq, m.group(1), greek_pos, cur_bracket_id))

    return words


def parse_text(text: str) -> list:
    results = []
    for m in VERSE_RE.finditer(text):
        words = parse_words(m.group(4).strip())
        if words:
            results.append((m.group(1), int(m.group(2)), int(m.group(3)), words))
    return results


# ── Migrate DB ────────────────────────────────────────────────────────────────
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

for col_def in ["greek_pos INTEGER", "bracket_id INTEGER"]:
    col_name = col_def.split()[0]
    try:
        conn.execute(f"ALTER TABLE words ADD COLUMN {col_def}")
        print(f"  Added column: {col_name}")
    except sqlite3.OperationalError:
        print(f"  Column already exists: {col_name}")

conn.commit()

# Read ABP text files
abp_path = Path(ABP_DIR)
files = sorted(abp_path.glob("*.txt"))
print(f"\nParsing {len(files)} ABP text files from '{ABP_DIR}/'…")
all_text = "\n".join(f.read_text(encoding="utf-8") for f in files)

parsed = parse_text(all_text)
print(f"  Found {len(parsed)} verses")

# Update DB
c = conn.cursor()
updated = skipped = 0
for book, chapter, verse, words in parsed:
    row = conn.execute(
        "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
        (book, chapter, verse),
    ).fetchone()
    if not row:
        skipped += 1
        continue
    verse_id = row["id"]
    for seq, strongs, greek_pos, bracket_id in words:
        c.execute(
            "UPDATE words SET greek_pos=?, bracket_id=? WHERE verse_id=? AND position=?",
            (greek_pos, bracket_id, verse_id, seq),
        )
        updated += 1

conn.commit()
conn.close()

print(f"  Updated {updated:,} word rows, skipped {skipped} missing verses")
print("Done.")
