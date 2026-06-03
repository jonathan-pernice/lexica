#!/usr/bin/env python3
"""
fix_bracket_gaps.py — Find bracket groups with greek_pos gaps and patch from bh_scrape.db

Usage:
  python3 scripts/fix_bracket_gaps.py bible.db bh_scrape.db --dry-run
  python3 scripts/fix_bracket_gaps.py bible.db bh_scrape.db
"""

import re
import sys
import sqlite3

DB      = "bible.db"
BH_DB   = "bh_scrape.db"
DRY_RUN = "--dry-run" in sys.argv

args = [a for a in sys.argv[1:] if not a.startswith("--")]
if len(args) >= 1: DB     = args[0]
if len(args) >= 2: BH_DB  = args[1]

print(f"{'[DRY RUN] ' if DRY_RUN else ''}fix_bracket_gaps.py")
print(f"  bible.db  : {DB}")
print(f"  bh_scrape : {BH_DB}\n")

# bh_scrape.db uses full lowercase names; bible.db uses ABP abbreviations
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

def norm_strongs(s):
    """Normalize strongs for matching: 'G1473', '1473', '1473-1510', '1510.2.3' → '1473'"""
    if not s:
        return None
    s = str(s).strip()
    # Strip G/H prefix
    s = re.sub(r'^[GH]', '', s)
    # Take first number before - or .
    m = re.match(r'(\d+)', s)
    return m.group(1) if m else None


def build_bh_to_bible_map(bh_words, bible_words):
    """
    Build a mapping from bh_pos → bible_pos by matching words that appear in both.
    Strategy: match bracketed bh_words (those with greek_pos) to bible_words
    by strongs and verse order.
    """
    bh_to_bible = {}
    used_bible = set()

    # Match only bracketed bh_words to avoid noise
    bh_bracketed = [w for w in bh_words if w["greek_pos"] is not None]

    for bh_w in bh_bracketed:
        bh_norm = norm_strongs(bh_w["strongs"])
        if not bh_norm:
            continue
        # Find first unmatched bible word with same strongs after any previous match
        min_bible_pos = max((bh_to_bible[p] for p in bh_to_bible if p < bh_w["position"]),
                            default=-1)
        for bib_w in bible_words:
            if bib_w["position"] <= min_bible_pos:
                continue
            if bib_w["rowid"] in used_bible:
                continue
            bib_norm = norm_strongs(bib_w["strongs_base"])
            if bib_norm == bh_norm:
                bh_to_bible[bh_w["position"]] = bib_w["position"]
                used_bible.add(bib_w["rowid"])
                break

    return bh_to_bible


def insert_after_pos(bh_w, bh_words, bh_to_bible, bible_words):
    """
    Determine which bible_pos the new word should be inserted AFTER.
    Looks for the nearest preceding bh_word that has a bible_pos mapping.
    """
    bh_pos = bh_w["position"]
    # Walk backward from bh_pos to find the last mapped word
    for candidate_bh_pos in sorted((p for p in bh_to_bible if p < bh_pos), reverse=True):
        return bh_to_bible[candidate_bh_pos]
    # If nothing before, insert at position -1 (before all words)
    return -1


main_conn = sqlite3.connect(DB)
main_conn.row_factory = sqlite3.Row
bh_conn   = sqlite3.connect(BH_DB)
bh_conn.row_factory = sqlite3.Row

# ── Find all gap bracket groups ───────────────────────────────────────────────
gap_verses = main_conn.execute("""
    WITH stats AS (
      SELECT verse_id, bracket_id,
        COUNT(*) as cnt,
        MAX(greek_pos) as max_pos
      FROM words
      WHERE bracket_id IS NOT NULL AND greek_pos IS NOT NULL
      GROUP BY verse_id, bracket_id
    )
    SELECT v.book, v.chapter, v.verse, s.bracket_id,
           s.cnt, s.max_pos, (s.max_pos - s.cnt) as gap, v.id as verse_id
    FROM stats s
    JOIN verses v ON v.id = s.verse_id
    WHERE s.max_pos != s.cnt
    ORDER BY gap DESC, v.book, v.chapter, v.verse
""").fetchall()

print(f"{len(gap_verses)} bracket groups with gaps\n")

