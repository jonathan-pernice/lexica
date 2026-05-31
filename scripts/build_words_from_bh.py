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

import re
import sys
import shutil
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


# ── Lexicon-assisted compound word matching ───────────────────────────────────

# Articles, conjunctions, prepositions that contribute no English gloss word.
# Excluded from the elimination step so they don't consume an unmatched word.
_SKIP_STRONGS = frozenset({
    '3588', '3739', '846',           # the / who-which / he-she-it
    '1161', '2532', '3767', '1063',  # and-but / and-also / therefore / for
    '1510', '2258',                  # is-am-are / was-were (copula)
    '3303',                          # truly-but
})


def _load_lexicon(conn) -> dict[str, set[str]]:
    """Return {bare_strongs_base: set_of_lowercase_def_words} from the lexicon table."""
    lex: dict[str, set[str]] = {}
    for strongs, kjv_def, strongs_def in conn.execute(
        "SELECT strongs, kjv_def, strongs_def FROM lexicon"
    ):
        base = strongs.lstrip("GH").split(".")[0]
        text = " ".join(filter(None, [kjv_def, strongs_def]))
        words = set(re.sub(r"[^\w\s]", " ", text).lower().split())
        lex[base] = words
    return lex


def _match_compound(components: list, english: str, lex: dict) -> dict[int, str]:
    """
    Match English gloss words to compound strongs components via lexicon defs.

    Returns {component_index: word_string}.  Components absent from the result
    get no english gloss (articles, conjunctions, unmatched extensions).

    Algorithm:
      Pass 1 — exact: for each meaningful component, find the gloss word whose
               lowercase form appears in the component's lexicon def word set.
      Pass 2 — eliminate: if the count of unmatched meaningful components equals
               the count of unmatched gloss words, assign them positionally.
               This catches "made" → G4160 when "make" is in the def but the
               inflected form "made" is not.
    """
    if not english or len(components) <= 1:
        return {0: english} if english else {}

    orig_words = english.split()
    if len(orig_words) == 1:
        return {0: orig_words[0]}

    bases = [_base(c) for c in components]
    assignment: dict[int, str] = {}
    used: set[int] = set()

    # Pass 1: exact lexicon match
    for i, base in enumerate(bases):
        if not base or base in _SKIP_STRONGS:
            continue
        def_words = lex.get(base, set())
        for j, word in enumerate(orig_words):
            if j in used:
                continue
            if word.lower() in def_words:
                assignment[i] = word
                used.add(j)
                break

    # Pass 2: elimination
    unmatched_comps = [
        i for i, base in enumerate(bases)
        if i not in assignment and base and base not in _SKIP_STRONGS
    ]
    unmatched_words = [orig_words[j] for j in range(len(orig_words)) if j not in used]

    if len(unmatched_comps) == len(unmatched_words):
        for i, word in zip(unmatched_comps, unmatched_words):
            assignment[i] = word

    return assignment


# ── Core verse builder ────────────────────────────────────────────────────────

