#!/usr/bin/env python3
"""Load the Berean Standard Bible (BSB) verse text into bible.db.

BSB is fully public domain (dedicated 2023-04-30 — no license, no attribution
required). Source is BibleHub/Berean's plain text export:

    https://bereanbible.com/bsb.txt

Format: a few header lines, then one verse per line, tab-separated:

    Genesis 1:1<TAB>In the beginning God created the heavens and the earth.

This loader fills ONE table — bsb_verses(book_id, chapter, verse_num, verse_text)
— mirroring kjv_verses so the BSB rides the same book-id numbering (1-66). No
word-level / Strong's data: BSB is a reading + plain-text-search corpus only.

Safe to re-run: uses INSERT OR REPLACE keyed on (book_id, chapter, verse_num),
so running it again just refreshes the same rows. It NEVER touches any other
table.

Usage:
    python3 scripts/load_bsb.py bible.db [path/to/bsb.txt]

If the text file is omitted it is downloaded from bereanbible.com.
"""
import sqlite3
import sys
import urllib.request

BSB_URL = "https://bereanbible.com/bsb.txt"

# Protestant 1-66 book ids — identical to core._KJV_BOOK_ID so bsb_verses lines
# up with kjv_verses. Kept inline so the loader has no Flask import side effects.
_BOOK_ID = {
    "Gen": 1, "Exo": 2, "Lev": 3, "Num": 4, "Deu": 5, "Jos": 6, "Jdg": 7,
    "Rth": 8, "1Sa": 9, "2Sa": 10, "1Ki": 11, "2Ki": 12, "1Ch": 13, "2Ch": 14,
    "Ezr": 15, "Neh": 16, "Est": 17, "Job": 18, "Psa": 19, "Pro": 20, "Ecc": 21,
    "Son": 22, "Isa": 23, "Jer": 24, "Lam": 25, "Eze": 26, "Dan": 27, "Hos": 28,
    "Joe": 29, "Amo": 30, "Oba": 31, "Jon": 32, "Mic": 33, "Nah": 34, "Hab": 35,
    "Zep": 36, "Hag": 37, "Zec": 38, "Mal": 39, "Mat": 40, "Mar": 41, "Luk": 42,
    "Joh": 43, "Act": 44, "Rom": 45, "1Co": 46, "2Co": 47, "Gal": 48, "Eph": 49,
    "Php": 50, "Col": 51, "1Th": 52, "2Th": 53, "1Ti": 54, "2Ti": 55, "Tit": 56,
    "Phm": 57, "Heb": 58, "Jas": 59, "1Pe": 60, "2Pe": 61, "1Jn": 62, "2Jn": 63,
    "3Jn": 64, "Jud": 65, "Rev": 66,
}

# Full BSB book name -> app abbreviation. Variants (Psalm/Psalms, Song of
# Solomon/Songs) are folded in so a future export tweak won't silently drop a book.
_NAME_TO_ABBR = {
    "genesis": "Gen", "exodus": "Exo", "leviticus": "Lev", "numbers": "Num",
    "deuteronomy": "Deu", "joshua": "Jos", "judges": "Jdg", "ruth": "Rth",
    "1 samuel": "1Sa", "2 samuel": "2Sa", "1 kings": "1Ki", "2 kings": "2Ki",
    "1 chronicles": "1Ch", "2 chronicles": "2Ch", "ezra": "Ezr",
    "nehemiah": "Neh", "esther": "Est", "job": "Job",
    "psalm": "Psa", "psalms": "Psa", "proverbs": "Pro", "ecclesiastes": "Ecc",
    "song of solomon": "Son", "song of songs": "Son", "songs": "Son",
    "isaiah": "Isa", "jeremiah": "Jer", "lamentations": "Lam", "ezekiel": "Eze",
    "daniel": "Dan", "hosea": "Hos", "joel": "Joe", "amos": "Amo",
    "obadiah": "Oba", "jonah": "Jon", "micah": "Mic", "nahum": "Nah",
    "habakkuk": "Hab", "zephaniah": "Zep", "haggai": "Hag", "zechariah": "Zec",
    "malachi": "Mal", "matthew": "Mat", "mark": "Mar", "luke": "Luk",
    "john": "Joh", "acts": "Act", "romans": "Rom", "1 corinthians": "1Co",
    "2 corinthians": "2Co", "galatians": "Gal", "ephesians": "Eph",
    "philippians": "Php", "colossians": "Col", "1 thessalonians": "1Th",
    "2 thessalonians": "2Th", "1 timothy": "1Ti", "2 timothy": "2Ti",
    "titus": "Tit", "philemon": "Phm", "hebrews": "Heb", "james": "Jas",
    "1 peter": "1Pe", "2 peter": "2Pe", "1 john": "1Jn", "2 john": "2Jn",
    "3 john": "3Jn", "jude": "Jud", "revelation": "Rev",
}


def parse_ref(ref):
    """'Genesis 1:1' / '1 Samuel 2:3' -> (book_id, chapter, verse) or None."""
    ref = ref.strip()
    name, _, cv = ref.rpartition(" ")          # split off the trailing 'C:V'
    if ":" not in cv:
        return None
    abbr = _NAME_TO_ABBR.get(name.lower())
    if not abbr:
        return None
    try:
        chap, vs = cv.split(":", 1)
        return _BOOK_ID[abbr], int(chap), int(vs)
    except ValueError:
        return None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    db_path = sys.argv[1]
    txt_path = sys.argv[2] if len(sys.argv) > 2 else None

    if txt_path:
        with open(txt_path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    else:
        print(f"Downloading {BSB_URL} ...")
        with urllib.request.urlopen(BSB_URL) as resp:
            lines = resp.read().decode("utf-8").splitlines()

    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bsb_verses (
            book_id   INTEGER NOT NULL,
            chapter   INTEGER NOT NULL,
            verse_num INTEGER NOT NULL,
            verse_text TEXT,
            PRIMARY KEY (book_id, chapter, verse_num)
        )
    """)

    inserted = 0
    skipped = []
    for line in lines:
        if "\t" not in line:
            continue                              # header / blurb lines
        ref, text = line.split("\t", 1)
        if ref.strip().lower() == "verse":
            continue                              # column header row
        parsed = parse_ref(ref)
        if not parsed:
            skipped.append(ref)
            continue
        book_id, chap, vs = parsed
        conn.execute(
            "INSERT OR REPLACE INTO bsb_verses (book_id, chapter, verse_num, verse_text) "
            "VALUES (?, ?, ?, ?)",
            (book_id, chap, vs, text.strip()),
        )
        inserted += 1

    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM bsb_verses").fetchone()[0]
    books = conn.execute("SELECT COUNT(DISTINCT book_id) FROM bsb_verses").fetchone()[0]
    conn.close()

    print(f"BSB verses loaded: {inserted}  (table now holds {total} across {books} books)")
    if skipped:
        uniq = sorted(set(skipped))
        print(f"WARNING: {len(skipped)} lines skipped (unrecognized book). "
              f"Distinct refs: {uniq[:10]}{' ...' if len(uniq) > 10 else ''}")


if __name__ == "__main__":
    main()
