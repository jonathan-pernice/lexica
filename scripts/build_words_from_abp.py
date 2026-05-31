#!/usr/bin/env python3
"""
build_words_from_abp.py

Rebuilds the words table using ABP text files for word order and glosses,
with BH scrape as a metadata overlay (italic_words, smcap_words, greek_pos).

Fixes the word-order regression from build_words_from_bh.py: BH stores Greek
syntactic order; ABP text files use correct English reading order.

Run on PythonAnywhere:
    python scripts/build_words_from_abp.py [bible.db] [bh_scrape.db]
    python scripts/build_words_from_abp.py --test [--book Gen] [--chapter 1] [--verse 1]
"""

import re
import sys
import shutil
import sqlite3
import zipfile
from pathlib import Path

# _head_word: extract display word from a multi-word gloss ("the beginning" → "beginning")
try:
    sys.path.insert(0, str(Path(__file__).parent))
    from parse_abp import _head_word
except ImportError:
    _ARTICLES = frozenset({"the", "a", "an"})

    def _head_word(text):
        if not text:
            return None
        words = re.sub(r"[^\w]", " ", text).split()
        for w in words:
            if w.lower() not in _ARTICLES:
                return w
        return words[0] if words else None


BASE_DIR   = Path(__file__).parent.parent
ABP_OT_ZIP = BASE_DIR / "abp_ot_texts.zip"
ABP_NT_ZIP = BASE_DIR / "abp_nt_texts.zip"

# ABP verse-ref abbreviation → BH slug used in bh_words.book
ABBREV_TO_SLUG = {
    "Gen": "genesis",        "Exo": "exodus",          "Lev": "leviticus",
    "Num": "numbers",        "Deu": "deuteronomy",      "Jos": "joshua",
    "Jdg": "judges",         "Rth": "ruth",             "1Sa": "1_samuel",
    "2Sa": "2_samuel",       "1Ki": "1_kings",          "2Ki": "2_kings",
    "1Ch": "1_chronicles",   "2Ch": "2_chronicles",     "Ezr": "ezra",
    "Neh": "nehemiah",       "Est": "esther",           "Job": "job",
    "Psa": "psalms",         "Pro": "proverbs",         "Ecc": "ecclesiastes",
    "Son": "songs",          "Isa": "isaiah",           "Jer": "jeremiah",
    "Lam": "lamentations",   "Eze": "ezekiel",          "Dan": "daniel",
    "Hos": "hosea",          "Joe": "joel",             "Amo": "amos",
    "Oba": "obadiah",        "Jon": "jonah",            "Mic": "micah",
    "Nah": "nahum",          "Hab": "habakkuk",         "Zep": "zephaniah",
    "Hag": "haggai",         "Zec": "zechariah",        "Mal": "malachi",
    "Mat": "matthew",        "Mar": "mark",             "Luk": "luke",
    "Joh": "john",           "Act": "acts",             "Rom": "romans",
    "1Co": "1_corinthians",  "2Co": "2_corinthians",    "Gal": "galatians",
    "Eph": "ephesians",      "Php": "philippians",      "Col": "colossians",
    "1Th": "1_thessalonians","2Th": "2_thessalonians",  "1Ti": "1_timothy",
    "2Ti": "2_timothy",      "Tit": "titus",            "Phm": "philemon",
    "Heb": "hebrews",        "Jas": "james",            "1Pe": "1_peter",
    "2Pe": "2_peter",        "1Jn": "1_john",           "2Jn": "2_john",
    "3Jn": "3_john",         "Jud": "jude",             "Rev": "revelation",
}

_STRONGS_RE  = re.compile(r"(G\*|G\d+(?:\.\d+)*)")
_VERSE_RE    = re.compile(r"^\((\w+)\s+(\d+):(\d+)\)\s+(.*)")
_STRIP_PUNCT = re.compile(r"[^\w\s]")
_WORD_NUM    = re.compile(r"(?<!\w)\d+")  # digits at word boundaries (position numbers)


