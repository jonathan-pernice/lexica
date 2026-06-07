#!/usr/bin/env python3
"""
fix_article_noun_swaps.py — repair 3 verses where a real word's Greek tag landed
on the article ὁ/G3588 (and vice-versa), so clicking the word showed "the".

Each fix swaps ONLY the Greek identity (strongs_base, strongs, is_pn) between two
positions in one verse. The English text stays exactly where it is, so the verse
reads identically — only the tag under each word is corrected.

  1Sa 5:2   pos6<->pos7   "of"/"God"   ("God" -> θεός instead of the article)
  Rom 8:34  pos15<->pos16 "of"/"God"   (same)
  Act 19:4  pos20<->pos21 "Jesus the"  (the name -> the empty proper-noun slot;
                                        article moves to the empty slot)

Dry-run by default (prints before/after). Add --apply to write.
Usage:
  python3 scripts/fix_article_noun_swaps.py bible.db            # preview
  python3 scripts/fix_article_noun_swaps.py bible.db --apply    # write
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
APPLY = "--apply" in sys.argv

# (book, chapter, verse, positionA, positionB)
FIXES = [
    ("1Sa", 5, 2, 6, 7),
    ("Rom", 8, 34, 15, 16),
    ("Act", 19, 4, 20, 21),
]

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row


def lemma_for(sb):
    if not sb or not sb.startswith("G"):
        return ""
    r = conn.execute("SELECT lemma FROM lexicon WHERE strongs = ?", (sb[1:],)).fetchone()
    return r["lemma"] if r else ""


def row_at(verse_id, pos):
    return conn.execute(
        """SELECT id, position, english, strongs_base, strongs, is_pn
           FROM words WHERE verse_id=? AND position=?""",
        (verse_id, pos),
    ).fetchone()


def show(tag, r):
    print(f"    {tag} pos {r['position']:>3}  eng={r['english']!r:<14} "
          f"{r['strongs_base'] or '-':<7} {lemma_for(r['strongs_base']):<10} "
          f"is_pn={r['is_pn']}")


changed = 0
for bk, ch, vs, pa, pb in FIXES:
    v = conn.execute("SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                     (bk, ch, vs)).fetchone()
    if not v:
        print(f"!! {bk} {ch}:{vs} not found — skipped")
        continue
    a, b = row_at(v["id"], pa), row_at(v["id"], pb)
    if not a or not b:
        print(f"!! {bk} {ch}:{vs} missing pos {pa}/{pb} — skipped")
        continue
    print(f"\n{bk} {ch}:{vs}  (swap Greek tag pos {pa} <-> pos {pb})")
    print("  BEFORE:")
    show("A", a)
    show("B", b)
    if APPLY:
        conn.execute(
            "UPDATE words SET strongs_base=?, strongs=?, is_pn=? WHERE id=?",
            (b["strongs_base"], b["strongs"], b["is_pn"], a["id"]))
        conn.execute(
            "UPDATE words SET strongs_base=?, strongs=?, is_pn=? WHERE id=?",
            (a["strongs_base"], a["strongs"], a["is_pn"], b["id"]))
        print("  AFTER:")
        show("A", row_at(v["id"], pa))
        show("B", row_at(v["id"], pb))
    changed += 1

if APPLY:
    conn.commit()
    print(f"\nAPPLIED to {changed} verse(s).")
else:
    print(f"\nDRY RUN — {changed} verse(s) would change. Re-run with --apply to write.")
conn.close()
