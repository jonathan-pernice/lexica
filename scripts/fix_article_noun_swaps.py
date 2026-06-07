#!/usr/bin/env python3
"""
fix_article_noun_swaps.py — repair 3 verses where a real word's Greek tag landed
on the article ὁ/G3588 (and vice-versa), so clicking the word showed "the".

Each fix swaps ONLY the Greek identity (strongs_base, strongs, is_pn) between two
positions in one verse. The English text stays exactly where it is, so the verse
reads identically — only the tag under each word is corrected.

  1Sa 5:2   pos6<->pos7   "of"/"God"   ("God" -> θεός instead of the article)
  Rom 8:34  pos15<->pos16 "of"/"God"   (same)

Acts 19:4 is a SPLIT, not a swap: the article kept "Jesus the" while the proper-
noun slot sat empty. Match the ABP/eSword layout — "the" on the article (G3588)
and "Jesus" on its own word (G2424, proper noun). Reads "the Jesus Christ".

Dry-run by default (prints before/after). Add --apply to write.
Usage:
  python3 scripts/fix_article_noun_swaps.py bible.db            # preview
  python3 scripts/fix_article_noun_swaps.py bible.db --apply    # write
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
APPLY = "--apply" in sys.argv

# Tag-only swaps: swap (strongs_base, strongs, is_pn) between two positions; the
# English stays put so the verse reads identically.
# (book, chapter, verse, positionA, positionB)
SWAPS = [
    ("1Sa", 5, 2, 6, 7),
    ("Rom", 8, 34, 15, 16),
]

# Explicit set: assign exact values to a position (the Acts 19:4 split).
# (book, chapter, verse, position, strongs_base, strongs, english, english_head, is_pn)
SETS = [
    ("Act", 19, 4, 20, "G3588", "3588", "the",   None,    0),
    ("Act", 19, 4, 21, "G2424", "2424", "Jesus", "jesus", 1),
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
        """SELECT id, position, english, english_head, strongs_base, strongs, is_pn
           FROM words WHERE verse_id=? AND position=?""",
        (verse_id, pos),
    ).fetchone()


def show(tag, r):
    print(f"    {tag} pos {r['position']:>3}  eng={r['english']!r:<14} "
          f"head={r['english_head']!r:<10} {r['strongs_base'] or '-':<7} "
          f"{lemma_for(r['strongs_base']):<10} is_pn={r['is_pn']}")


def verse_id(bk, ch, vs):
    v = conn.execute("SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                     (bk, ch, vs)).fetchone()
    return v["id"] if v else None


changed = 0
for bk, ch, vs, pa, pb in SWAPS:
    vid = verse_id(bk, ch, vs)
    if vid is None:
        print(f"!! {bk} {ch}:{vs} not found — skipped")
        continue
    a, b = row_at(vid, pa), row_at(vid, pb)
    if not a or not b:
        print(f"!! {bk} {ch}:{vs} missing pos {pa}/{pb} — skipped")
        continue
    print(f"\n{bk} {ch}:{vs}  (swap Greek tag pos {pa} <-> pos {pb})")
    print("  BEFORE:")
    show("A", a)
    show("B", b)
    if APPLY:
        conn.execute("UPDATE words SET strongs_base=?, strongs=?, is_pn=? WHERE id=?",
                     (b["strongs_base"], b["strongs"], b["is_pn"], a["id"]))
        conn.execute("UPDATE words SET strongs_base=?, strongs=?, is_pn=? WHERE id=?",
                     (a["strongs_base"], a["strongs"], a["is_pn"], b["id"]))
        print("  AFTER:")
        show("A", row_at(vid, pa))
        show("B", row_at(vid, pb))
    changed += 1

for bk, ch, vs, pos, sb, st, eng, head, pn in SETS:
    vid = verse_id(bk, ch, vs)
    if vid is None:
        print(f"!! {bk} {ch}:{vs} not found — skipped")
        continue
    r = row_at(vid, pos)
    if not r:
        print(f"!! {bk} {ch}:{vs} missing pos {pos} — skipped")
        continue
    print(f"\n{bk} {ch}:{vs}  (set pos {pos} -> {sb} {eng!r})")
    print("  BEFORE:")
    show(" ", r)
    if APPLY:
        conn.execute(
            "UPDATE words SET strongs_base=?, strongs=?, english=?, english_head=?, is_pn=? WHERE id=?",
            (sb, st, eng, head, pn, r["id"]))
        print("  AFTER:")
        show(" ", row_at(vid, pos))
    changed += 1

if APPLY:
    conn.commit()
    print(f"\nAPPLIED {changed} change(s).")
else:
    print(f"\nDRY RUN — {changed} change(s) would be made. Re-run with --apply to write.")
conn.close()