# ── Parsing ───────────────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    return _STRIP_PUNCT.sub("", text or "").lower().strip()


def clean_english(text: str) -> str:
    """Strip ABP bracket chars and position numbers from a gloss token.

    'let [3appear'  → 'let appear'   (internal bracket + position number)
    '[6come together' → 'come together'
    '1the'          → 'the'
    '5heaven]'      → 'heaven'
    'God said,'     → 'God said,'    (unchanged)
    """
    t = text.strip()
    t = t.replace("[", "").replace("]", "")   # remove all bracket chars
    t = _WORD_NUM.sub("", t)                  # remove position numbers at word boundaries
    return t.strip()


def parse_abp_line(line: str):
    """
    Parse one ABP text line.
    Returns (abbrev, chapter, verse, words) or None.
    words = [(english_text, strongs_raw_or_None), ...]
    """
    m = _VERSE_RE.match(line.strip())
    if not m:
        return None
    book    = m.group(1)
    chapter = int(m.group(2))
    verse   = int(m.group(3))
    text    = m.group(4)

    parts = _STRONGS_RE.split(text)
    # parts alternates: [text0, strongs0, text1, strongs1, ..., textN]
    words = []
    i = 0
    while i < len(parts) - 1:
        words.append((clean_english(parts[i]), parts[i + 1]))
        i += 2
    # trailing text after last strongs marker (no strongs attached)
    if parts and parts[-1].strip():
        words.append((clean_english(parts[-1]), None))

    return book, chapter, verse, words


def iter_verses(*zip_paths):
    """Yield (abbrev, chapter, verse, words) from all ABP zip files."""
    for zp in zip_paths:
        with zipfile.ZipFile(zp) as z:
            for name in sorted(z.namelist()):
                if not name.endswith(".txt"):
                    continue
                with z.open(name) as f:
                    for raw in f:
                        parsed = parse_abp_line(raw.decode("utf-8", errors="replace"))
                        if parsed:
                            yield parsed


# ── BH index ──────────────────────────────────────────────────────────────────

def load_bh_verse_index(scrape: sqlite3.Connection) -> dict:
    """
    Returns {(slug, ch, vs): [(strongs_base, norm_english, greek_pos, iw, sw), ...]}
    in position order. Compound BH strongs (e.g. "4160-1096") are indexed under
    their first component only, since that is where the English gloss lives.
    """
    index: dict = {}
    cur_key = None
    cur_rows: list = []

    for slug, ch, vs, strongs, english, iw, sw, gpos in scrape.execute(
        "SELECT book, chapter, verse, strongs, english, italic_words, smcap_words, greek_pos"
        " FROM bh_words ORDER BY book, chapter, verse, position"
    ):
        key = (slug, ch, vs)
        if key != cur_key:
            if cur_key is not None:
                index[cur_key] = cur_rows
            cur_key = key
            cur_rows = []
        base = strongs.split("-")[0].split(".")[0] if strongs else "*"
        cur_rows.append((base, normalize(english or ""), gpos, iw or "", sw or ""))

    if cur_key is not None:
        index[cur_key] = cur_rows
    return index


def bh_lookup(bh_rows: list, used: set, abp_base: str, abp_norm: str):
    """
    Find best unused BH row for an ABP word (strongs_base + normalized english text).
    Primary: exact match on base + norm.
    Fallback: first unused row with matching base (handles repeated strongs in verse).
    Returns (greek_pos, italic_words, smcap_words).
    """
    for i, (base, norm, gpos, iw, sw) in enumerate(bh_rows):
        if i not in used and base == abp_base and norm == abp_norm:
            used.add(i)
            return gpos, iw, sw
    for i, (base, norm, gpos, iw, sw) in enumerate(bh_rows):
        if i not in used and base == abp_base:
            used.add(i)
            return gpos, iw, sw
    return None, "", ""


