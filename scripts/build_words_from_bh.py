#!/usr/bin/env python3
"""
build_words_from_bh.py

Rebuilds the words table in bible.db entirely from bh_scrape.db.

Requires bh_scrape.db produced by the UPDATED scraper (which captures
greek_pos and uses the last-word italic heuristic). The original
bh_scrape.db from the first migration does NOT have greek_pos — re-scrape
first, then run this.

What this fixes over the incremental migration approach:
  - Compound english glosses ("God made" on one strongs) → individual glosses
  - Italic bleed from leading articles ("the beginning" both italic)
  - greek_pos / bracket_id correct for every word (fresh derivation)
  - 3,057 formerly-skipped verses (1 Chr genealogies) now rebuild correctly

CAUTION: DELETEs all rows from words. Back up bible.db first:
    cp bible.db bible.db.bak

Run on PythonAnywhere:
    python scripts/build_words_from_bh.py [bible.db] [bh_scrape.db]
"""

import sys
import sqlite3
from pathlib import Path

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


# ── Compound strongs handling ──────────────────────────────────────────────────

def _find_compound_dash(s: str) -> int:
    for i, ch in enumerate(s):
        if ch == "-" and i + 1 < len(s) and s[i + 1].isdigit():
            return i
    return -1


def expand_strongs(bh_strongs: str | None) -> list[str | None]:
    """
    "1722"          → ["1722"]
    "2222-1510.7.3" → ["2222", "1510.7.3"]
    None            → [None]   (proper noun)
    """
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


def _base(s: str | None) -> str | None:
    if s is None:
        return None
    return s.split(".")[0]


# ── Core verse builder ────────────────────────────────────────────────────────

def build_verse_words(bh_rows):
    """
    Convert one verse's bh_words rows into INSERT-ready tuples.

    bh_rows: list of (strongs, english, italic, greek_pos) ordered by position.

    Returns list of (position, english, english_head, strongs, strongs_base,
                     greek_pos, bracket_id, italic).

    bracket_id logic:
      - Contiguous first-component words with non-null greek_pos share a bracket_id.
      - Counter advances when the first word of a new bracket run is encountered.
      - Compound extension rows (i>0) never get a bracket_id; they don't break
        an in-progress bracket run either (in_bracket state only changes on i==0).
    """
    words = []
    pos = 0
    bid = 0
    in_bracket = False

    for bh_strongs, bh_english, bh_italic, bh_greek_pos in bh_rows:
        components = expand_strongs(bh_strongs)

        for i, comp in enumerate(components):
            if i == 0:
                if bh_greek_pos is not None:
                    if not in_bracket:
                        bid += 1
                        in_bracket = True
                    bracket_id = bid
                else:
                    bracket_id = None
                    in_bracket = False
                english      = bh_english
                english_head = _head_word(bh_english) if bh_english else None
                greek_pos    = bh_greek_pos
                italic       = bh_italic
            else:
                # compound extension: no bracket, no gloss, no greek_pos
                bracket_id   = None
                english      = None
                english_head = None
                greek_pos    = None
                italic       = 0

            if comp is None:
                strongs      = "*"
                strongs_base = "*"
            else:
                strongs      = comp
                strongs_base = _base(comp)

            words.append((pos, english, english_head, strongs, strongs_base,
                          greek_pos, bracket_id, italic))
            pos += 1

    return words


# ── Main ──────────────────────────────────────────────────────────────────────

def run(bible_db: str, scrape_db: str) -> None:
    scrape = sqlite3.connect(scrape_db)

    cols = {row[1] for row in scrape.execute("PRAGMA table_info(bh_words)")}
    if "greek_pos" not in cols:
        print("ERROR: bh_words has no greek_pos column.")
        print("This script requires the updated scraper. Re-scrape first.")
        scrape.close()
        sys.exit(1)

    bh_verse_count = scrape.execute(
        "SELECT COUNT(*) FROM (SELECT DISTINCT book, chapter, verse FROM bh_words)"
    ).fetchone()[0]
    bh_word_count = scrape.execute("SELECT COUNT(*) FROM bh_words").fetchone()[0]
    print(f"BH verses: {bh_verse_count:,}  words: {bh_word_count:,}")

    ans = input(
        "\nThis will DELETE all rows from words and rebuild from BH data.\n"
        "Back up bible.db first if you haven't.  Type 'rebuild' to confirm: "
    ).strip()
    if ans != "rebuild":
        print("Aborted.")
        scrape.close()
        return

    main = sqlite3.connect(bible_db)

    verse_map = {}
    for row in main.execute("SELECT id, book, chapter, verse FROM verses"):
        verse_map[(row[1], row[2], row[3])] = row[0]
    print(f"ABP verses in DB:  {len(verse_map):,}")

    bh_verses = scrape.execute(
        "SELECT DISTINCT book, chapter, verse FROM bh_words ORDER BY book, chapter, verse"
    ).fetchall()

    print("\nClearing words table …")
    main.execute("DELETE FROM words")
    main.commit()

    inserted = 0
    skipped  = 0

    for bh_book, bh_chapter, bh_verse in bh_verses:
        abbrev = SLUG_TO_ABBREV.get(bh_book)
        if not abbrev:
            skipped += 1
            continue

        verse_id = verse_map.get((abbrev, bh_chapter, bh_verse))
        if not verse_id:
            skipped += 1
            continue

        bh_rows = scrape.execute(
            "SELECT strongs, english, italic, greek_pos FROM bh_words"
            " WHERE book=? AND chapter=? AND verse=? ORDER BY position",
            (bh_book, bh_chapter, bh_verse),
        ).fetchall()

        if not bh_rows:
            skipped += 1
            continue

        word_rows = build_verse_words(bh_rows)

        main.executemany(
            "INSERT INTO words"
            " (verse_id, position, english, english_head, strongs, strongs_base,"
            "  greek_pos, bracket_id, italic)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(verse_id, *w) for w in word_rows],
        )
        inserted += len(word_rows)

        if inserted % 50_000 == 0:
            main.commit()
            print(f"  {inserted:,} words inserted …", flush=True)

    main.commit()
    main.close()
    scrape.close()

    print()
    print("── Results ──────────────────────────────────────────────────")
    print(f"  Words inserted: {inserted:,}")
    print(f"  Verses skipped: {skipped:,}")


def main():
    bible_db  = sys.argv[1] if len(sys.argv) > 1 else "bible.db"
    scrape_db = sys.argv[2] if len(sys.argv) > 2 else "bh_scrape.db"

    for path in (bible_db, scrape_db):
        if not Path(path).exists():
            print(f"ERROR: {path} not found.")
            sys.exit(1)

    print(f"bible.db:  {bible_db}")
    print(f"scrape db: {scrape_db}\n")
    run(bible_db, scrape_db)


if __name__ == "__main__":
    main()
