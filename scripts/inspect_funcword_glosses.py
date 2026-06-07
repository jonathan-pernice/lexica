#!/usr/bin/env python3
"""
inspect_funcword_glosses.py — READ-ONLY. Never writes.

Why: a function word like ἐν (G1722) sometimes carries a stray CONTENT-word
gloss ("blessing", "dwelling") on a few rows. This lists those rows in context
— the target row plus its neighbours in the same verse — so we can see whether
the content word was mis-split off the word next door (the likely cause) before
deciding how to repair it.

Usage:
  python3 scripts/inspect_funcword_glosses.py bible.db                 # ἐν / G1722
  python3 scripts/inspect_funcword_glosses.py bible.db --strongs G1519 # another word
  python3 scripts/inspect_funcword_glosses.py bible.db --scope         # count per function word
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


conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

# English connector/copula words — a gloss whose head is one of these is NOT a
# stray content word. Anything else on a function-word row is suspect.
ENG_FUNC = {
    'a', 'an', 'the', 'my', 'his', 'her', 'your', 'their', 'our', 'its',
    'of', 'in', 'by', 'as', 'to', 'with', 'for', 'from', 'at', 'on', 'into',
    'unto', 'upon', 'over', 'under', 'through', 'within', 'against', 'during',
    'before', 'after', 'about', 'towards', 'toward', 'concerning', 'according',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    'there', 'this', 'that', 'these', 'those', 'and', 'or', 'not', 'no',
    'i', 'he', 'she', 'we', 'they', 'it', 'me', 'him', 'them', 'us', 'you',
    'up', 'out', 'off', 'down', 'along', 'around', 'one', 'ones',
    'while', 'when', 'where', 'because', 'so', 'but', 'shall', 'will',
    'which', 'who', 'whom', 'how', 'some', 'any', 'all', 'every',
    'wheresoever', 'whensoever', 'whereupon', 'whereof', 'whomever',
}

# Common Greek function-word Strong's (prepositions, article, conjunctions,
# particles, negatives). Used only for the --scope summary.
FUNC_STRONGS = [
    "G3588",  # the article
    "G1722", "G1519", "G1537", "G575", "G1909", "G1223", "G2596", "G3326",
    "G4314", "G5259", "G4012", "G3844", "G4862", "G1799", "G1715", "G3694",
    "G2532", "G1161", "G1063", "G3754", "G235", "G2228", "G3767", "G5620",
    "G1437", "G1487", "G3756", "G3361", "G302", "G1065", "G3303", "G5037",
]


def book_ref(verse_id):
    r = conn.execute("SELECT book, chapter, verse FROM verses WHERE id=?", (verse_id,)).fetchone()
    return f"{r['book']} {r['chapter']}:{r['verse']}" if r else f"verse#{verse_id}"


def lemma_for(sbase):
    if not sbase or not sbase.startswith("G"):
        return ""
    r = conn.execute("SELECT lemma FROM lexicon WHERE strongs = ?", (sbase[1:],)).fetchone()
    return r["lemma"] if r else ""


def suspect_rows(sbase):
    """words rows for this strongs whose gloss head is a content word."""
    rows = conn.execute(
        """SELECT id, verse_id, position, english, english_head, bracket_id
           FROM words
           WHERE strongs_base = ?
             AND english_head IS NOT NULL AND english_head != ''""",
        (sbase,),
    ).fetchall()
    out = []
    for r in rows:
        head = (r["english_head"] or "").strip().lower().strip(".,;:!?'\"")
        if head and head not in ENG_FUNC:
            out.append(r)
    return out


def show_context(r):
    ref = book_ref(r["verse_id"])
    nbrs = conn.execute(
        """SELECT position, english, english_head, strongs_base, bracket_id
           FROM words WHERE verse_id=? AND position BETWEEN ? AND ?
           ORDER BY position""",
        (r["verse_id"], r["position"] - 2, r["position"] + 2),
    ).fetchall()
    print(f"\n  {ref}  (bracket={r['bracket_id']})")
    for n in nbrs:
        mark = " <== ἐν here" if n["position"] == r["position"] else ""
        lem = lemma_for(n["strongs_base"])
        print(f"    pos {n['position']:>3}  {n['strongs_base'] or '-':<7} {lem:<10} "
              f"eng={n['english']!r:<22} head={n['english_head']!r}{mark}")


verse_spec = opt("--verse")
if verse_spec:
    # Dump every word of one verse so a single odd tag can be read in full.
    # Format: --verse 1Sa:5:2   (book:chapter:verse, book code as in verses.book)
    try:
        bk, ch, vs = verse_spec.split(":")
    except ValueError:
        print("usage: --verse BOOK:CH:VS   e.g. --verse 1Sa:5:2")
        sys.exit(1)
    v = conn.execute(
        "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
        (bk, int(ch), int(vs)),
    ).fetchone()
    if not v:
        print(f"verse not found: {bk} {ch}:{vs}")
        sys.exit(1)
    rows = conn.execute(
        """SELECT position, strongs_base, strongs, english, english_head,
                  italic, bracket_id, greek_pos
           FROM words WHERE verse_id=? ORDER BY position""",
        (v["id"],),
    ).fetchall()
    print(f"{bk} {ch}:{vs}  —  {len(rows)} words  [DB: {DB}]\n")
    for r in rows:
        lem = lemma_for(r["strongs_base"])
        ital = " ITALIC" if r["italic"] else ""
        print(f"  pos {r['position']:>3}  {r['strongs_base'] or '-':<7} {lem:<11} "
              f"eng={r['english']!r:<24} head={r['english_head']!r}"
              f"  brk={r['bracket_id']}{ital}")
    sys.exit(0)

if opt("--scope"):
    print(f"Suspect (content-word gloss) rows per common function word — {DB}\n")
    rep = []
    for s in FUNC_STRONGS:
        n = len(suspect_rows(s))
        if n:
            rep.append((n, s, lemma_for(s)))
    for n, s, lem in sorted(rep, reverse=True):
        print(f"  {s:<7} {lem:<10} {n} suspect row(s)")
    print(f"\n  total function words with suspects: {len(rep)}")
    sys.exit(0)

target = opt("--strongs", "G1722")
limit = int(opt("--limit", "60"))
rows = suspect_rows(target)
lem = lemma_for(target)
print(f"{target} ({lem}) — {len(rows)} suspect row(s) with a content-word gloss"
      f"  [DB: {DB}]")

# group by normalized head so identical leaks collapse
from collections import defaultdict
groups = defaultdict(list)
for r in rows:
    head = (r["english_head"] or "").strip().lower()
    groups[head].append(r)

for head in sorted(groups, key=lambda h: -len(groups[h])):
    rs = groups[head]
    print(f"\n=== rendered as '{head}'  ({len(rs)} row[s]) ===")
    for r in rs[: min(len(rs), limit)]:
        show_context(r)