# ── Lexicon helpers ───────────────────────────────────────────────────────────

def load_lexicon(conn: sqlite3.Connection) -> dict:
    """Return {strongs_base: set_of_lowercase_def_words} from the lexicon table."""
    lex: dict = {}
    for strongs, kjv_def, strongs_def in conn.execute(
        "SELECT strongs, kjv_def, strongs_def FROM lexicon"
    ):
        base = strongs.lstrip("GH").split(".")[0]
        text = " ".join(filter(None, [kjv_def, strongs_def]))
        lex[base] = set(re.sub(r"[^\w\s]", " ", text).lower().split())
    return lex


def _split_compounds(rows: list, lex: dict) -> None:
    """
    Redistribute words from compound ABP glosses to subsequent empty-english slots
    using lexicon evidence, then swap position numbers so the redistributed words
    display before the verb/head word. Modifies rows in-place.

    Example: 'God made' on G4160 (pos 2) + empty G3588 (pos 3), G2316 (pos 4)
      → G4160 = 'made', pos 4   (in G4160 lex: make/do)
      → G3588 = '',    pos 3    (hidden, unchanged)
      → G2316 = 'God', pos 2   (in G2316 lex: God/deity — swapped to pos 2)
    After sort: God(2) … made(4) → "God made" in correct English order.
    """
    _NORM = re.compile(r"[^\w]")

    for i in range(len(rows)):
        pos_i, eng, head, strongs, sbase, gpos, bid, italic, iw, sw = rows[i]
        if not eng or " " not in eng:
            continue
        if not sbase or sbase in ("*", ""):
            continue

        own_def = lex.get(sbase, set())
        gloss_words = eng.split()

        # Collect subsequent contiguous empty-english slots
        ahead = []
        for j in range(i + 1, len(rows)):
            if rows[j][1]:          # non-empty english — stop
                break
            slot_base = rows[j][4]
            if slot_base and slot_base not in ("*", ""):
                ahead.append((j, slot_base, lex.get(slot_base, set())))

        if not ahead:
            continue

        taken: dict = {}   # j → word
        own = []

        for word in gloss_words:
            norm = _NORM.sub("", word).lower()
            if not norm:
                own.append(word)
                continue
            if norm in own_def:
                own.append(word)
                continue
            for j, slot_base, slot_def in ahead:
                if j in taken:
                    continue
                if slot_def and norm in slot_def:
                    taken[j] = word
                    break
            else:
                own.append(word)  # no matching slot — keep on current strongs

        if not taken:
            continue

        # Assign english to target slots
        for j, word in taken.items():
            r = rows[j]
            rows[j] = (r[0], word, word, r[3], r[4], r[5], r[6], r[7], r[8], r[9])

        # Update source row with remaining words
        new_eng = " ".join(own) if own else None
        rows[i] = (pos_i, new_eng, _head_word(new_eng) if new_eng else None,
                   strongs, sbase, gpos, bid, italic, iw, sw)

        # Swap position numbers: each target slot takes source position so it
        # displays before the (now later) source word
        for j in sorted(taken.keys()):
            p_i, p_j = rows[i][0], rows[j][0]
            rows[i] = (p_j,) + rows[i][1:]
            rows[j] = (p_i,) + rows[j][1:]

    rows.sort(key=lambda r: r[0])


# ── Verse builder ─────────────────────────────────────────────────────────────

