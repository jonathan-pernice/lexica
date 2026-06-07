#!/usr/bin/env python3
"""
scan_strongs_cross.py — READ-ONLY. Never writes.

Measures how widespread the parser "number-pairing reversal" is (the 1Sa 5:2 /
Rom 8:34 shape). ABP source writes a multi-word gloss with the Greek numbers
tacked on the end ("of God  G3588 G2316"); our build sometimes paired them
backwards, so the noun's English ("God") landed on the FUNCTION word (the article
G3588) and the connector ("of") landed on the real noun (θεός / G2316).

Fingerprint of one flip:
  A = a slot showing a bare CONTENT word (no leading "the/a/your…", head is a real
      word) whose dictionary meaning is FOUND IN
  B = an ADJACENT slot that itself shows only a CONNECTOR ("of", "the", "in"…).
      i.e. A's word provably belongs to B — they are crossed.

Coverage note: A is checked on EVERY slot, not just function words (the old version
only anchored on the article/preposition). In practice the real flip ONLY happens
when A is a function word — so the report is split:
  FUNCTION-anchor = the article/preposition family. These are the genuine flips;
      the build now auto-corrects them (build_words_from_abp._fix_backwards_pairing),
      so a clean rebuilt db reads 0 here.
  OTHER = content<->content. Anchoring everywhere keeps the net complete, but these
      are almost all FALSE positives — legitimate verb+preposition pairs like
      "went forth / unto" the dictionary test happens to match. Review-only.

To check the SOURCE directly (before any rebuild), see preview_split.py --scan,
which runs the real chopper over the ABP text and counts the same flips.

Usage:
  python3 scripts/scan_strongs_cross.py bible.db
  python3 scripts/scan_strongs_cross.py bible.db --limit 500
"""
import re
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
LIMIT = 1000
if "--limit" in sys.argv:
    i = sys.argv.index("--limit")
    if i + 1 < len(sys.argv):
        LIMIT = int(sys.argv[i + 1])

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

ARTICLE = "G3588"
PREPS = {
    "G1722", "G1519", "G1537", "G575", "G4314", "G1909", "G2596", "G3326",
    "G1223", "G5259", "G5228", "G3844", "G4012", "G1799", "G1715", "G3694",
    "G561", "G1726", "G630", "G3936",
}
FUNCTION = {ARTICLE} | PREPS

CONNECTORS = {
    "of", "the", "a", "an", "to", "in", "by", "with", "for", "from", "at", "on",
    "into", "unto", "upon", "over", "under", "through", "of the", "to the",
    "in the", "by the", "'s", "s",
}
# Words that are NOT a real-noun head (substantival article, pronouns, connectors).
SKIP_HEADS = {
    "the", "a", "an", "this", "that", "these", "those", "of", "in", "by", "to",
    "with", "for", "from", "at", "on", "into", "unto", "and", "or", "not",
    "he", "she", "it", "they", "we", "i", "you", "me", "him", "her", "them",
    "us", "one", "ones", "thing", "things", "who", "which", "what", "both",
    "all", "any", "some", "each", "every", "other", "same", "is", "are", "was",
    "were", "be", "been", "being",
    # conjunctions/adverbs that are valid renderings of a preposition (διά
    # "because of", ὅτι "for") — not real nouns, so drop those false positives.
    "because", "therefore", "so", "then", "lest", "though", "while", "when",
    "where", "why", "how", "as", "than", "if",
}
DET = {"the", "a", "an", "this", "that", "these", "those", "my", "your", "his",
       "her", "our", "their", "its", "all", "of", "some", "any", "each",
       "every", "no", "which", "what", "one", "ones"}


def bare(s):
    return re.sub(r"[^\w]", "", s or "").lower()


def first_word(s):
    toks = (s or "").strip().lower().split()
    return bare(toks[0]) if toks else ""


def singular(w):
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


