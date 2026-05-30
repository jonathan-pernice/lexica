#!/usr/bin/env python3
"""
migrate_bh_words.py

Patches bible.db using data scraped into bh_scrape.db:
  1. Adds  italic INTEGER DEFAULT 0  column to words table (if absent)
  2. Updates words.strongs, words.strongs_base, words.italic per verse

Alignment strategy:
  - Simple BH word (strongs="1722")      → matches 1 DB row
  - Compound BH word (strongs="2222-1510.7.3") → expands to 2 DB rows,
      one per dash-separated component.  DB already has two rows from the
      original ABP parse; we just correct which strongs goes to which row.
  - Proper noun (strongs=NULL in BH)     → only updates italic, leaves strongs="*"
  - If after expansion the row counts still don't match, that verse is
      skipped unchanged and logged.

Run on PythonAnywhere after the full crawl completes:
    python scripts/migrate_bh_words.py [bible.db] [bh_scrape.db]

Safe to re-run (idempotent): uses INSERT OR IGNORE / UPDATE, not DELETE.
"""

import sys
import sqlite3
from pathlib import Path

# ── Book slug → ABP abbreviation ─────────────────────────────────────────────
SLUG_TO_ABBREV = {
    "genesis": "Gen", "exodus": "Exo", "leviticus": "Lev", "numbers": "Num",
    "deuteronomy": "Deu", "joshua": "Jos", "judges": "Jdg", "ruth": "Rth",
    "1_samuel": "1Sa", "2_samuel": "2Sa", "1_kings": "1Ki", "2_kings": "2Ki",
    "1_chronicles": "1Ch", "2_chronicles": "2Ch", "ezra": "Ezr", "nehemiah": "Neh",
    "esther": "Est", "job": "Job", "psalms": "Psa", "proverbs": "Pro",
    "ecclesiastes": "Ecc", "song_of_solomon": "Son", "isaiah": "Isa",
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


# ── Compound handling ─────────────────────────────────────────────────────────

def expand_strongs(bh_strongs: str | None) -> list[str | None]:
    """
    Expand a BibleHub strongs string into one or more components.

    "1722"           → ["1722"]          simple
    "2222-1510.7.3"  → ["2222","1510.7.3"]  compound — splits on first "-"
    None             → [None]            proper noun (G*)

    We split on "-" but only when the character after "-" is a digit,
    to avoid accidentally splitting on a bare "-" in pathological cases.
    """
    if bh_strongs is None:
        return [None]

    # Find split points: a "-" followed by a digit
    parts = []
    current = bh_strongs
    while True:
        idx = _find_compound_dash(current)
        if idx == -1:
            parts.append(current)
            break
        parts.append(current[:idx])
        current = current[idx + 1:]   # everything after the "-"
    return parts


def _find_compound_dash(s: str) -> int:
    """Return index of the first compound-separator "-", or -1."""
    for i, ch in enumerate(s):
        if ch == "-" and i + 1 < len(s) and s[i + 1].isdigit():
            return i
    return -1


def strongs_base(strongs: str | None) -> str | None:
    """Strip dotted ABP extension: "1510.7.3" → "1510", "1722" → "1722"."""
    if strongs is None:
        return None
    return strongs.split(".")[0]


# ── Alignment ─────────────────────────────────────────────────────────────────

def align_verse(bh_rows, db_rows):
    """
    Align BibleHub word rows with existing DB word rows for one verse.

    bh_rows : list of (bh_strongs, bh_italic)   — from bh_words, ordered by position
    db_rows : list of (word_id,   db_strongs)    — from words,    ordered by position

    A compound BH entry expands to N DB rows (one per component).
    Proper nouns (bh_strongs=None) match 1 DB row; only italic is updated.

    Returns list of Update namedtuples, or None if alignment fails.
    Each update: (word_id, new_strongs, new_base, new_italic, strongs_changed)
      strongs_changed=False for proper nouns (keeps existing strongs="*").
    """
    updates = []
    db_idx = 0

    for bh_strongs, bh_italic in bh_rows:
        components = expand_strongs(bh_strongs)

        if len(components) == 1 and components[0] is None:
            # Proper noun — match one DB row, only update italic
            if db_idx >= len(db_rows):
                return None
            word_id, _ = db_rows[db_idx]
            updates.append((word_id, None, None, int(bh_italic), False))
            db_idx += 1
        else:
            # Simple or compound — consume len(components) DB rows
            if db_idx + len(components) > len(db_rows):
                return None
            for i, comp in enumerate(components):
                word_id, _ = db_rows[db_idx + i]
                italic = int(bh_italic) if i == 0 else 0
                updates.append((word_id, comp, strongs_base(comp), italic, True))
            db_idx += len(components)

    if db_idx != len(db_rows):
        return None   # BH rows exhausted before DB rows

    return updates


# ── Migration ─────────────────────────────────────────────────────────────────

def run(bible_db: str, scrape_db: str) -> None:
    main   = sqlite3.connect(bible_db)
    scrape = sqlite3.connect(scrape_db)

    # 1. Add italic column
    try:
        main.execute("ALTER TABLE words ADD COLUMN italic INTEGER NOT NULL DEFAULT 0")
        main.commit()
        print("Added italic column to words.")
    except sqlite3.OperationalError:
        print("italic column already present.")

    # 2. Get all distinct verses from scrape
    bh_verses = scrape.execute(
        "SELECT DISTINCT book, chapter, verse FROM bh_words ORDER BY book, chapter, verse"
    ).fetchall()
    total = len(bh_verses)
    print(f"Verses to process: {total:,}\n")

    matched = 0
    skipped_no_verse = 0
    skipped_mismatch = 0
    compounds_handled = 0
    italic_set = 0
    mismatch_log = []   # collect first 20 mismatches for end-of-run report

    for bh_book, bh_chapter, bh_verse in bh_verses:
        abbrev = SLUG_TO_ABBREV.get(bh_book)
        if not abbrev:
            skipped_no_verse += 1
            continue

        # Look up verse_id in bible.db
        vrow = main.execute(
            "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
            (abbrev, bh_chapter, bh_verse),
        ).fetchone()
        if not vrow:
            skipped_no_verse += 1
            continue
        verse_id = vrow[0]

        # BibleHub words (in scrape order)
        bh_rows = scrape.execute(
            "SELECT strongs, italic FROM bh_words"
            " WHERE book=? AND chapter=? AND verse=? ORDER BY position",
            (bh_book, bh_chapter, bh_verse),
        ).fetchall()

        # Existing DB words (in position order)
        db_rows = main.execute(
            "SELECT id, strongs FROM words WHERE verse_id=? ORDER BY position",
            (verse_id,),
        ).fetchall()

        updates = align_verse(bh_rows, db_rows)

        if updates is None:
            skipped_mismatch += 1
            if len(mismatch_log) < 20:
                # Summarise what BH had vs what DB had
                bh_summary = " ".join(s or "*" for s, _ in bh_rows)
                db_summary = " ".join(s or "*" for _, s in db_rows)
                mismatch_log.append(
                    f"  {abbrev} {bh_chapter}:{bh_verse}"
                    f"  BH({len(bh_rows)}): {bh_summary[:60]}"
                    f"  DB({len(db_rows)}): {db_summary[:60]}"
                )
            continue

        # Apply updates
        for word_id, new_strongs, new_base, new_italic, strongs_changed in updates:
            if strongs_changed:
                main.execute(
                    "UPDATE words SET strongs=?, strongs_base=?, italic=? WHERE id=?",
                    (new_strongs, new_base, new_italic, word_id),
                )
            else:
                main.execute(
                    "UPDATE words SET italic=? WHERE id=?",
                    (new_italic, word_id),
                )
            if new_italic:
                italic_set += 1

        # Count compounds (BH entries that expanded to >1 DB row)
        compounds_handled += sum(
            1 for s, _ in bh_rows
            if s and _find_compound_dash(s) != -1
        )
        matched += 1

        if matched % 5000 == 0:
            main.commit()
            print(f"  {matched:,} / {total:,} verses ...", flush=True)

    main.commit()
    main.close()
    scrape.close()

    print()
    print("── Results ──────────────────────────────────────────────────")
    print(f"  Verses patched:           {matched:,}")
    print(f"  Italic words set:         {italic_set:,}")
    print(f"  Compounds handled:        {compounds_handled:,}")
    print(f"  Skipped (verse not found):{skipped_no_verse:,}")
    print(f"  Skipped (row mismatch):   {skipped_mismatch:,}")

    if mismatch_log:
        print(f"\nFirst {len(mismatch_log)} mismatches (left unchanged):")
        for line in mismatch_log:
            print(line)

    if skipped_mismatch:
        print(
            f"\nNote: {skipped_mismatch} verses skipped due to position mismatch."
            " Their existing strongs/italic values are unchanged."
            " Review the mismatch log above to decide if manual fixes are needed."
        )


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
