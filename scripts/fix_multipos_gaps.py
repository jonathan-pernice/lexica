#!/usr/bin/env python3
"""
fix_multipos_gaps.py — Fix bracket gaps from multi-position BH word cells.

Some BibleHub word cells carry TWO <span class="num"> tags (e.g. "1Let 3cheat"):
one Greek word covers two reorder slots.  The scraper only captured the first
slot, leaving a gap at the second.

This script:
  1. Finds all remaining skip-type bracket gaps in bible.db.
  2. Groups them by chapter and fetches each BH page once.
  3. Locates the multi-position word cells (2+ digit span.num per cell).
  4. Inserts the missing words into both bh_scrape.db and bible.db.

Usage (run on PythonAnywhere):
    python3 scripts/fix_multipos_gaps.py [bible.db] [bh_scrape.db] [--dry-run]
"""

import re
import sys
import time
import sqlite3

import requests
from bs4 import BeautifulSoup

DRY_RUN = "--dry-run" in sys.argv
args    = [a for a in sys.argv[1:] if not a.startswith("--")]
DB      = args[0] if len(args) >= 1 else "bible.db"
BH_DB   = args[1] if len(args) >= 2 else "bh_scrape.db"

print(f"{'[DRY RUN] ' if DRY_RUN else ''}fix_multipos_gaps.py")
print(f"  bible.db  : {DB}")
print(f"  bh_scrape : {BH_DB}\n")

BASE_URL = "https://biblehub.com/interlinear/apostolic/{book}/{chapter}.htm"
DELAY    = 2.0
HEADERS  = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

BH_BOOK = {
    "Gen":"genesis","Exo":"exodus","Lev":"leviticus","Num":"numbers","Deu":"deuteronomy",
    "Jos":"joshua","Jdg":"judges","Rth":"ruth","1Sa":"1_samuel","2Sa":"2_samuel",
    "1Ki":"1_kings","2Ki":"2_kings","1Ch":"1_chronicles","2Ch":"2_chronicles",
    "Ezr":"ezra","Neh":"nehemiah","Est":"esther","Job":"job","Psa":"psalms",
    "Pro":"proverbs","Ecc":"ecclesiastes","Sol":"songs","Isa":"isaiah",
    "Jer":"jeremiah","Lam":"lamentations","Eze":"ezekiel","Dan":"daniel",
    "Hos":"hosea","Joe":"joel","Amo":"amos","Oba":"obadiah","Jon":"jonah",
    "Mic":"micah","Nah":"nahum","Hab":"habakkuk","Zep":"zephaniah",
    "Hag":"haggai","Zec":"zechariah","Mal":"malachi",
    "Mat":"matthew","Mar":"mark","Luk":"luke","Joh":"john","Act":"acts",
    "Rom":"romans","1Co":"1_corinthians","2Co":"2_corinthians","Gal":"galatians",
    "Eph":"ephesians","Php":"philippians","Col":"colossians",
    "1Th":"1_thessalonians","2Th":"2_thessalonians","1Ti":"1_timothy","2Ti":"2_timothy",
    "Tit":"titus","Phm":"philemon","Heb":"hebrews","Jas":"james",
    "1Pe":"1_peter","2Pe":"2_peter","1Jo":"1_john","2Jo":"2_john","3Jo":"3_john",
    "Jud":"jude","Rev":"revelation",
}

_VERSE_REF = re.compile(r"^(\d+):(\d+)$")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _base(s):
    if s is None:
        return "*"
    return "G" + re.match(r"(\d+)", s).group(1) if re.match(r"\d", s) else s


def _head_word(english):
    if not english:
        return None
    m = re.match(r"^([^\s,;:!?.]+)", english)
    return m.group(1) if m else None


# ── Parse a BH chapter page → {verse: [(strongs, greek, multi_pos_map)]}
# where multi_pos_map = {gpos: english_segment} for cells with 2+ positions,
# or {gpos: english} for normal cells.

def _seg_from_eng_span(eng_span):
    """
    Return {gpos: english_segment} from one span.eng.
    For cells with a single digit num, returns {gpos: full_english}.
    For cells with multiple digit nums, returns one entry per num.
    For cells with no digit num, returns {None: full_english}.
    """
    # Collect digit num spans in order, recording their text positions
    num_tags = []
    for tag in eng_span.find_all("span", class_="num"):
        t = tag.get_text(strip=True)
        if t and t.isdigit():
            num_tags.append((tag, int(t)))

    if not num_tags:
        # No reorder number — plain cell
        text = re.sub(r"\s+", " ", eng_span.get_text(strip=True))
        text = re.sub(r"\[\s*|\]", "", text).strip() or None
        return {None: text}

    if len(num_tags) == 1:
        # Normal single-position cell
        gpos = num_tags[0][1]
        for tag, _ in num_tags:
            tag.decompose()
        text = re.sub(r"\s+", " ", eng_span.get_text(separator=" ", strip=True))
        text = re.sub(r"\[\s*|\]", "", text).strip() or None
        return {gpos: text}

    # Multi-position cell: extract text segment between each pair of num spans
    # Walk children in order, collecting text under each num tag's section.
    result = {}
    current_gpos = None
    current_parts = []

    def _flush():
        if current_gpos is not None:
            seg = " ".join(current_parts).strip()
            seg = re.sub(r"\s+", " ", seg)
            seg = re.sub(r"\[\s*|\]", "", seg).strip() or None
            result[current_gpos] = seg

    num_set = {id(t): gp for t, gp in num_tags}

    for child in eng_span.children:
        if hasattr(child, "name") and child.name == "span":
            cls = child.get("class") or []
            if "num" in cls:
                t = child.get_text(strip=True)
                if t and t.isdigit():
                    _flush()
                    current_gpos = int(t)
                    current_parts = []
                    continue
                # else: &nbsp; spacer — ignore
            elif "ital" in cls:
                current_parts.append(child.get_text(strip=True))
        else:
            # NavigableString
            s = str(child).strip()
            if s:
                current_parts.append(s)

    _flush()
    return result


