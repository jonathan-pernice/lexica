#!/usr/bin/env python3
"""
Parse ABP text files and populate verses.text with clean English prose.

Handles:
- Bracket reordering: [2wordG#### 1wordG####] → sorted by number
- G-number stripping: wordG4151 → word
- Cleanup of whitespace and stray markers

Usage:
    python scripts/load_abp_prose.py [bible.db]
"""

import re
import sqlite3
import sys
from pathlib import Path

ABP_DIRS = [
    Path("abp_texts/abp_nt_texts"),
    Path("abp_texts/abp_ot_texts"),
]

VERSE_RE = re.compile(r'^\((\w+)\s+(\d+):(\d+)\)\s+(.*)')
G_NUM_RE = re.compile(r'G(?:[\d]+[\d.]*\*?|\*)')


def reorder_bracket(m):
    content = m.group(1).strip()
    # Split on whitespace followed by a digit (start of new numbered item)
    items = re.split(r'\s+(?=\d)', content)
    parsed = []
    for item in items:
        nm = re.match(r'^(\d+)(.*)', item.strip())
        if nm:
            pos = int(nm.group(1))
            word = G_NUM_RE.sub('', nm.group(2)).strip()
            if word:
                parsed.append((pos, word))
    if parsed:
        parsed.sort(key=lambda x: x[0])
        return ' '.join(w for _, w in parsed)
    # Fallback: strip G-numbers and return
    return G_NUM_RE.sub('', content).strip()


def clean_verse(raw):
    # Handle bracketed groups with reordering (with or without closing G-number)
    text = re.sub(r'\[([^\]]+)\](?:G[\d.]+\*?)?', reorder_bracket, raw)
    # Strip remaining G-numbers
    text = G_NUM_RE.sub('', text)
    # Clean whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def parse_file(path):
    """Yield (book, chapter, verse, clean_text) for each verse in file."""
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            m = VERSE_RE.match(line)
            if not m:
                continue
            book, chapter, verse, raw = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
            yield book, chapter, verse, clean_verse(raw)


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else "bible.db"
    if not Path(db_path).exists():
        print(f"Error: {db_path} not found.", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)

    # Add text column if missing
    cols = [r[1] for r in conn.execute("PRAGMA table_info(verses)").fetchall()]
    if 'text' not in cols:
        conn.execute("ALTER TABLE verses ADD COLUMN text TEXT")
        conn.commit()
        print("Added verses.text column.")

    total = 0
    for d in ABP_DIRS:
        if not d.exists():
            print(f"Warning: {d} not found, skipping.", file=sys.stderr)
            continue
        for txt_file in sorted(d.glob("*.txt")):
            count = 0
            for book, chapter, verse, text in parse_file(txt_file):
                conn.execute(
                    "UPDATE verses SET text = ? WHERE book = ? AND chapter = ? AND verse = ?",
                    (text, book, chapter, verse)
                )
                count += 1
            total += count
            print(f"  {txt_file.name}: {count} verses")

    conn.commit()
    conn.close()
    print(f"\nDone. {total} verses updated.")


if __name__ == "__main__":
    main()
