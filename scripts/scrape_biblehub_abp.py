#!/usr/bin/env python3
"""
scrape_biblehub_abp.py — BibleHub ABP interlinear scraper

Scrapes https://biblehub.com/interlinear/apostolic/{book}/{chapter}.htm
for all 66 books and saves word-level data to bh_scrape.db.

Goals:
  - Fix per-word Strong's assignment (current words table has compound-strongs issues)
  - Add italic flag: words in <span class="ital"> are translator additions
  - Source data for migrate_bh_words.py to update bible.db

FIRST STEP — inspect the HTML before a full crawl:
    python scripts/scrape_biblehub_abp.py --dump john 1
    # Open dump_john_1.html and verify the CSS selectors below (PARSER CONFIG section).
    python scripts/scrape_biblehub_abp.py --test john 1
    # Confirms parse output looks correct before committing to the full run.

Full crawl (run on PythonAnywhere):
    python scripts/scrape_biblehub_abp.py
    python scripts/scrape_biblehub_abp.py --resume   # skip already-done chapters

Requirements:
    pip install requests beautifulsoup4

Output: bh_scrape.db — table bh_words
"""

import re
import sys
import time
import sqlite3
import argparse
from pathlib import Path

import requests
from bs4 import BeautifulSoup


# ── Configuration ─────────────────────────────────────────────────────────────

BASE_URL = "https://biblehub.com/interlinear/apostolic/{book}/{chapter}.htm"
DELAY    = 2.5   # seconds between HTTP requests — be polite
DB_PATH  = "bh_scrape.db"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


# ── Actual BibleHub ABP HTML structure (confirmed from dump) ──────────────────
#
# Each word is:  <table class="tablefloat"><tr><td height="95" valign="middle">
#   <span class="reftop">1:3   </span>   ← ONLY on first word of each verse
#   <span class="strongs">
#     <a href="http://strongsnumbers.com/greek/NNNN.htm">NNNN</a>
#     [<a href="...">-NNNN.N.N</a>]     ← optional second link for compound strongs
#   </span>  OR just  <span class="strongs">*</span>  for proper nouns
#   <br>
#   <span class="refmain">1:3   </span>  ← ONLY on first word of each verse
#   <span class="greek">εν</span>
#   <br>
#   <span class="refbot">1:3   </span>   ← ONLY on first word of each verse
#   <span class="eng">
#     [<span class="ital">the</span>]    ← optional italic (translator addition)
#     word text
#     <span class="num">&nbsp;</span>    ← position reorder numbers, strip these
#   </span>
# </td></tr></table>
#
# Confirmed: italic class is "ital", strongs domain is strongsnumbers.com

# Verse ref pattern within span.reftop text (e.g. "1:3")
_VERSE_REF = re.compile(r"^(\d+):(\d+)$")


# ── Book list ─────────────────────────────────────────────────────────────────
# (bh_slug, abp_abbrev, chapter_count)
# bh_slug = URL path component used by BibleHub — verify with --dump if 404s appear.
BOOKS = [
    # ── Old Testament ─────────────────────────────────────────────────────────
    ("genesis",          "Gen",  50),
    ("exodus",           "Exo",  40),
    ("leviticus",        "Lev",  27),
    ("numbers",          "Num",  36),
    ("deuteronomy",      "Deu",  34),
    ("joshua",           "Jos",  24),
    ("judges",           "Jdg",  21),
    ("ruth",             "Rth",   4),
    ("1_samuel",         "1Sa",  31),
    ("2_samuel",         "2Sa",  24),
    ("1_kings",          "1Ki",  22),
    ("2_kings",          "2Ki",  25),
    ("1_chronicles",     "1Ch",  29),
    ("2_chronicles",     "2Ch",  36),
    ("ezra",             "Ezr",  10),
    ("nehemiah",         "Neh",  13),
    ("esther",           "Est",  10),
    ("job",              "Job",  42),
    ("psalms",           "Psa", 150),
    ("proverbs",         "Pro",  31),
    ("ecclesiastes",     "Ecc",  12),
    ("songs",            "Son",   8),
    ("isaiah",           "Isa",  66),
    ("jeremiah",         "Jer",  52),
    ("lamentations",     "Lam",   5),
    ("ezekiel",          "Eze",  48),
    ("daniel",           "Dan",  12),
    ("hosea",            "Hos",  14),
    ("joel",             "Joe",   3),
    ("amos",             "Amo",   9),
    ("obadiah",          "Oba",   1),
    ("jonah",            "Jon",   4),
    ("micah",            "Mic",   7),
    ("nahum",            "Nah",   3),
    ("habakkuk",         "Hab",   3),
    ("zephaniah",        "Zep",   3),
    ("haggai",           "Hag",   2),
    ("zechariah",        "Zec",  14),
    ("malachi",          "Mal",   4),
    # ── New Testament ─────────────────────────────────────────────────────────
    ("matthew",          "Mat",  28),
    ("mark",             "Mar",  16),
    ("luke",             "Luk",  24),
    ("john",             "Joh",  21),
    ("acts",             "Act",  28),
    ("romans",           "Rom",  16),
    ("1_corinthians",    "1Co",  16),
    ("2_corinthians",    "2Co",  13),
    ("galatians",        "Gal",   6),
    ("ephesians",        "Eph",   6),
    ("philippians",      "Php",   4),
    ("colossians",       "Col",   4),
    ("1_thessalonians",  "1Th",   5),
    ("2_thessalonians",  "2Th",   3),
    ("1_timothy",        "1Ti",   6),
    ("2_timothy",        "2Ti",   4),
    ("titus",            "Tit",   3),
    ("philemon",         "Phm",   1),
    ("hebrews",          "Heb",  13),
    ("james",            "Jas",   5),
    ("1_peter",          "1Pe",   5),
    ("2_peter",          "2Pe",   3),
    ("1_john",           "1Jn",   5),
    ("2_john",           "2Jn",   1),
    ("3_john",           "3Jn",   1),
    ("jude",             "Jud",   1),
    ("revelation",       "Rev",  22),
]