inserted_total  = 0
skipped_total   = 0
no_data_total   = 0

for gv in gap_verses:
    book, ch, vs  = gv["book"], gv["chapter"], gv["verse"]
    bid           = gv["bracket_id"]
    verse_id      = gv["verse_id"]
    bh_book       = BH_BOOK.get(book, book.lower())

    # Current bracket words → find missing greek_pos values
    cur_bracket = main_conn.execute("""
        SELECT greek_pos FROM words
        WHERE verse_id=? AND bracket_id=? AND greek_pos IS NOT NULL
    """, (verse_id, bid)).fetchall()
    have = {r["greek_pos"] for r in cur_bracket}
    missing = sorted(set(range(1, gv["max_pos"] + 1)) - have)
    if not missing:
        continue

    # Get bh_words for this verse
    bh_all = bh_conn.execute("""
        SELECT position, english, greek_pos, strongs, smcap_words, italic_words
        FROM bh_words WHERE book=? AND chapter=? AND verse=? ORDER BY position
    """, (bh_book, ch, vs)).fetchall()

    if not bh_all:
        no_data_total += len(missing)
        continue

    # Get all bible words for this verse (for position mapping)
    bible_all = main_conn.execute("""
        SELECT rowid, position, english, strongs_base, bracket_id, greek_pos
        FROM words WHERE verse_id=? ORDER BY position
    """, (verse_id,)).fetchall()

    # Build bh_pos → bible_pos map
    bh_to_bible = build_bh_to_bible_map(bh_all, bible_all)

    for miss_gpos in missing:
        # Find bh_words row with this greek_pos that's NOT already imported
        candidates = [w for w in bh_all if w["greek_pos"] == miss_gpos]
        if not candidates:
            print(f"  SKIP {book} {ch}:{vs} bid={bid} gpos={miss_gpos}: not in bh_scrape")
            skipped_total += 1
            continue

        # Pick the one not yet mapped (to handle duplicates across brackets)
        bh_w = None
        for c in candidates:
            if c["position"] not in bh_to_bible:
                bh_w = c
                break
        if not bh_w:
            bh_w = candidates[0]

        # Determine insertion position
        after = insert_after_pos(bh_w, bh_all, bh_to_bible, bible_all)

        # Normalize strongs: bare number → G-prefixed
        raw = bh_w["strongs"] or ""
        first_num = re.match(r"(\d+)", raw)
        strongs_b = f"G{int(first_num.group(1))}" if first_num else None

        if DRY_RUN:
            print(f"  {book} {ch}:{vs} bid={bid} gpos={miss_gpos}: "
                  f"insert '{bh_w['english']}' ({strongs_b}) after bible_pos={after}")
            inserted_total += 1
            # Update map so subsequent missing positions in same verse work
            bh_to_bible[bh_w["position"]] = after + 1
            continue

        # Shift words after insertion point
        main_conn.execute("""
            UPDATE words SET position=position+1
            WHERE verse_id=? AND position > ?
        """, (verse_id, after))

        new_pos = after + 1
        main_conn.execute("""
            INSERT INTO words
              (verse_id, position, english, greek_pos, strongs_base, strongs,
               bracket_id, is_pn, italic_words, smcap_words)
            VALUES (?,?,?,?,?,?,?,0,?,?)
        """, (verse_id, new_pos, bh_w["english"], miss_gpos,
              strongs_b, strongs_b, bid,
              bh_w["italic_words"], bh_w["smcap_words"]))

        # Update map
        bh_to_bible[bh_w["position"]] = new_pos
        # Rebuild bible_all to reflect shifts
        bible_all = main_conn.execute("""
            SELECT rowid, position, english, strongs_base, bracket_id, greek_pos
            FROM words WHERE verse_id=? ORDER BY position
        """, (verse_id,)).fetchall()

        inserted_total += 1

if not DRY_RUN:
    main_conn.commit()

print(f"\nInserted : {inserted_total}")
print(f"Skipped  : {skipped_total}  (not in bh_scrape by greek_pos)")
print(f"No data  : {no_data_total}  (verse not in bh_scrape at all)")
if DRY_RUN:
    print("\n[DRY RUN] No changes written.")

main_conn.close()
bh_conn.close()