def parse_chapter(html, bh_book, chapter):
    """
    Parse a BH chapter page.
    Returns {verse_num: [{strongs, greek, segments, italic_words}]}
    segments = {gpos: english_text}
    """
    soup = BeautifulSoup(html, "html.parser")
    verse_data = {}
    current_verse = 1

    for el in soup.find_all(
        lambda tag: tag.name == "table" and "tablefloat" in (tag.get("class") or [])
    ):
        td = el.find("td")
        if not td:
            continue
        reftop = td.find("span", class_="reftop")
        if reftop:
            m = _VERSE_REF.match(reftop.get_text(strip=True))
            if m:
                current_verse = int(m.group(2))

        strongs_span = td.find("span", class_="strongs")
        if not strongs_span:
            continue
        raw_s = strongs_span.get_text(strip=True)
        strongs = None if raw_s == "*" else raw_s

        greek_span = td.find("span", class_="greek")
        greek = greek_span.get_text(strip=True) if greek_span else None

        eng_span = td.find("span", class_="eng")
        if not eng_span:
            continue

        italic_words = ""
        for ital in eng_span.find_all("span", class_="ital"):
            italic_words += ital.get_text(strip=True).lower() + ","

        segments = _seg_from_eng_span(eng_span)

        verse_data.setdefault(current_verse, []).append({
            "strongs": strongs,
            "greek": greek,
            "segments": segments,
            "italic_words": italic_words.rstrip(","),
        })

    return verse_data


# ── Database connections ──────────────────────────────────────────────────────

main = sqlite3.connect(DB)
main.row_factory = sqlite3.Row
bh   = sqlite3.connect(BH_DB)
bh.row_factory = sqlite3.Row

# ── Find all remaining skip-type gaps ─────────────────────────────────────────

gap_rows = main.execute("""
    WITH stats AS (
      SELECT verse_id, bracket_id,
        COUNT(*) as cnt, MAX(greek_pos) as max_pos
      FROM words
      WHERE bracket_id IS NOT NULL AND greek_pos IS NOT NULL
      GROUP BY verse_id, bracket_id
    )
    SELECT v.book, v.chapter, v.verse, s.bracket_id,
           s.cnt, s.max_pos, v.id as verse_id
    FROM stats s
    JOIN verses v ON v.id = s.verse_id
    WHERE s.max_pos != s.cnt
    ORDER BY v.book, v.chapter, v.verse
""").fetchall()

# Filter to skip-type only (verse has bh_scrape data but missing greek_pos)
skip_gaps = []
for gv in gap_rows:
    book, ch, vs = gv["book"], gv["chapter"], gv["verse"]
    bid, verse_id = gv["bracket_id"], gv["verse_id"]
    bh_book = BH_BOOK.get(book, book.lower())

    cur = {r["greek_pos"] for r in main.execute(
        "SELECT greek_pos FROM words WHERE verse_id=? AND bracket_id=? AND greek_pos IS NOT NULL",
        (verse_id, bid)
    )}
    missing = sorted(set(range(1, gv["max_pos"] + 1)) - cur)
    if not missing:
        continue

    bh_all = bh.execute(
        "SELECT 1 FROM bh_words WHERE book=? AND chapter=? AND verse=? LIMIT 1",
        (bh_book, ch, vs)
    ).fetchone()
    if not bh_all:
        continue  # no_data type — skip

    skip_gaps.append((book, ch, vs, bid, verse_id, missing))

print(f"Skip-type gaps to fix: {len(skip_gaps)} missing slots across "
      f"{len({(b,c) for b,c,v,bid,vid,m in skip_gaps})} chapters\n")

# ── Group gaps by chapter and fetch pages ─────────────────────────────────────

chapters_needed = {}
for book, ch, vs, bid, verse_id, missing in skip_gaps:
    bh_book = BH_BOOK.get(book, book.lower())
    chapters_needed.setdefault((bh_book, ch), []).append((book, vs, bid, verse_id, missing))

inserted_total = 0
skipped_total  = 0
page_cache     = {}

