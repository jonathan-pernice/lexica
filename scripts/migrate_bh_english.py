#!/usr/bin/env python3
"""
migrate_bh_english.py

Patches words.english and words.english_head from bh_scrape.db.

The original ABP text files sometimes attach multi-word phrases to a single
Strong's token (e.g. "God madeG4160" stores english="God made" on G4160 while
G2316 gets NULL).  BibleHub has individual per-word glosses.  This script
replaces the ABP english fields with BH's cleaner individual glosses wherever
BH has a non-empty english value.

Proper nouns (strongs=NULL in BH) are left unchanged — the ABP name extraction
already handles them correctly.

Run on PythonAnywhere after migrate_bh_words.py has already run:
    python scripts/migrate_bh_english.py [bible.db] [bh_scrape.db]

Safe to re-run (idempotent).
"""

import sys
import sqlite3
from pathlib import Path

# Import _head_word from parse_abp (same scripts/ dir)
sys.path.insert(0, str(Path(__file__).parent))
from parse_abp import _head_word

SLUG_TO_ABBREV = {
    "genesis": "Gen", "exodus": "Exo", "leviticus": "Lev", "numbers": "Num",
    "deuteronomy": "Deu", "joshua": "Jos", "judges": "Jdg", "ruth": "Rth",
    "1_samuel": "1Sa", "2_samuel": "2Sa", "1_kings": "1Ki", "2_kings": "2Ki",
    "1_chronicles": "1Ch", "2_chronicles": "2Ch", "ezra": "Ezr", "nehemiah": "Neh",
    "esther": "Est", "job": "Job", "psalms": "Psa", "proverbs": "Pro",
    "ecclesiastes": "Ecc", "songs": "Son", "isaiah": "Isa",
    "jeremiah": "Jer", "lamentations": "Lam", "ezekiel": "Eze", "daniel": "Dan",
    "hosea": "Hos", "joel": "Joe", "amos": "Amo", "obadiah": "Oba",
    "jonah": "Jon", "micah": "Mic", "nahum": "Nah", "habakkuk": "Hab",
    "zephaniah": "Zep", "haggai": "Hag", "zechariah": "Zec", "malachi": "Mal",
    "matthew": "Mat", "mark": "Mar", "luke": "Luk", "john": "Joh",
    "acts": "Act", "romans": "Rom", "1_corinthians": "1Co", "2_corinthians": "2Co",
    "galatians": "Gal", "ephesians": "Eph", "philippians": "Php", "colossians": "Col",
    "1_thessalonians": "1Th", "2_thessalonians": "2Th", "1_timothy": "1Ti",
    "2_timothy": "2Ti", "titus": "Tit", "philemon": "Phm", "hebrews": "Heb",
    "james": "Jas", "1_peter": "1Pe", "2_peter": "2Pe", "1_john": "1Jn",
    "2_john": "2Jn", "3_john": "3Jn", "jude": "Jud", "revelation": "Rev",
}


def _find_compound_dash(s: str) -> int:
    for i, ch in enumerate(s):
        if ch == "-" and i + 1 < len(s) and s[i + 1].isdigit():
            return i
    return -1


def expand_strongs(bh_strongs: str | None) -> list[str | None]:
    if bh_strongs is None:
        return [None]
    parts = []
    current = bh_strongs
    while True:
        idx = _find_compound_dash(current)
        if idx == -1:
            parts.append(current)
            break
        parts.append(current[:idx])
        current = current[idx + 1:]
    return parts


def align_verse(bh_rows, db_rows):
    """
    Returns list of (word_id, bh_english) pairs, or None on mismatch.
    bh_english is None for PNs, compound i>0 slots, or when BH has no gloss.
    """
    result = []
    db_idx = 0
    for bh_strongs, bh_english in bh_rows:
        if bh_strongs is None:
            # Proper noun — match one DB row, no english update
            if db_idx >= len(db_rows):
                return None
            result.append((db_rows[db_idx][0], None))
            db_idx += 1
        else:
            components = expand_strongs(bh_strongs)
            if db_idx + len(components) > len(db_rows):
                return None
            for i, _ in enumerate(components):
                # Only the first component of a compound gets the BH english
                eng = bh_english if i == 0 else None
                result.append((db_rows[db_idx + i][0], eng))
            db_idx += len(components)

    if db_idx != len(db_rows):
        return None
    return result


def run(bible_db: str, scrape_db: str) -> None:
    main   = sqlite3.connect(bible_db)
    scrape = sqlite3.connect(scrape_db)

    bh_verses = scrape.execute(
        "SELECT DISTINCT book, chapter, verse FROM bh_words ORDER BY book, chapter, verse"
    ).fetchall()
    total = len(bh_verses)
    print(f"Verses to process: {total:,}\n")

    updated = 0
    skipped_no_verse = 0
    skipped_mismatch = 0

    for bh_book, bh_chapter, bh_verse in bh_verses:
        abbrev = SLUG_TO_ABBREV.get(bh_book)
        if not abbrev:
            skipped_no_verse += 1
            continue

        vrow = main.execute(
            "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
            (abbrev, bh_chapter, bh_verse),
        ).fetchone()
        if not vrow:
            skipped_no_verse += 1
            continue
        verse_id = vrow[0]

        bh_rows = scrape.execute(
            "SELECT strongs, english FROM bh_words"
            " WHERE book=? AND chapter=? AND verse=? ORDER BY position",
            (bh_book, bh_chapter, bh_verse),
        ).fetchall()

        db_rows = main.execute(
            "SELECT id FROM words WHERE verse_id=? ORDER BY position",
            (verse_id,),
        ).fetchall()

        pairs = align_verse(bh_rows, db_rows)
        if pairs is None:
            skipped_mismatch += 1
            continue

        for word_id, bh_english in pairs:
            if not bh_english:
                continue
            head = _head_word(bh_english)
            main.execute(
                "UPDATE words SET english=?, english_head=? WHERE id=?",
                (bh_english, head, word_id),
            )
            updated += 1

        if updated % 50000 == 0 and updated > 0:
            main.commit()
            print(f"  {updated:,} words updated …", flush=True)

    main.commit()
    main.close()
    scrape.close()

    print()
    print("── Results ──────────────────────────────────────────────────")
    print(f"  Words updated:            {updated:,}")
    print(f"  Skipped (verse not found):{skipped_no_verse:,}")
    print(f"  Skipped (row mismatch):   {skipped_mismatch:,}")


def main():
    bible_db  = sys.argv[1] if len(sys.argv) > 1 else "bible.db"
    scrape_db = sys.argv[2] if len(sys.argv) > 2 else "bh_scrape.db"

    for path in (bible_db, scrape_db):
        if not Path(path).exists():
            print(f"ERROR: {path} not found.")
            sys.exit(1)

    print(f"bible.db:  {bible_db}")
    print(f"scrape db: {scrape_db}")
    print()
    run(bible_db, scrape_db)


if __name__ == "__main__":
    main()
