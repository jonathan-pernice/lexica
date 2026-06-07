#!/usr/bin/env python3
"""
scan_strongs_cross.py — READ-ONLY. Never writes.

Measures how widespread the parser "number-pairing reversal" is (the 1Sa 5:2 /
Rom 8:34 shape). ABP source writes a multi-word gloss with the Greek numbers
tacked on the end ("of God  G3588 G2316"); our build sometimes paired them
backwards, so the noun's English ("God") landed on the FUNCTION word (the article
G3588) and the connector ("of") landed on the real noun (θεός / G2316).

High-precision fingerprint (so the count is trustworthy):
  A = a function-word slot (article G3588 or a preposition) whose English is a
      bare CONTENT noun (no leading "the/a/your…", head is a real noun)
  B = the ADJACENT slot, a real content Greek/Hebrew word, whose English is only
      a CONNECTOR ("of", "the", "in"…)
  AND B's own dictionary meaning CONTAINS A's noun — i.e. the noun on A provably
      belongs to B's Greek word. That last test is what makes a hit a real cross,
      not legitimate "the things / of the LORD" lumping.

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


def neighbour(verse_id, position, delta):
    return conn.execute(
        "SELECT position, english, english_head, strongs_base FROM words "
        "WHERE verse_id=? AND position=?", (verse_id, position + delta)).fetchone()


rows = conn.execute(
    "SELECT w.verse_id, w.position, w.english, w.english_head, w.strongs_base, "
    "       v.book, v.chapter, v.verse "
    "FROM words w JOIN verses v ON v.id = w.verse_id "
    f"WHERE w.strongs_base IN ({','.join('?' * len(FUNCTION))}) "
    "  AND w.english_head IS NOT NULL AND w.english_head != '' "
    "ORDER BY v.book, v.chapter, v.verse, w.position", tuple(FUNCTION)).fetchall()

hits = []
for r in rows:
    head = bare(r["english_head"])
    if not head or head in SKIP_HEADS:
        continue
    if first_word(r["english"]) in DET:      # substantival "the X" = legit
        continue
    for delta in (1, -1):
        nb = neighbour(r["verse_id"], r["position"], delta)
        if not nb or not nb["strongs_base"]:
            continue
        sb = nb["strongs_base"]
        if sb in FUNCTION or sb in ("*", ""):
            continue
        neng = (nb["english"] or "").strip().lower().strip(".,;:")
        if neng in CONNECTORS and def_has(head, sb):
            hits.append((r, nb))
            break

print(f"Parser number-reversal crosses: {len(hits)}  [DB: {DB}]")
print("(function word showing a real noun, neighbour showing the connector,\n"
      " confirmed by the neighbour's dictionary meaning)\n")
for r, nb in hits[:LIMIT]:
    ref = f"{r['book']} {r['chapter']}:{r['verse']}"
    print(f"  {ref:<12} {r['strongs_base']:<6} eng={r['english']!r:<14} "
          f"<-> {nb['strongs_base']:<6} eng={nb['english']!r}")
conn.close()
