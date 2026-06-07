#!/usr/bin/env python3
"""scan_filler_mistags.py — READ-ONLY. Never writes.

Corpus-wide hunt for the bug we keep hitting: a CONTENT Greek word that, in one
verse, renders as nothing but a filler word ("and", "of", "the"...). Two known
shapes (Lam 3:16 theos-on-"and", 1Pe 1:23 "of God living" split) both look like
this.

Self-calibrating — no function-word list to maintain. For each Strong's it learns
the word's USUAL rendering from the whole corpus; a word that normally means
something content-y ("god") but shows up as a bare filler in some verse is
flagged. A real function word (kai = "and") normally renders as filler, so its
filler rows are correct and skipped automatically.

Usage:
  python3 scripts/scan_filler_mistags.py bible.db
  python3 scripts/scan_filler_mistags.py bible.db --min 1   # min occurrences of the word (default 5)
"""
import sqlite3
import sys
from collections import defaultdict

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
    'while', 'than', 'therefore', 'yet', 'until', 'though', 'which', 'who',
    'whom', 'how', 'shall', 'will', 'o',
}

MIN_OCC = int(opt("--min", "5"))


def clean(w):
    return w.strip(".,;:!?'\"()[]").lower()


def filler_only(eng):
    toks = [clean(t) for t in (eng or "").split()]
    toks = [t for t in toks if t]
    return bool(toks) and all(t in FILLER for t in toks)


conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

# Pull every Greek ABP word with English. Learn each word's usual rendering, and
# collect the filler-only rows as candidates.
rows = conn.execute(
    """SELECT w.id, w.verse_id, w.position, w.english, w.strongs_base,
              v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       WHERE w.strongs_base LIKE 'G%'
         AND w.english IS NOT NULL AND w.english != '' AND w.english != '*'"""
).fetchall()

usual = defaultdict(lambda: defaultdict(int))   # strongs -> {first content token: count}
total = defaultdict(int)
candidates = []
for r in rows:
    sb = r["strongs_base"]
    total[sb] += 1
    if filler_only(r["english"]):
        candidates.append(r)
    else:
        # record the first non-filler token as the word's content sense
        for t in (clean(x) for x in r["english"].split()):
            if t and t not in FILLER:
                usual[sb][t] += 1
                break

# A word is "content-y" if it has a clear non-filler usual rendering.
def is_content_word(sb):
    senses = usual.get(sb)
    return bool(senses) and total[sb] >= MIN_OCC


flagged = [r for r in candidates if is_content_word(r["strongs_base"])]

# group by strongs
groups = defaultdict(list)
for r in flagged:
    groups[r["strongs_base"]].append(r)

print(f"Filler-only mis-tags on content words: {len(flagged)} row(s) "
      f"across {len(groups)} word(s)  [DB: {DB}, min occ {MIN_OCC}]\n")

for sb in sorted(groups, key=lambda s: -len(groups[s])):
    rs = groups[sb]
    top = max(usual[sb].items(), key=lambda x: x[1])[0] if usual[sb] else "?"
    print(f"=== {sb}  (usually '{top}', {total[sb]}x)  — {len(rs)} bad row(s) ===")
    for r in rs:
        ref = f"{r['book']} {r['chapter']}:{r['verse']}"
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
        print(f"  {ref:<14} eng={r['english']!r:<14}")
        print(f"       {ctx}")
    print()

conn.close()