for (bh_book, chapter), verse_list in sorted(chapters_needed.items()):
    key = (bh_book, chapter)
    if key not in page_cache:
        url = BASE_URL.format(book=bh_book, chapter=chapter)
        print(f"  Fetching {url} …", end=" ", flush=True)
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            page_cache[key] = parse_chapter(resp.text, bh_book, chapter)
            n_words = sum(len(v) for v in page_cache[key].values())
            print(f"{n_words} words")
        except Exception as e:
            print(f"ERROR: {e}")
            page_cache[key] = {}
        time.sleep(DELAY)

    verse_data = page_cache[key]

    for book, vs, bid, verse_id, missing in verse_list:
        cells = verse_data.get(vs, [])
        if not cells:
            print(f"  WARN: {book} {chapter}:{vs} — no verse data parsed")
            continue

        # Find multi-position cells (segments with 2+ entries having non-None keys)
        multi_cells = [
            c for c in cells
            if sum(1 for k in c["segments"] if k is not None) >= 2
        ]

        if not multi_cells:
            print(f"  SKIP {book} {chapter}:{vs} bid={bid} missing={missing}: "
                  f"no multi-pos cells found in HTML")
            skipped_total += len(missing)
            continue

        # Get current bible.db words for this verse (for position mapping)
        bible_words = main.execute("""
            SELECT rowid AS wid, position, strongs_base, bracket_id, greek_pos
            FROM words WHERE verse_id=? ORDER BY position
        """, (verse_id,)).fetchall()

        # Map greek_pos → set of bracket_ids that already have it, for overlap detection
        existing_gpos_bids = {}
        for bw in bible_words:
            if bw["bracket_id"] is not None and bw["greek_pos"] is not None:
                existing_gpos_bids.setdefault(bw["greek_pos"], set()).add(bw["bracket_id"])

        for miss_gpos in missing:
            # Skip overlap-type gaps: gpos already exists in another bracket_id.
            # These are fragmentation artifacts that need a merge, not an insert.
            if miss_gpos in existing_gpos_bids and bid not in existing_gpos_bids[miss_gpos]:
                print(f"  OVERLAP {book} {chapter}:{vs} bid={bid} gpos={miss_gpos}: "
                      f"already in bid={existing_gpos_bids[miss_gpos]} — skipping")
                skipped_total += 1
                continue

            # Find which multi-position cell covers the missing gpos
            source_cell = None
            for mc in multi_cells:
                if miss_gpos in mc["segments"]:
                    source_cell = mc
                    break

            if source_cell is None:
                print(f"  SKIP {book} {chapter}:{vs} bid={bid} gpos={miss_gpos}: "
                      f"multi-pos cell doesn't cover this gpos")
                skipped_total += 1
                continue

            english   = source_cell["segments"][miss_gpos]
            raw_s     = source_cell["strongs"] or ""
            first_num = re.match(r"(\d+)", raw_s)
            strongs_b = f"G{int(first_num.group(1))}" if first_num else "*"
            italic    = 1 if english and english.lower() in source_cell["italic_words"] else 0

            # Find the primary gpos entry for this cell in bible.db to anchor insertion
            primary_gpos = min(k for k in source_cell["segments"] if k is not None and k != miss_gpos)

            anchor_word = None
            for bw in bible_words:
                if bw["strongs_base"] == strongs_b and bw["greek_pos"] == primary_gpos and bw["bracket_id"] == bid:
                    anchor_word = bw
                    break
            # Fallback: any word in the bracket with the primary gpos
            if not anchor_word:
                for bw in bible_words:
                    if bw["greek_pos"] == primary_gpos and bw["bracket_id"] == bid:
                        anchor_word = bw
                        break

            after = anchor_word["position"] if anchor_word else (
                max(bw["position"] for bw in bible_words if bw["bracket_id"] == bid)
            )

            if DRY_RUN:
                print(f"  {book} {chapter}:{vs} bid={bid} gpos={miss_gpos}: "
                      f"insert '{english}' ({strongs_b}) after pos={after}")
                inserted_total += 1
                continue

            # Shift words after insertion point
            main.execute(
                "UPDATE words SET position=position+1 WHERE verse_id=? AND position > ?",
                (verse_id, after)
            )
            new_pos = after + 1
            main.execute("""
                INSERT INTO words
                  (verse_id, position, english, greek_pos, strongs_base, strongs,
                   bracket_id, is_pn, italic_words, smcap_words)
                VALUES (?,?,?,?,?,?,?,0,'','')
            """, (verse_id, new_pos, english, miss_gpos, strongs_b, strongs_b, bid))

            # Refresh bible_words for subsequent misses in same verse
            bible_words = main.execute("""
                SELECT rowid AS wid, position, strongs_base, bracket_id, greek_pos
                FROM words WHERE verse_id=? ORDER BY position
            """, (verse_id,)).fetchall()

            inserted_total += 1
            print(f"  + {book} {chapter}:{vs} bid={bid} gpos={miss_gpos}: "
                  f"'{english}' ({strongs_b}) at pos={new_pos}")

if not DRY_RUN:
    main.commit()

print(f"\nInserted : {inserted_total}")
print(f"Skipped  : {skipped_total}")
if DRY_RUN:
    print("[DRY RUN] No changes written.")

main.close()
bh.close()
