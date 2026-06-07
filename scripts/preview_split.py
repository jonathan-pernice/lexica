#!/usr/bin/env python3
"""
preview_split.py — READ-ONLY. Never writes.

Runs the REAL word-splitter (build_words_from_abp.build_verse_words, which calls
_redistribute_pronoun_compounds + _split_compounds) on the ABP SOURCE text for a
verse, with the BH metadata overlay turned off (bh_rows=[]). What it prints is the
word/number pairing a rebuild would produce for that verse — letting us see the
"number on the wrong word" break (Problem 1) from source, without touching the db.

Pronoun correction (Rahlfs/TAGNT) is skipped if those files are absent — it does
not affect the article/preposition + noun cases this previews.

Usage:
  python3 scripts/preview_split.py                       # the 8 known break verses
  python3 scripts/preview_split.py 1Sa 5 2               # one verse
  python3 scripts/preview_split.py Rom 8 34 bible.db     # explicit db for lexicon
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_words_from_abp import (            # noqa: E402
    build_verse_words, load_lexicon, iter_verses, _abp_sources,
)
import sqlite3                                # noqa: E402

# Default set = the 8 verses fix_article_noun_swaps.py band-aids.
KNOWN = [
    ("1Sa", 5, 2), ("Rom", 8, 34), ("Act", 19, 4), ("1Pe", 5, 12),
    ("2Co", 8, 10), ("Eph", 3, 3), ("Mat", 26, 44), ("Zec", 8, 13),
]

args = [a for a in sys.argv[1:]]
db = next((a for a in args if a.endswith(".db")), "bible.db")
SCAN = "--scan" in args
args = [a for a in args if not a.endswith(".db") and not a.startswith("--")]

if len(args) >= 3:
    targets = [(args[0], int(args[1]), int(args[2]))]
else:
    targets = KNOWN

# ── backwards-pairing fingerprint (shape A: the lump landed on a little word) ──
ARTICLE = "3588"
PREPS = {
    "1722", "1519", "1537", "575", "4314", "1909", "2596", "3326", "1223",
    "5259", "5228", "3844", "4012", "1799", "1715", "3694", "561", "1726",
    "630", "3936",
}
FUNCTION = {ARTICLE} | PREPS
CONNECTORS = {
    "of", "the", "a", "an", "to", "in", "by", "with", "for", "from", "at", "on",
    "into", "unto", "upon", "over", "under", "through", "s",
}
SKIP_HEADS = {
    "the", "a", "an", "this", "that", "these", "those", "of", "in", "by", "to",
    "with", "for", "from", "at", "on", "into", "unto", "and", "or", "not",
    "he", "she", "it", "they", "we", "i", "you", "me", "him", "her", "them",
    "us", "one", "ones", "thing", "things", "who", "which", "what", "both",
    "all", "any", "some", "each", "every", "other", "same", "is", "are", "was",
    "were", "be", "been", "being", "because", "therefore", "so", "then", "lest",
    "though", "while", "when", "where", "why", "how", "as", "than", "if",
}
DET = {"the", "a", "an", "this", "that", "these", "those", "my", "your", "his",
       "her", "our", "their", "its", "all", "of", "some", "any", "each",
       "every", "no", "which", "what", "one", "ones"}


def _bare(s):
    import re as _re
    return _re.sub(r"[^\w]", "", s or "").lower()


def _singular(w):
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def scan_rows(rows, lexd):
    """Return list of (pos_func, sb_func, eng_func, pos_nb, sb_nb, eng_nb) hits."""
    hits = []
    by_pos = {r[0]: r for r in rows}
    for r in rows:
        pos, eng, head, sn, sb = r[0], r[1], r[2], r[3], r[4]
        if sb not in FUNCTION or not head:
            continue
        h = _bare(head)
        if not h or h in SKIP_HEADS:
            continue
        first = _bare((eng or "").split()[0]) if eng and eng.split() else ""
        if first in DET:                          # substantival "the X" = legit
            continue
        for delta in (1, -1):
            nb = by_pos.get(pos + delta)
            if not nb or not nb[4] or nb[4] in FUNCTION or nb[4] in ("*", ""):
                continue
            neng = (nb[1] or "").strip().lower().strip(".,;:")
            d = lexd.get(nb[4], set())
            if neng in CONNECTORS and (h in d or _singular(h) in d):
                hits.append((pos, sb, eng, nb[0], nb[4], nb[1]))
                break
    return hits

lex = None
if Path(db).exists():
    conn = sqlite3.connect(db)
    lex = load_lexicon(conn)
    conn.close()
    print(f"Lexicon: {len(lex):,} entries  [db: {db}]\n")
else:
    print(f"(no {db} — running without lexicon; split needs it, results limited)\n")

# Index the source once: (book, ch, vs) -> abp_words
src_index = {}
for abbrev, ch, vs, words in iter_verses(*_abp_sources()):
    src_index[(abbrev, ch, vs)] = words

if "--lumps" in sys.argv:
    # List every function-word SOURCE slot holding a multi-word gloss that is
    # followed by empty real-Strong's slots — the shape the positional fix acts
    # on. Shows word-count M vs slot-count K straight from source (no chop), so
    # we can eyeball the uneven (M != K) ones for the "extra word" ambiguity.
    uneven = 0
    for (bk, ch, vs), abp_words in src_index.items():
        for k, (eng, raw, ap, ob, cb) in enumerate(abp_words):
            if ap is not None or ob or cb:                 # skip bracketed
                continue
            if not raw or not raw.startswith("G") or raw == "G*":
                continue
            base = raw[1:].split(".")[0]
            if base not in FUNCTION:
                continue
            words = (eng or "").split()
            if len(words) < 2:
                continue
            empties = 0
            for (e2, r2, a2, o2, c2) in abp_words[k + 1:]:
                if a2 is not None or o2 or c2:
                    break
                if e2 and e2.strip():
                    break
                if not r2 or r2 == "G*" or r2[1:].split(".")[0] in ("", "1510"):
                    break
                empties += 1
            if empties == 0:
                continue
            M, K = len(words), 1 + empties
            mark = "" if M == K else "  <-- UNEVEN"
            if M != K:
                uneven += 1
            print(f"  {bk} {ch}:{vs:<3} G{base:<5} M={M} K={K} eng={eng!r}{mark}")
    print(f"\nUneven (M != K) function-slot lumps: {uneven}")
    sys.exit(0)

if "--dump" in sys.argv:
    # Whole-corpus chopped output, one word per line — for before/after diffing.
    for (bk, ch, vs) in sorted(src_index):
        rows = build_verse_words(src_index[(bk, ch, vs)], [], lex)
        for r in rows:
            print(f"{bk} {ch}:{vs} [{r[0]:>2}] {str(r[4] or '-'):7} {r[1] or ''}")
    sys.exit(0)

if SCAN:
    total = 0
    for (bk, ch, vs), abp_words in src_index.items():
        rows = build_verse_words(abp_words, [], lex)
        for pos_f, sb_f, eng_f, pos_n, sb_n, eng_n in scan_rows(rows, lex):
            total += 1
            print(f"  {bk} {ch}:{vs:<3} pos{pos_f:>3} G{sb_f:<6} eng={eng_f!r:<14}"
                  f" <-> pos{pos_n:>3} G{sb_n:<6} eng={eng_n!r}")
    print(f"\nBackwards-pairing hits (chopped from source): {total}")
    sys.exit(0)

for bk, ch, vs in targets:
    abp_words = src_index.get((bk, ch, vs))
    print(f"=== {bk} {ch}:{vs} ===")
    if abp_words is None:
        print("  (not found in ABP source)\n")
        continue
    print("  SOURCE pairs (english -> raw strongs, as ABP wrote them):")
    for eng, raw, ap, ob, cb in abp_words:
        if (eng and eng.strip()) or raw:
            print(f"    {str(eng or ''):22} {raw or '-'}")
    rows = build_verse_words(abp_words, [], lex)
    print("  AFTER SPLIT (what a rebuild stores):")
    for (p, eng, head, sn, sb, gpos, bid, italic, iw, sw, morph, lemma) in rows:
        if eng or (sb and sb not in ("", "*")):
            flag = f"  bid={bid}" if bid is not None else ""
            print(f"    [{p:2}] {str(sb or '-'):7} eng={str(eng or ''):22} head={head or '-'}{flag}")
    print()
