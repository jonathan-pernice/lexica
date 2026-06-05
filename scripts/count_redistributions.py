#!/usr/bin/env python3
"""count_redistributions.py — READ-ONLY footprint of NON-bracket gloss-splitting.

Replays the words-build pipeline IN MEMORY (no DB writes) and counts how many
empty Greek slots get filled by `_split_compounds` redistributing a word out of a
conjoined gloss — e.g. "God made" on G4160 (ποιέω) → "God" moved onto the empty
θεός/G2316 slot. After the 2026-06-05 fix `_split_compounds` skips bracketed slots,
so this count is entirely NON-bracket (the reconstruction we deliberately keep).

Reuses build_words_from_abp's own parser + lexicon, so it can't drift from the build.
Opens bible.db / bh_scrape.db read-only. Writes nothing.

Run on PA:  python3 scripts/count_redistributions.py bible.db bh_scrape.db
"""
import sqlite3
import sys

import build_words_from_abp as B

args = [a for a in sys.argv[1:] if not a.startswith("-")]
bible_db  = args[0] if len(args) > 0 else "bible.db"
scrape_db = args[1] if len(args) > 1 else "bh_scrape.db"

conn = sqlite3.connect(f"file:{bible_db}?mode=ro", uri=True)
lex = B.load_lexicon(conn)
conn.close()
sc = sqlite3.connect(f"file:{scrape_db}?mode=ro", uri=True)
bh = B.load_bh_verse_index(sc)
sc.close()


def nonempty_real(rows):
    """Count slots with a real Strong's that currently carry English."""
    return sum(1 for r in rows
               if (r[1] or "").strip() and r[4] and r[4] not in ("*", ""))


# Wrap _split_compounds: a slot that was empty and becomes filled = a redistribution
# target. We measure the per-verse net gain in non-empty real-Strong's slots, which
# equals the number of redistributed words (a fully-emptied head can offset by 1 in
# rare cases, so this is a close lower bound). Re-uses the REAL function → no drift.
_orig = B._split_compounds
tot = {"slots": 0, "verses": 0}


def _counting(rows, lex):
    before = nonempty_real(rows)
    _orig(rows, lex)
    gained = nonempty_real(rows) - before
    if gained > 0:
        tot["slots"] += gained
        tot["verses"] += 1


B._split_compounds = _counting

verses = 0
for abbrev, ch, vs, words in B.iter_verses(*B._abp_sources()):
    slug = B.ABBREV_TO_SLUG.get(abbrev)
    bh_rows = bh.get((slug, ch, vs), []) if slug else []
    B.build_verse_words(words, bh_rows, lex)
    verses += 1

print(f"READ-ONLY redistribution footprint  (db={bible_db})")
print(f"  verses replayed                                : {verses:,}")
print(f"  NON-bracket slots filled by redistribution (net): {tot['slots']:,}")
print(f"  verses with at least one split                  : {tot['verses']:,}")
print()
print("  All non-bracket (the fix made _split_compounds skip brackets). 'net' because")
print("  a rare fully-emptied head can offset the tally by 1. Pronoun corrections are")
print("  NOT applied here (negligible effect on the split count).")