def build_verse_words(bh_rows, lex: dict | None = None):
    """
    Convert one verse's bh_words rows into INSERT-ready tuples.

    bh_rows: list of (strongs, english, italic_words, greek_pos) ordered by position.
    lex:     optional {strongs_base: def_word_set} from _load_lexicon(); when
             provided, compound strongs get per-component English via lexicon
             matching rather than all gloss text landing on the first component.

    Returns list of (position, english, english_head, strongs, strongs_base,
                     greek_pos, bracket_id, italic, italic_words).

    italic is set to 1 only when the display word (english_head, or english if
    single-word) is itself in the italic_words set — avoids marking "beginning"
    italic just because "the" in "the beginning" is a translator addition.
    italic_words carries the raw comma-joined set for all component rows so the
    frontend can split multi-word glosses and mute only the italic sub-words.

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

    for bh_strongs, bh_english, bh_italic_words, bh_greek_pos in bh_rows:
        components = expand_strongs(bh_strongs)
        italic_set = set(bh_italic_words.split(",")) if bh_italic_words else set()

        if lex and len(components) > 1:
            word_map = _match_compound(components, bh_english, lex)
        else:
            word_map = {0: bh_english} if bh_english else {}

        for i, comp in enumerate(components):
            # bracket_id and in_bracket only advance on the first component of each BH cell
            if i == 0:
                if bh_greek_pos is not None:
                    if not in_bracket:
                        bid += 1
                        in_bracket = True
                    bracket_id = bid
                else:
                    bracket_id = None
                    in_bracket = False
                greek_pos = bh_greek_pos
            else:
                bracket_id = None
                greek_pos  = None
                # in_bracket intentionally unchanged for extension rows

            english      = word_map.get(i)
            english_head = _head_word(english) if english else None
            display_word = english_head or (english if english and " " not in english else None)
            italic       = 1 if display_word and display_word.lower() in italic_set else 0

            if comp is None:
                strongs      = "*"
                strongs_base = "*"
            else:
                strongs      = comp
                strongs_base = _base(comp)

            words.append((pos, english, english_head, strongs, strongs_base,
                          greek_pos, bracket_id, italic, bh_italic_words))
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
        "Type 'rebuild' to confirm: "
    ).strip()
    if ans != "rebuild":
        print("Aborted.")
        scrape.close()
        return

    main = sqlite3.connect(bible_db)

    bak = Path(bible_db).with_suffix(".db.bak")
    print(f"Backing up {bible_db} → {bak} …")
    shutil.copy2(bible_db, bak)
    print("Backup done.")

    lex = _load_lexicon(main)
    print(f"Lexicon entries loaded: {len(lex):,}")

    verse_map = {}
    for row in main.execute("SELECT id, book, chapter, verse FROM verses"):
        verse_map[(row[1], row[2], row[3])] = row[0]
    print(f"ABP verses in DB:  {len(verse_map):,}")

    bh_verses = scrape.execute(
        "SELECT DISTINCT book, chapter, verse FROM bh_words ORDER BY book, chapter, verse"
    ).fetchall()

    main_cols = {row[1] for row in main.execute("PRAGMA table_info(words)")}
    if "italic_words" not in main_cols:
        main.execute("ALTER TABLE words ADD COLUMN italic_words TEXT NOT NULL DEFAULT ''")
        main.commit()
        print("Added italic_words column to words table.")

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
            "SELECT strongs, english, italic_words, greek_pos FROM bh_words"
            " WHERE book=? AND chapter=? AND verse=? ORDER BY position",
            (bh_book, bh_chapter, bh_verse),
        ).fetchall()

        if not bh_rows:
            skipped += 1
            continue

        word_rows = build_verse_words(bh_rows, lex)

        main.executemany(
            "INSERT INTO words"
            " (verse_id, position, english, english_head, strongs, strongs_base,"
            "  greek_pos, bracket_id, italic, italic_words)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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


def run_test(bible_db: str, scrape_db: str, book: str = "genesis", chapter: int = 1) -> None:
    """
    Dry-run: process one chapter through the full pipeline and print results.
    Does NOT write to bible.db.  Use to verify compound matching and italic logic.

    Default: genesis chapter 1 — covers "God made" (compound), "the beginning"
    (leading italic), and "dry land" (trailing italic) test cases.
    """
    scrape = sqlite3.connect(scrape_db)
    main   = sqlite3.connect(bible_db)

    lex = _load_lexicon(main)
    print(f"Lexicon entries: {len(lex):,}\n")

    verses = scrape.execute(
        "SELECT DISTINCT verse FROM bh_words WHERE book=? AND chapter=? ORDER BY verse",
        (book, chapter),
    ).fetchall()

    if not verses:
        print(f"No data found for {book} chapter {chapter} in {scrape_db}.")
        return

    abbrev = SLUG_TO_ABBREV.get(book, book)
    for (verse,) in verses:
        bh_rows = scrape.execute(
            "SELECT strongs, english, italic_words, greek_pos FROM bh_words"
            " WHERE book=? AND chapter=? AND verse=? ORDER BY position",
            (book, chapter, verse),
        ).fetchall()

        word_rows = build_verse_words(bh_rows, lex)
        print(f"{abbrev} {chapter}:{verse}")
        for (wpos, eng, head, strongs, sbase, gpos, bid, italic, iw) in word_rows:
            flag = f"  italic_words={iw!r}" if iw else ""
            print(
                f"  [{wpos:2}] {strongs or '*':12}  "
                f"eng={str(eng):15}  head={str(head):12}  italic={italic}{flag}"
            )
        print()

    scrape.close()
    main.close()


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Rebuild words table from bh_scrape.db")
    parser.add_argument("bible_db",  nargs="?", default="bible.db")
    parser.add_argument("scrape_db", nargs="?", default="bh_scrape.db")
    parser.add_argument("--test",    action="store_true",
                        help="Dry-run genesis ch.1 to verify compound+italic logic")
    parser.add_argument("--book",    default="genesis",
                        help="Book slug for --test (default: genesis)")
    parser.add_argument("--chapter", type=int, default=1,
                        help="Chapter for --test (default: 1)")
    args = parser.parse_args()

    for path in (args.bible_db, args.scrape_db):
        if not Path(path).exists():
            print(f"ERROR: {path} not found.")
            sys.exit(1)

    print(f"bible.db:  {args.bible_db}")
    print(f"scrape db: {args.scrape_db}\n")

    if args.test:
        run_test(args.bible_db, args.scrape_db, args.book, args.chapter)
    else:
        run(args.bible_db, args.scrape_db)


if __name__ == "__main__":
    main()