def build_verse_words(abp_words: list, bh_rows: list, lex: dict = None) -> list:
    """
    Combine ABP word list (order + glosses) with BH metadata (italic, greek_pos).
    If lex is provided, compound glosses are split across subsequent empty slots.

    Returns list of (pos, english, english_head, strongs, strongs_base,
                     greek_pos, bracket_id, italic, italic_words, smcap_words).
    """
    used: set = set()
    rows: list = []
    pos = 0
    bid = 0
    in_bracket = False

    for english, raw_strongs in abp_words:
        if raw_strongs is None:
            strongs = ""
            sbase   = ""
            gpos, iw, sw = None, "", ""
        elif raw_strongs == "G*":
            strongs = "*"
            sbase   = "*"
            gpos, iw, sw = None, "", ""
        else:
            strongs = raw_strongs[1:]          # strip G prefix: 'G2822' → '2822'
            sbase   = strongs.split(".")[0]    # base: '1510.6' → '1510'
            norm    = normalize(english)
            gpos, iw, sw = bh_lookup(bh_rows, used, sbase, norm)

        # bracket_id: advance counter at start of each contiguous greek_pos run
        if gpos is not None:
            if not in_bracket:
                bid += 1
                in_bracket = True
            bracket_id = bid
        else:
            bracket_id = None
            in_bracket = False

        english_head = _head_word(english) if english else None
        display      = english_head or (english if english and " " not in english else None)
        italic_set   = set(iw.split(",")) if iw else set()
        italic       = 1 if (display and display.lower() in italic_set) else 0

        rows.append((
            pos,
            english or None,
            english_head,
            strongs,
            sbase,
            gpos,
            bracket_id,
            italic,
            iw if iw else "",
            sw if sw else "",
        ))
        pos += 1

    if lex:
        _split_compounds(rows, lex)

    return rows


# ── Run / test ────────────────────────────────────────────────────────────────

def run(bible_db: str, scrape_db: str) -> None:
    scrape = sqlite3.connect(scrape_db)

    cols = {r[1] for r in scrape.execute("PRAGMA table_info(bh_words)")}
    if "greek_pos" not in cols:
        print("ERROR: bh_words missing greek_pos — re-scrape first.")
        scrape.close()
        sys.exit(1)

    bh_wc = scrape.execute("SELECT COUNT(*) FROM bh_words").fetchone()[0]
    print(f"BH words: {bh_wc:,}")

    ans = input(
        "\nThis will DELETE all rows from words and rebuild from ABP text + BH metadata.\n"
        "Type 'rebuild' to confirm: "
    ).strip()
    if ans != "rebuild":
        print("Aborted.")
        scrape.close()
        return

    main = sqlite3.connect(bible_db)
    bak  = Path(bible_db).with_suffix(".db.bak")
    print(f"Backing up → {bak} …")
    shutil.copy2(bible_db, bak)
    print("Backup done.")

    # Ensure italic_words / smcap_words columns exist
    main_cols = {r[1] for r in main.execute("PRAGMA table_info(words)")}
    for col in ("italic_words", "smcap_words"):
        if col not in main_cols:
            main.execute(f"ALTER TABLE words ADD COLUMN {col} TEXT")
            main.commit()
            print(f"Added column: {col}")

    verse_map = {(b, c, v): vid for vid, b, c, v in main.execute(
        "SELECT id, book, chapter, verse FROM verses"
    )}
    print(f"ABP verse map: {len(verse_map):,}")

    print("Loading lexicon …")
    lex = load_lexicon(main)
    print(f"Lexicon entries: {len(lex):,}")

    print("Loading BH index …")
    bh_index = load_bh_verse_index(scrape)
    print(f"BH verse keys: {len(bh_index):,}\n")

    print("Clearing words table …")
    main.execute("DELETE FROM words")
    main.commit()

    inserted = skipped = 0

    for abbrev, chapter, verse, abp_words in iter_verses(ABP_OT_ZIP, ABP_NT_ZIP):
        verse_id = verse_map.get((abbrev, chapter, verse))
        if not verse_id:
            skipped += 1
            continue

        slug     = ABBREV_TO_SLUG.get(abbrev)
        bh_rows  = bh_index.get((slug, chapter, verse), []) if slug else []
        word_rows = build_verse_words(abp_words, bh_rows, lex)

        main.executemany(
            "INSERT INTO words"
            " (verse_id, position, english, english_head, strongs, strongs_base,"
            "  greek_pos, bracket_id, italic, italic_words, smcap_words)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(verse_id, *w) for w in word_rows],
        )
        inserted += len(word_rows)

        if inserted % 50_000 == 0:
            main.commit()
            print(f"  {inserted:,} words inserted …", flush=True)

    main.commit()
    main.close()
    scrape.close()

    print(f"\n── Results ─────────────────────────────────────────────")
    print(f"  Words inserted: {inserted:,}")
    print(f"  Verses skipped: {skipped:,}")