BOOK_BY_SLUG   = {slug: abbrev for slug, abbrev, _ in BOOKS}
CHAPTERS_BY_SLUG = {slug: n for slug, _, n in BOOKS}
SLUG_BY_ABBREV = {abbrev: slug for slug, abbrev, _ in BOOKS}


# ── Database ──────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS bh_words (
    id        INTEGER PRIMARY KEY,
    book      TEXT    NOT NULL,   -- BibleHub slug (e.g. "john")
    chapter   INTEGER NOT NULL,
    verse     INTEGER NOT NULL,
    position  INTEGER NOT NULL,   -- 0-based word index within verse
    strongs   TEXT,               -- bare Strong's number (e.g. "1722"), NULL if G*
    greek     TEXT,               -- Greek word form from page
    english   TEXT,               -- English gloss with bracket markers stripped
    italic    INTEGER NOT NULL DEFAULT 0,  -- 1 = last content word is <span class="ital">
    greek_pos INTEGER               -- ABP bracket reorder number, NULL if not in a bracket group
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bh_pos  ON bh_words(book, chapter, verse, position);
CREATE        INDEX IF NOT EXISTS idx_bh_book ON bh_words(book, chapter);

CREATE TABLE IF NOT EXISTS bh_headings (
    id       INTEGER PRIMARY KEY,
    book     TEXT    NOT NULL,
    chapter  INTEGER NOT NULL,
    verse    INTEGER NOT NULL,   -- first verse of the section (heading precedes this verse)
    heading  TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bh_hdg ON bh_headings(book, chapter, verse);
"""

# Tracks which chapters were attempted (including failures) so --resume skips them.
PROGRESS_SCHEMA = """
CREATE TABLE IF NOT EXISTS bh_progress (
    book    TEXT    NOT NULL,
    chapter INTEGER NOT NULL,
    status  TEXT    NOT NULL,   -- 'ok', 'empty', 'error'
    words   INTEGER,
    PRIMARY KEY (book, chapter)
);
"""


def open_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA + PROGRESS_SCHEMA)
    return conn


def chapter_attempted(conn: sqlite3.Connection, book_slug: str, chapter: int) -> bool:
    return conn.execute(
        "SELECT 1 FROM bh_progress WHERE book=? AND chapter=?",
        (book_slug, chapter),
    ).fetchone() is not None


def insert_chapter(conn, book_slug, chapter, verse_words, headings):
    """
    verse_words: list of (verse_num, [(strongs, greek, english, italic), ...])
    headings:    list of (verse_num, heading_text)
    """
    rows = []
    for verse, words in verse_words:
        for pos, (strongs, greek, english, italic, greek_pos) in enumerate(words):
            rows.append((book_slug, chapter, verse, pos, strongs, greek, english, int(italic), greek_pos))

    conn.executemany(
        "INSERT OR IGNORE INTO bh_words"
        " (book, chapter, verse, position, strongs, greek, english, italic, greek_pos)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        rows,
    )
    if headings:
        conn.executemany(
            "INSERT OR IGNORE INTO bh_headings (book, chapter, verse, heading)"
            " VALUES (?,?,?,?)",
            [(book_slug, chapter, v, h) for v, h in headings],
        )
    total = len(rows)
    status = "ok" if total > 0 else "empty"
    conn.execute(
        "INSERT OR REPLACE INTO bh_progress (book, chapter, status, words) VALUES (?,?,?,?)",
        (book_slug, chapter, status, total),
    )
    conn.commit()
    return total


# ── HTTP ──────────────────────────────────────────────────────────────────────

def fetch_page(book_slug: str, chapter: int) -> str:
    url = BASE_URL.format(book=book_slug, chapter=chapter)
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.text


# ── Parsing ───────────────────────────────────────────────────────────────────

def _extract_greek_pos(eng_span) -> int | None:
    """Return the digit from <span class="num"> if present, else None."""
    for num in eng_span.find_all("span", class_="num"):
        text = num.get_text(strip=True)
        if text and text.isdigit():
            return int(text)
    return None


def _is_italic(eng_span) -> int:
    """
    Return 1 if the last content word in the English span is a translator addition.

    Walks children in reverse, skipping num spans and punctuation-only text.
    Only fires when the LAST content word is inside <span class="ital">, so a
    leading italic article ('the beginning') does not flag the whole word italic.
    """
    for child in reversed(list(eng_span.children)):
        if hasattr(child, "name"):
            if child.name == "span" and "num" in (child.get("class") or []):
                continue  # skip position-marker spacers
            text = child.get_text(strip=True)
            if re.sub(r"\W", "", text):  # has word characters
                return 1 if "ital" in (child.get("class") or []) else 0
        else:
            word_chars = re.sub(r"\W", "", str(child).replace("\xa0", ""))
            if word_chars:  # plain text with word characters → not italic
                return 0
    return 0


def _parse_word_cell(td) -> tuple | None:
    """
    Parse one word cell (<td height="95">) into
    (strongs, greek, english, italic, greek_pos).

    strongs:   ABP-style number string (e.g. "1722", "1510.7.3", "2222-1510.7.3")
               None for proper nouns (asterisk marker, no Strong's assigned)
    greek:     Greek word form (may be multiple words for compound strongs)
    english:   English gloss with bracket markers [ ] and num spans stripped
    italic:    1 if the last content word is inside <span class="ital">
    greek_pos: ABP bracket reorder number from <span class="num">, or None
    """
    # ── Strong's ──────────────────────────────────────────────────────────────
    strongs_span = td.find("span", class_="strongs")
    if not strongs_span:
        return None

    raw_strongs = strongs_span.get_text(strip=True)  # "1722", "*", "2222-1510.7.3"
    strongs = None if raw_strongs == "*" else raw_strongs

    # ── Greek ─────────────────────────────────────────────────────────────────
    greek_span = td.find("span", class_="greek")
    greek = greek_span.get_text(strip=True) if greek_span else None

    # ── English + italic + greek_pos ──────────────────────────────────────────
    eng_span = td.find("span", class_="eng")
    english   = None
    italic    = 0
    greek_pos = None
    if eng_span:
        greek_pos = _extract_greek_pos(eng_span)   # before decompose
        italic    = _is_italic(eng_span)            # before decompose
        for num in eng_span.find_all("span", class_="num"):
            num.decompose()
        english = re.sub(r"\s+", " ", eng_span.get_text(separator=" ", strip=True)) or None
        if english:
            # Strip ABP bracket display markers [ ] — they are positional UI, not gloss content
            english = re.sub(r"\[\s*|\]", "", english).strip() or None

    return strongs, greek, english, italic, greek_pos


def parse_page(html: str, book_slug: str, chapter: int) -> tuple[list, list]:
    """
    Parse one BibleHub ABP interlinear page.

    Returns:
        verse_words: list of (verse_num, [(strongs, greek, english, italic), ...])
        headings:    list of (verse_num, heading_text) — section title precedes that verse
    """
    soup = BeautifulSoup(html, "html.parser")
    verse_data: dict[int, list] = {}
    headings: list[tuple[int, str]] = []
    current_verse = 1
    pending_heading: str | None = None  # heading seen before we know the next verse num

    # Walk all relevant elements in document order: tablefloat word cells and hdg headings.
    # Both appear as descendants of the main content area; find_all preserves source order.
    targets = soup.find_all(
        lambda tag: (
            (tag.name == "table" and "tablefloat" in (tag.get("class") or []))
            or (tag.name == "div"  and "hdg"        in (tag.get("class") or []))
        )
    )

    for el in targets:
        if "hdg" in (el.get("class") or []):
            text = el.get_text(strip=True)
            if text:
                pending_heading = text
            continue

        # tablefloat word cell
        td = el.find("td")
        if not td:
            continue

        reftop = td.find("span", class_="reftop")
        if reftop:
            ref_text = reftop.get_text(strip=True)
            m = _VERSE_REF.match(ref_text)
            if m:
                current_verse = int(m.group(2))
                if pending_heading:
                    headings.append((current_verse, pending_heading))
                    pending_heading = None

        result = _parse_word_cell(td)
        if result is not None:
            verse_data.setdefault(current_verse, []).append(result)

    if not verse_data:
        print(f"  WARNING: 0 verses parsed for {book_slug} {chapter} — "
              "HTML structure may differ. Run --dump to inspect.", file=sys.stderr)

    return [(v, verse_data[v]) for v in sorted(verse_data)], headings


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_dump(book_slug: str, chapter: int) -> None:
    """Save raw HTML to file for inspection."""
    url = BASE_URL.format(book=book_slug, chapter=chapter)
    print(f"Fetching {url} ...")
    html = fetch_page(book_slug, chapter)
    out = Path(f"dump_{book_slug}_{chapter}.html")
    out.write_text(html, encoding="utf-8")
    print(f"Saved {len(html):,} bytes → {out}")
    print()
    print("Parser expects: <table class=\"tablefloat\"> per word, span.reftop for verse ref,")
    print("  span.strongs, span.greek, span.eng (with span.ital inside for italic words).")
    print("Run: python scripts/scrape_biblehub_abp.py --test", book_slug, chapter)


def cmd_test(book_slug: str, chapter: int) -> None:
    """Fetch and parse one chapter; print result for visual verification."""
    url = BASE_URL.format(book=book_slug, chapter=chapter)
    print(f"Fetching {url} ...")
    html = fetch_page(book_slug, chapter)
    results, headings = parse_page(html, book_slug, chapter)

    if not results:
        print()
        print("ERROR: parse returned 0 verses.")
        print("Run --dump to inspect the HTML.")
        return

    # Build heading lookup for display
    hdg_by_verse = {v: h for v, h in headings}

    # Print first 3 verses in full, then a summary
    shown = 0
    for verse_num, words in results:
        if verse_num in hdg_by_verse:
            print(f"\n  === {hdg_by_verse[verse_num]} ===")
        if shown < 3:
            print(f"\n  [{book_slug} {chapter}:{verse_num}]")
            for pos, (strongs, greek, english, italic, greek_pos) in enumerate(words):
                flag = "  <- ITALIC" if italic else ""
                gpos = f" [{greek_pos}]" if greek_pos is not None else ""
                g = (greek   or "(no greek)").encode(sys.stdout.encoding, errors="replace").decode(sys.stdout.encoding)
                e = (english or "(no english)").encode(sys.stdout.encoding, errors="replace").decode(sys.stdout.encoding)
                s = strongs or "(no strongs)"
                print(f"    {pos:2d}. G{s:<12}  {g:<22}  {e}{gpos}{flag}")
            shown += 1

    total_words  = sum(len(w) for _, w in results)
    italic_count = sum(1 for _, words in results for _, _, _, it, _ in words if it)
    print(f"\nSummary: {len(results)} verses, {total_words} words, {italic_count} italic")
    if headings:
        print(f"Headings ({len(headings)}): {', '.join(h for _, h in headings)}")
    if len(results) > 3:
        print(f"(showing first 3 of {len(results)} verses)")


def cmd_crawl(resume: bool = False) -> None:
    """Full crawl of all 66 books with rate limiting and resume support."""
    conn = open_db(DB_PATH)
    total_chapters = sum(n for _, _, n in BOOKS)
    done = skipped = errors = empty = 0

    print(f"Starting crawl: {len(BOOKS)} books, {total_chapters} chapters")
    print(f"Output: {DB_PATH}   Delay: {DELAY}s between requests")
    if resume:
        print("Mode: --resume (skipping already-attempted chapters)")
    print()

    for book_slug, abbrev, n_chapters in BOOKS:
        for chapter in range(1, n_chapters + 1):
            if resume and chapter_attempted(conn, book_slug, chapter):
                skipped += 1
                continue

            label = f"{abbrev} {chapter}/{n_chapters}"
            try:
                html              = fetch_page(book_slug, chapter)
                results, headings = parse_page(html, book_slug, chapter)
                n_words           = insert_chapter(conn, book_slug, chapter, results, headings)

                if n_words == 0:
                    print(f"  {label:<20} WARNING: 0 words parsed")
                    empty += 1
                else:
                    hdg_note = f"  [{len(headings)} headings]" if headings else ""
                    print(f"  {label:<20} {len(results):3d} verses  {n_words:5d} words{hdg_note}")
                done += 1

            except requests.HTTPError as e:
                print(f"  {label:<20} HTTP {e.response.status_code} — {e}")
                conn.execute(
                    "INSERT OR REPLACE INTO bh_progress (book, chapter, status, words)"
                    " VALUES (?,?,'error',0)",
                    (book_slug, chapter),
                )
                conn.commit()
                errors += 1

            except Exception as e:
                print(f"  {label:<20} ERROR: {e}")
                conn.execute(
                    "INSERT OR REPLACE INTO bh_progress (book, chapter, status, words)"
                    " VALUES (?,?,'error',0)",
                    (book_slug, chapter),
                )
                conn.commit()
                errors += 1

            time.sleep(DELAY)

    conn.close()
    print()
    print(f"Done: {done} chapters OK, {empty} empty, {skipped} skipped, {errors} errors")
    print(f"Database: {DB_PATH}")

    if errors:
        print()
        print("To retry errors:")
        print("  python scripts/scrape_biblehub_abp.py --retry-errors")


def cmd_retry_errors() -> None:
    """Re-scrape any chapters logged with status='error'."""
    conn = open_db(DB_PATH)
    errors = conn.execute(
        "SELECT book, chapter FROM bh_progress WHERE status='error' ORDER BY book, chapter"
    ).fetchall()

    if not errors:
        print("No errors to retry.")
        conn.close()
        return

    print(f"Retrying {len(errors)} errored chapters ...")
    fixed = still_failing = 0

    for book_slug, chapter in errors:
        try:
            html    = fetch_page(book_slug, chapter)
            results, headings = parse_page(html, book_slug, chapter)
            n_words = insert_chapter(conn, book_slug, chapter, results, headings)
            print(f"  {book_slug} {chapter}: {n_words} words")
            fixed += 1
        except Exception as e:
            print(f"  {book_slug} {chapter}: still failing — {e}")
            still_failing += 1
        time.sleep(DELAY)

    conn.close()
    print(f"Fixed: {fixed}, still failing: {still_failing}")


def cmd_stats() -> None:
    """Print scrape coverage stats from bh_scrape.db."""
    if not Path(DB_PATH).exists():
        print(f"{DB_PATH} not found. Run the crawl first.")
        return
    conn = open_db(DB_PATH)
    total_words = conn.execute("SELECT COUNT(*) FROM bh_words").fetchone()[0]
    total_chapters = conn.execute(
        "SELECT COUNT(*) FROM bh_progress WHERE status='ok'"
    ).fetchone()[0]
    errors = conn.execute(
        "SELECT book, chapter FROM bh_progress WHERE status='error'"
    ).fetchall()
    italic = conn.execute(
        "SELECT COUNT(*) FROM bh_words WHERE italic=1"
    ).fetchone()[0]
    conn.close()

    print(f"bh_scrape.db stats:")
    print(f"  Chapters scraped: {total_chapters}")
    print(f"  Total words:      {total_words:,}")
    print(f"  Italic words:     {italic:,}")
    if errors:
        print(f"  Errors:           {len(errors)}")
        for b, c in errors[:10]:
            print(f"    {b} {c}")
        if len(errors) > 10:
            print(f"    ... and {len(errors)-10} more")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Scrape BibleHub ABP interlinear into bh_scrape.db",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/scrape_biblehub_abp.py --dump john 1
  python scripts/scrape_biblehub_abp.py --test john 1
  python scripts/scrape_biblehub_abp.py
  python scripts/scrape_biblehub_abp.py --resume
  python scripts/scrape_biblehub_abp.py --stats
        """,
    )
    ap.add_argument("--dump",  nargs=2, metavar=("BOOK", "CH"),
                    help="Save raw HTML for selector inspection")
    ap.add_argument("--test",  nargs=2, metavar=("BOOK", "CH"),
                    help="Parse one chapter and print result")
    ap.add_argument("--resume", action="store_true",
                    help="Skip chapters already logged in bh_progress")
    ap.add_argument("--retry-errors", action="store_true",
                    help="Re-scrape chapters that errored on last run")
    ap.add_argument("--stats", action="store_true",
                    help="Print coverage stats from bh_scrape.db")
    args = ap.parse_args()

    if args.dump:
        cmd_dump(args.dump[0], int(args.dump[1]))
    elif args.test:
        cmd_test(args.test[0], int(args.test[1]))
    elif args.retry_errors:
        cmd_retry_errors()
    elif args.stats:
        cmd_stats()
    else:
        cmd_crawl(resume=args.resume)


if __name__ == "__main__":
    main()
