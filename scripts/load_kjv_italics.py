#!/usr/bin/env python3
"""
Download KJV OSIS XML and update kjv_words.italic column.

Source: https://github.com/scrollmapper/bible_databases (OSIS format)
Uses the eBible.org KJV USFM source which marks added words with \\add tags.

Usage:
    python load_kjv_italics.py [bible.db]
"""

import re
import sqlite3
import sys
import zipfile
import io

DB = sys.argv[1] if len(sys.argv) > 1 else "/home/appssanding720/bible-db/bible.db"
ZIP_PATH = sys.argv[2] if len(sys.argv) > 2 else "/home/appssanding720/bible-db/eng-kjv2006_usfm.zip"

BOOK_MAP = {
    "GEN": "Gen", "EXO": "Exo", "LEV": "Lev", "NUM": "Num", "DEU": "Deu",
    "JOS": "Jos", "JDG": "Jdg", "RUT": "Rth", "1SA": "1Sa", "2SA": "2Sa",
    "1KI": "1Ki", "2KI": "2Ki", "1CH": "1Ch", "2CH": "2Ch", "EZR": "Ezr",
    "NEH": "Neh", "EST": "Est", "JOB": "Job", "PSA": "Psa", "PRO": "Pro",
    "ECC": "Ecc", "SNG": "Son", "ISA": "Isa", "JER": "Jer", "LAM": "Lam",
    "EZK": "Eze", "DAN": "Dan", "HOS": "Hos", "JOL": "Joe", "AMO": "Amo",
    "OBA": "Oba", "JON": "Jon", "MIC": "Mic", "NAM": "Nah", "HAB": "Hab",
    "ZEP": "Zep", "HAG": "Hag", "ZEC": "Zec", "MAL": "Mal",
    "MAT": "Mat", "MRK": "Mar", "LUK": "Luk", "JHN": "Joh", "ACT": "Act",
    "ROM": "Rom", "1CO": "1Co", "2CO": "2Co", "GAL": "Gal", "EPH": "Eph",
    "PHP": "Php", "COL": "Col", "1TH": "1Th", "2TH": "2Th", "1TI": "1Ti",
    "2TI": "2Ti", "TIT": "Tit", "PHM": "Phm", "HEB": "Heb", "JAS": "Jas",
    "1PE": "1Pe", "2PE": "2Pe", "1JN": "1Jn", "2JN": "2Jn", "3JN": "3Jn",
    "JUD": "Jud", "REV": "Rev",
}

def tokenize(text):
    """Split text into (word, is_italic) pairs."""
    tokens = []
    # Split on \add ... \add* markers
    parts = re.split(r'(\\add\s+.*?\\add\*)', text)
    for part in parts:
        m = re.match(r'\\add\s+(.*?)\\add\*', part)
        if m:
            words = m.group(1).split()
            for w in words:
                w = re.sub(r'[^\w]', '', w).strip()
                if w:
                    tokens.append((w.lower(), True))
        else:
            words = part.split()
            for w in words:
                w = re.sub(r'[^\w]', '', w).strip()
                if w:
                    tokens.append((w.lower(), False))
    return tokens


def parse_usfm(text, book_abbrev):
    """Parse a USFM file and return {(chapter, verse): [is_italic per word position]}."""
    results = {}
    chapter = None
    verse = None

    for line in text.splitlines():
        line = line.strip()
        m = re.match(r'\\c\s+(\d+)', line)
        if m:
            chapter = int(m.group(1))
            continue
        m = re.match(r'\\v\s+(\d+)\s*(.*)', line)
        if m:
            verse = int(m.group(1))
            rest = m.group(2)
            tokens = tokenize(rest)
            if tokens:
                results[(chapter, verse)] = [italic for _, italic in tokens]
            continue
        # continuation lines
        if chapter and verse and line and not line.startswith('\\'):
            tokens = tokenize(line)
            if tokens and (chapter, verse) in results:
                results[(chapter, verse)].extend(italic for _, italic in tokens)

    return results


def main():
    print(f"Reading {ZIP_PATH}…")
    with open(ZIP_PATH, "rb") as f:
        data = f.read()
    print(f"Read {len(data) / 1_048_576:.1f} MB — parsing USFM…")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    # Ensure italic column exists
    try:
        conn.execute("ALTER TABLE kjv_words ADD COLUMN italic INTEGER DEFAULT 0")
        conn.commit()
        print("Added italic column")
    except sqlite3.OperationalError:
        pass  # already exists

    total_updated = 0

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        usfm_files = [f for f in zf.namelist() if f.endswith('.usfm') or f.endswith('.SFM') or f.endswith('.sfm')]
        print(f"Found {len(usfm_files)} USFM files")

        for fname in sorted(usfm_files):
            # Extract book code from filename e.g. 01GENeng-kjv.usfm
            bm = re.search(r'([A-Z1-3]{3})', fname.upper())
            if not bm:
                continue
            usfm_code = bm.group(1)
            book_abbrev = BOOK_MAP.get(usfm_code)
            if not book_abbrev:
                continue

            text = zf.read(fname).decode('utf-8', errors='replace')
            verse_data = parse_usfm(text, book_abbrev)

            # Get book_id
            book_id_row = conn.execute(
                "SELECT id FROM books WHERE abbrev = ?", (book_abbrev,)
            ).fetchone()
            if not book_id_row:
                continue
            book_id = book_id_row["id"] + 1  # books.id is 0-indexed sort_order; kjv uses 1-indexed book_id

            # Actually look up book_id from kjv_words directly
            sample = conn.execute(
                "SELECT DISTINCT book_id FROM kjv_words WHERE book_id IN (SELECT id+1 FROM books WHERE abbrev=?) LIMIT 1",
                (book_abbrev,)
            ).fetchone()

            # Find the actual book_id used in kjv_words for this book
            # kjv_words.book_id corresponds to books table position
            brow = conn.execute(
                "SELECT sort_order FROM books WHERE abbrev=?", (book_abbrev,)
            ).fetchone()
            if not brow:
                continue
            kjv_book_id = brow["sort_order"] + 1  # 1-indexed

            updated = 0
            for (chapter, verse), italics in verse_data.items():
                words = conn.execute(
                    """SELECT word_id, word FROM kjv_words
                       WHERE book_id=? AND chapter=? AND verse_num=?
                       ORDER BY verse_pos""",
                    (kjv_book_id, chapter, verse)
                ).fetchall()

                for i, w in enumerate(words):
                    if i < len(italics) and italics[i]:
                        conn.execute(
                            "UPDATE kjv_words SET italic=1 WHERE word_id=?",
                            (w["word_id"],)
                        )
                        updated += 1

            if updated:
                print(f"  {book_abbrev}: {updated} italic words")
                total_updated += updated

    conn.commit()
    conn.close()
    print(f"\nDone — {total_updated:,} italic words marked in kjv_words")


if __name__ == "__main__":
    main()