def run_test(scrape_db: str, book_abbrev: str = "Gen", chapter: int = 1,
             verse: int = None, bible_db: str = None) -> None:
    """
    Dry-run: parse one chapter (or single verse) and print results.
    Pass bible_db to enable lexicon-based compound splitting.
    Does NOT write to bible.db.
    """
    scrape   = sqlite3.connect(scrape_db)
    bh_index = load_bh_verse_index(scrape)
    scrape.close()

    lex  = None
    if bible_db and Path(bible_db).exists():
        conn = sqlite3.connect(bible_db)
        lex  = load_lexicon(conn)
        conn.close()
        print(f"Lexicon: {len(lex):,} entries\n")

    slug   = ABBREV_TO_SLUG.get(book_abbrev, book_abbrev.lower())
    verses = {}
    for abbrev, ch, vs, words in iter_verses(ABP_OT_ZIP, ABP_NT_ZIP):
        if abbrev == book_abbrev and ch == chapter:
            verses[vs] = words

    if not verses:
        print(f"No ABP data for {book_abbrev} {chapter}.")
        return

    print(f"=== {book_abbrev} {chapter} ===\n")
    for vs in sorted(verses):
        if verse is not None and vs != verse:
            continue
        abp_words = verses[vs]
        bh_rows   = bh_index.get((slug, chapter, vs), [])
        word_rows = build_verse_words(abp_words, bh_rows)

        print(f"{book_abbrev} {chapter}:{vs}  (BH rows: {len(bh_rows)})")
        for (p, eng, head, sn, sb, gpos, bid, italic, iw, sw) in word_rows:
            flags = ""
            if gpos   is not None: flags += f"  gpos={gpos}"
            if bid    is not None: flags += f"  bid={bid}"
            if iw:                 flags += f"  iw={iw!r}"
            if sw:                 flags += f"  sw={sw!r}"
            print(
                f"  [{p:2}] {str(sn or '-'):12}  "
                f"eng={str(eng):22}  head={str(head):15}  italic={italic}{flags}"
            )
        print()


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Rebuild words table from ABP text files + BH scrape metadata"
    )
    parser.add_argument("bible_db",  nargs="?", default="bible.db",
                        help="Path to bible.db")
    parser.add_argument("scrape_db", nargs="?", default="bh_scrape.db")
    parser.add_argument("--test",    action="store_true",
                        help="Dry-run one chapter/verse; does not write to bible.db")
    parser.add_argument("--book",    default="Gen",
                        help="ABP book abbreviation for --test (default: Gen)")
    parser.add_argument("--chapter", type=int, default=1,
                        help="Chapter number for --test (default: 1)")
    parser.add_argument("--verse",   type=int, default=None,
                        help="Single verse for --test (default: all verses in chapter)")
    args = parser.parse_args()

    if args.test:
        if not Path(args.scrape_db).exists():
            print(f"ERROR: {args.scrape_db} not found.")
            sys.exit(1)
        bible_db = args.bible_db if Path(args.bible_db).exists() else None
        run_test(args.scrape_db, args.book, args.chapter, args.verse, bible_db)
    else:
        for path in (args.bible_db, args.scrape_db):
            if not Path(path).exists():
                print(f"ERROR: {path} not found.")
                sys.exit(1)
        print(f"bible.db:  {args.bible_db}")
        print(f"scrape db: {args.scrape_db}\n")
        run(args.bible_db, args.scrape_db)


if __name__ == "__main__":
    main()