# Dictionary word-sets: Greek from lexicon, Hebrew from bdb.
defs = {}
for strongs, kjv_def, strongs_def in conn.execute(
        "SELECT strongs, kjv_def, strongs_def FROM lexicon"):
    base = "G" + (strongs or "").lstrip("GH").split(".")[0]
    text = " ".join(filter(None, [kjv_def, strongs_def]))
    defs[base] = set(re.sub(r"[^\w\s]", " ", text).lower().split())
try:
    for sid, desc in conn.execute("SELECT strongs_id, description FROM bdb"):
        if sid:
            defs[sid] = set(re.sub(r"[^\w\s]", " ", (desc or "").lower()).split())
except sqlite3.Error:
    pass


def def_has(head, base):
    d = defs.get(base, set())
    return head in d or singular(head) in d


# Widened scan: anchor on EVERY word, not just function words. The flip signature
# is the same either way — a slot showing a real content word whose meaning belongs
# to an ADJACENT slot that itself shows only a connector — so checking all slots
# catches content<->content flips too, not just the article/preposition cases. We
# fetch every word once, grouped by verse, and look at neighbours in memory (no
# per-row DB round-trip), then split the report into FUNCTION-anchor hits (the
# actionable article/preposition family, already auto-fixed at build) and OTHER
# hits (content<->content — review candidates).
from collections import defaultdict

rows_all = conn.execute(
    "SELECT w.verse_id, w.position, w.english, w.english_head, w.strongs_base, "
    "       v.book, v.chapter, v.verse "
    "FROM words w JOIN verses v ON v.id = w.verse_id "
    "WHERE w.english_head IS NOT NULL AND w.english_head != '' "
    "ORDER BY v.book, v.chapter, v.verse, w.position").fetchall()

by_verse = defaultdict(dict)            # verse_id -> {position: row}
order = []
for r in rows_all:
    if r["verse_id"] not in by_verse:
        order.append(r["verse_id"])
    by_verse[r["verse_id"]][r["position"]] = r

hits = []                               # (anchor_row, neighbour_row, is_function)
seen = set()                            # (verse_id, lo_pos, hi_pos) — dedupe pair
for vid in order:
    slots = by_verse[vid]
    for pos, r in slots.items():
        sb = r["strongs_base"]
        if not sb or sb in ("*", ""):
            continue
        head = bare(r["english_head"])
        if not head or head in SKIP_HEADS:
            continue
        if first_word(r["english"]) in DET:      # substantival "the X" = legit
            continue
        for delta in (1, -1):
            nb = slots.get(pos + delta)
            if not nb or not nb["strongs_base"]:
                continue
            nsb = nb["strongs_base"]
            if nsb in ("*", ""):
                continue
            neng = (nb["english"] or "").strip().lower().strip(".,;:")
            if neng in CONNECTORS and def_has(head, nsb):
                key = (vid, min(pos, nb["position"]), max(pos, nb["position"]))
                if key in seen:
                    break
                seen.add(key)
                hits.append((r, nb, sb in FUNCTION))
                break

func_hits = [h for h in hits if h[2]]
other_hits = [h for h in hits if not h[2]]

print(f"Number-reversal crosses: {len(hits)}  "
      f"(function-anchor {len(func_hits)}, other {len(other_hits)})  [DB: {DB}]")
print("(a slot showing a real word whose meaning belongs to its neighbour, the\n"
      " neighbour showing only a connector — confirmed by the dictionary)\n")


def _show(group, label):
    if not group:
        return
    print(f"-- {label} ({len(group)}) --")
    for r, nb, _ in group[:LIMIT]:
        ref = f"{r['book']} {r['chapter']}:{r['verse']}"
        print(f"  {ref:<12} pos{r['position']:>3} {r['strongs_base']:<6} eng={r['english']!r:<14} "
              f"<-> pos{nb['position']:>3} {nb['strongs_base']:<6} eng={nb['english']!r}")
    print()


_show(func_hits, "FUNCTION-anchor (article/preposition family; auto-fixed at build)")
_show(other_hits, "OTHER (content<->content; review candidates)")
conn.close()
