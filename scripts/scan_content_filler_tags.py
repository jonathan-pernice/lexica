#!/usr/bin/env python3
"""scan_content_filler_tags.py — READ-ONLY. Never writes.

Lists every row of a CONTENT Strong's (default G2316 / theos) whose English is
nothing but a filler word ("and", "of", "the"...). Those are mis-tags: the
number landed on a connector instead of the content word, so the Lexicon lights
up the wrong word in the verse (e.g. Lam 3:16 "and", 1Pe 1:23 "of God" split).

Usage:
  python3 scripts/scan_content_filler_tags.py bible.db
  python3 scripts/scan_content_filler_tags.py bible.db --strongs G2962
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
ARGS = sys.argv[1:]


def opt(flag, default=None):
    if flag in ARGS:
        i = ARGS.index(flag)
        return ARGS[i + 1] if i + 1 < len(ARGS) else True
    return default


FILLER = {
    'a', 'an', 'the', 'my', 'his', 'her', 'your', 'their', 'our', 'its',
    'of', 'in', 'by', 'as', 'to', 'with', 'for', 'from', 'at', 'on', 'into',
    'unto', 'upon', 'over', 'under', 'through', 'within', 'against', 'among',
    'before', 'after', 'about', 'concerning', 'during', 'toward', 'towards',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    'there', 'this', 'that', 'these', 'those', 'and', 'or', 'not', 'no', 'nor',
    'i', 'he', 'she', 'we', 'they', 'it', 'me', 'him', 'them', 'us', 'you',
    'up', 'out', 'off', 'down', 'so', 'then', 'but', 'if', 'because', 'when',
    'while', 'than', 'therefore', 'yet', 'until', 'though',
}


def clean(w):
    return w.strip(".,;:!?'\"").lower()


target = opt("--strongs", "G2316")
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

rows = conn.execute(
    """SELECT w.id, w.verse_id, w.position, w.english, w.english_head,
              w.bracket_id, v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       WHERE w.strongs_base = ?
         AND w.english IS NOT NULL AND w.english != '' AND w.english != '*'""",
    (target,),
).fetchall()

bad = []
for r in rows:
    toks = [clean(t) for t in (r["english"] or "").split()]
    toks = [t for t in toks if t]
    if toks and all(t in FILLER for t in toks):
        bad.append(r)

print(f"{target}: {len(bad)} row(s) rendered as filler-only  [DB: {DB}]\n")
for r in bad:
    ref = f"{r['book']} {r['chapter']}:{r['verse']}"
    # neighbours so we can see where the real content word went
    nbrs = conn.execute(
        """SELECT position, english, strongs_base FROM words
           WHERE verse_id=? AND position BETWEEN ? AND ?
           ORDER BY position""",
        (r["verse_id"], r["position"] - 1, r["position"] + 1),
    ).fetchall()
    ctx = "  |  ".join(
        f"{'>>' if n['position']==r['position'] else '  '}"
        f"{n['strongs_base'] or '-'}={n['english']!r}"
        for n in nbrs
    )
    print(f"  {ref:<14} eng={r['english']!r:<14} brk={r['bracket_id']}")
    print(f"       {ctx}")
