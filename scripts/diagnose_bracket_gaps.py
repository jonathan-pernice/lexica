#!/usr/bin/env python3
"""
diagnose_bracket_gaps.py — Classify remaining bracket gaps

Shows why each gap can't be fixed by fix_bracket_gaps.py:
  - no_data : verse has ZERO rows in bh_scrape.db (verse missing entirely)
  - skip    : verse has rows but no word with the needed greek_pos
  - overlap : the needed greek_pos exists in bh_scrape.db but is already
              assigned to a DIFFERENT bracket_id in bible.db (fragmentation)

Usage:
    python3 scripts/diagnose_bracket_gaps.py [bible.db] [bh_scrape.db]
"""

import re
import sys
import sqlite3

DB    = "bible.db"
BH_DB = "bh_scrape.db"

args = [a for a in sys.argv[1:] if not a.startswith("--")]
if len(args) >= 1: DB    = args[0]
if len(args) >= 2: BH_DB = args[1]

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

main = sqlite3.connect(DB)
main.row_factory = sqlite3.Row
bh   = sqlite3.connect(BH_DB)
bh.row_factory = sqlite3.Row

# ── Find all remaining gap groups ─────────────────────────────────────────────
gap_verses = main.execute("""
    WITH stats AS (
      SELECT verse_id, bracket_id,
        COUNT(*) as cnt, MAX(greek_pos) as max_pos
      FROM words
      WHERE bracket_id IS NOT NULL AND greek_pos IS NOT NULL
      GROUP BY verse_id, bracket_id
    )
    SELECT v.book, v.chapter, v.verse, s.bracket_id,
           s.cnt, s.max_pos, (s.max_pos - s.cnt) as gap, v.id as verse_id
    FROM stats s
    JOIN verses v ON v.id = s.verse_id
    WHERE s.max_pos != s.cnt
    ORDER BY v.book, v.chapter, v.verse
""").fetchall()

print(f"Total gap groups: {len(gap_verses)}\n")

# ── Per-group classification ───────────────────────────────────────────────────
no_data_count   = 0  # verse absent from bh_scrape entirely
skip_count      = 0  # verse present but greek_pos not found
overlap_count   = 0  # greek_pos found but word already in bible.db under different bid

by_book_no_data  = {}
by_book_skip     = {}
by_book_overlap  = {}

samples = {"no_data": [], "skip": [], "overlap": []}

for gv in gap_verses:
    book, ch, vs  = gv["book"], gv["chapter"], gv["verse"]
    bid           = gv["bracket_id"]
    verse_id      = gv["verse_id"]
    bh_book       = BH_BOOK.get(book, book.lower())

    cur_bracket = main.execute("""
        SELECT greek_pos FROM words
        WHERE verse_id=? AND bracket_id=? AND greek_pos IS NOT NULL
    """, (verse_id, bid)).fetchall()
    have = {r["greek_pos"] for r in cur_bracket}
    missing = sorted(set(range(1, gv["max_pos"] + 1)) - have)
    if not missing:
        continue

    bh_all = bh.execute("""
        SELECT position, english, greek_pos, strongs
        FROM bh_words WHERE book=? AND chapter=? AND verse=?
        ORDER BY position
    """, (bh_book, ch, vs)).fetchall()

    if not bh_all:
        no_data_count += len(missing)
        by_book_no_data[book] = by_book_no_data.get(book, 0) + len(missing)
        if len(samples["no_data"]) < 5:
            samples["no_data"].append(
                f"  {book} {ch}:{vs} bid={bid} missing={missing}  (no rows in bh_scrape)"
            )
        continue

    # Check each missing greek_pos
    bh_by_gpos = {}
    for w in bh_all:
        if w["greek_pos"] is not None:
            bh_by_gpos.setdefault(w["greek_pos"], []).append(w)

    # Also check which bible.db words already have each greek_pos (for overlap detection)
    all_bible_gpos = main.execute("""
        SELECT greek_pos, bracket_id FROM words
        WHERE verse_id=? AND greek_pos IS NOT NULL
    """, (verse_id,)).fetchall()
    bible_gpos_bids = {}
    for r in all_bible_gpos:
        bible_gpos_bids.setdefault(r["greek_pos"], set()).add(r["bracket_id"])

    for mg in missing:
        if mg not in bh_by_gpos:
            skip_count += 1
            by_book_skip[book] = by_book_skip.get(book, 0) + 1
            if len(samples["skip"]) < 8:
                bh_gpos_present = sorted(bh_by_gpos.keys())
                samples["skip"].append(
                    f"  {book} {ch}:{vs} bid={bid} missing gpos={mg} | "
                    f"bh has gpos={bh_gpos_present}"
                )
        else:
            # bh_scrape HAS it — check if it's already in bible.db under a different bid
            if mg in bible_gpos_bids and bid not in bible_gpos_bids[mg]:
                overlap_count += 1
                by_book_overlap[book] = by_book_overlap.get(book, 0) + 1
                if len(samples["overlap"]) < 5:
                    other_bids = bible_gpos_bids[mg] - {bid}
                    samples["overlap"].append(
                        f"  {book} {ch}:{vs} bid={bid} missing gpos={mg} | "
                        f"exists in bid(s)={other_bids} (fragmentation)"
                    )
            else:
                # This should be fixable — why wasn't it fixed?
                skip_count += 1
                by_book_skip[book] = by_book_skip.get(book, 0) + 1
                if len(samples["skip"]) < 8:
                    samples["skip"].append(
                        f"  {book} {ch}:{vs} bid={bid} missing gpos={mg} | "
                        f"bh HAS it but wasn't inserted? (check)"
                    )

# ── Summary ───────────────────────────────────────────────────────────────────
total = no_data_count + skip_count + overlap_count
print(f"=== Gap classification (total missing word-slots: {total}) ===\n")
print(f"  no_data  {no_data_count:4d}  verse entirely absent from bh_scrape")
print(f"  skip     {skip_count:4d}  verse present but specific greek_pos missing in bh_scrape")
print(f"  overlap  {overlap_count:4d}  greek_pos exists in bh_scrape, already in bible.db under diff bracket_id (fragmentation)\n")

for label, sample_list in samples.items():
    if sample_list:
        print(f"--- Sample '{label}' ---")
        for s in sample_list:
            print(s)
        print()

print("\n=== no_data by book ===")
for book, cnt in sorted(by_book_no_data.items(), key=lambda x: -x[1]):
    print(f"  {book:4s}  {cnt}")

print("\n=== skip by book ===")
for book, cnt in sorted(by_book_skip.items(), key=lambda x: -x[1]):
    print(f"  {book:4s}  {cnt}")

print("\n=== overlap by book ===")
for book, cnt in sorted(by_book_overlap.items(), key=lambda x: -x[1]):
    print(f"  {book:4s}  {cnt}")

main.close()
bh.close()
