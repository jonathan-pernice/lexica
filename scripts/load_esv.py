#!/usr/bin/env python3
"""Load the ESV reading text into esv.db — PERSONAL, owner-only.

The ESV is Crossway-copyrighted; this is for the OWNER's private study, gated to
his account by views_esv.py. esv.db is kept OUT of bible.db and OUT of git
(*.db is gitignored), and lives on PythonAnywhere only — NEVER commit it.

Source: the mdbible repo's by_book/ markdown
(https://github.com/lguenth/mdbible), one file per book named NN_Name.md, where
NN is the 1-66 book number (matches kjv_verses/bsb_verses on the same ids):

    # Genesis
    ## Chapter 1
    1. In the beginning, God created the heavens and the earth.
    2. The earth was without form and void ...

This loader reads every by_book/*.md, takes the NN_ prefix as the book id, and
fills ONE table — esv_verses(book_id, chapter, verse_num, verse_text). It never
touches any other file. Safe to re-run (INSERT OR REPLACE on the same rows).

Usage (on PA, after cloning mdbible somewhere):
    python3 scripts/load_esv.py /path/to/mdbible/by_book [esv.db]

If the db path is omitted it writes ./esv.db next to where you run it — point it
at ~/bible-db/esv.db so the web app finds it (core.ESV_DB).
"""
import os
import re
import sqlite3
import sys

_FNAME_RE = re.compile(r"^(\d{1,2})[_\-]")              # "01_Genesis.md" -> 01
_CHAP_RE  = re.compile(r"^#{1,3}\s*Chapter\s+(\d+)", re.IGNORECASE)
_VERSE_RE = re.compile(r"^(\d+)\.\s+(.*\S)\s*$")        # "1. In the beginning..."


def load_file(path):
    """Yield (chapter, verse, text) from one by_book markdown file."""
    chapter = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            m = _CHAP_RE.match(line)
            if m:
                chapter = int(m.group(1))
                continue
            m = _VERSE_RE.match(line)
            if m and chapter is not None:
                yield chapter, int(m.group(1)), m.group(2).strip()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src_dir = sys.argv[1]
    db_path = sys.argv[2] if len(sys.argv) > 2 else "esv.db"

    files = sorted(
        fn for fn in os.listdir(src_dir)
        if fn.lower().endswith(".md") and _FNAME_RE.match(fn)
    )
    if not files:
        print(f"No NN_Name.md files found in {src_dir}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS esv_verses (
            book_id    INTEGER NOT NULL,
            chapter    INTEGER NOT NULL,
            verse_num  INTEGER NOT NULL,
            verse_text TEXT,
            PRIMARY KEY (book_id, chapter, verse_num)
        )
        """
    )

    inserted = 0
    for fn in files:
        book_id = int(_FNAME_RE.match(fn).group(1))
        if not (1 <= book_id <= 66):
            print(f"  skip {fn}: book number {book_id} out of 1-66")
            continue
        n = 0
        for chap, vs, text in load_file(os.path.join(src_dir, fn)):
            conn.execute(
                "INSERT OR REPLACE INTO esv_verses (book_id, chapter, verse_num, verse_text)"
                " VALUES (?, ?, ?, ?)",
                (book_id, chap, vs, text),
            )
            n += 1
        inserted += n
        print(f"  {fn}: book {book_id}, {n} verses")

    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM esv_verses").fetchone()[0]
    books = conn.execute("SELECT COUNT(DISTINCT book_id) FROM esv_verses").fetchone()[0]
    conn.close()
    print(f"\nESV verses loaded: {inserted}  (table now holds {total} across {books} books)")


if __name__ == "__main__":
    main()
