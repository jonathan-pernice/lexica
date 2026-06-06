#!/usr/bin/env python3
"""
audit_funcword_wrongslot.py — READ-ONLY. The HEADLINE WRONG-SLOT source for the
DUAL-ORDERING #2/#3 work: a concrete/proper noun bundled onto a FUNCTION-WORD slot
(G3588 article, or a preposition) while the noun's OWN content Strong's slot sits
EMPTY right next to it. Same family as pilot #1 (audit_lord_strongs.py /
fix_lord_subject.py) — but onto a function word instead of a verb, and the
highest-VOLUME instance of it (G3588 ὁ is the commonest word in the corpus).

WHY THIS NEEDS A PARTITION (not a blanket rule):
  G3588 legitimately "renders as" a huge list and NONE of these may be touched:
    * the article itself ("the");
    * the SUBSTANTIVAL article ("he/she/it/this/that/who/one/ones/things/both" —
      real Koine ὁ/οἱ/τά, ὁ δέ "but he");
    * the OBLIQUE-case article carrying the case's English preposition (τοῦ→"of",
      τῷ→"to/in the") — the big to/in/with/of/for/by/against counts, an
      interlinear convention.
  A blanket "article = only 'the'" rule would DESTROY real Greek. So we partition
  legit-vs-artifact using the DATA, never a wordlist.

DISCRIMINATOR — ARTIFACT-REPAIRABLE requires ALL THREE (no guessing):
  1. the function-word slot has a NON-NULL english_head — i.e. a CONTENT word is
     bundled on it. (_head_word returns None for a pure 'the'/'of the' gloss, so
     legit article/oblique-prep slots are auto-excluded at the source.)
  2. an ADJACENT slot is EMPTY (no english) yet carries a REAL content Strong's
     (not G3588, not '*', not '') — that is the orphaned Greek word's own slot.
  3. the orphan slot's LEXICON definition CONTAINS the bundled english_head
     (head 'god' ∈ def(G2316 θεός); 'son' ∈ def(G5207 υἱός)). This is the SAME
     lexicon-evidence test the build's _split_compounds uses (norm in slot_def),
     so it ties the leaked noun to its real empty Greek slot with no heuristic.

  Substantival 'things'/'ones' and the genealogical 'son of X' (where the genitive
  name is a '*' proper-noun slot, NOT an empty content slot) have no empty content
  neighbour → they fall to NO-ORPHAN and are left untouched.

BUCKETS (per function-word slot whose english_head is non-null):
  ARTIFACT-REPAIRABLE  empty adjacent content slot + lexicon-gloss match
                       -> THE #2/#3 target (give the noun its own clickable slot)
  ARTIFACT-PN          empty adjacent slot is a PROPER NOUN (is_pn=1) — leaked too,
                       but confirmed by name, not lexicon gloss (reported apart;
                       'jesus'/'israel'/'uriah' class)
  ORPHAN-NOMATCH       empty adjacent content slot but its gloss does NOT contain
                       the head — review (different orphan / ambiguous)
  NO-ORPHAN            content head but NO empty content neighbour (supplied
                       'son of X', substantival use, etc.) — NOT a target
  LEGIT-SUBSTANTIVAL   head is a known substantival/pronominal word — never a target

READ-ONLY (mode=ro). Run on PA from the repo root (needs bible.db only):
  python3 scripts/audit_funcword_wrongslot.py bible.db
  python3 scripts/audit_funcword_wrongslot.py bible.db --preps     # add preposition hosts
  python3 scripts/audit_funcword_wrongslot.py bible.db --book 1Sa  # filter one book
  python3 scripts/audit_funcword_wrongslot.py bible.db --show-nomatch
"""
import re
import sqlite3
import sys
from collections import Counter

ARGS = sys.argv[1:]
DB = next((a for a in ARGS if not a.startswith("--")), "bible.db")
WITH_PREPS = "--preps" in ARGS
SHOW_NOMATCH = "--show-nomatch" in ARGS
BOOK_FILTER = ARGS[ARGS.index("--book") + 1] if "--book" in ARGS else None

ARTICLE_BASE = "G3588"
# Curated common Greek prepositions (bare bases -> G-prefixed). Function-word hosts
# that, like the article, legitimately carry only a preposition gloss (english_head
# None) — a non-null head on them is the same bundling artifact.
PREP_BASES = {
    "G1722", "G1519", "G1537", "G575", "G4314", "G1909", "G2596", "G3326",
    "G1223", "G5259", "G5228", "G3844", "G4012", "G1799", "G1715", "G3694",
    "G561", "G1726", "G630", "G1838", "G3936",
}
HOSTS = {ARTICLE_BASE} | (PREP_BASES if WITH_PREPS else set())

# Substantival / pronominal article renderings — real Koine, never split.
SUBSTANTIVAL = {
    "he", "she", "it", "they", "them", "him", "her", "this", "that", "these",
    "those", "who", "whom", "which", "what", "one", "ones", "thing", "things",
    "both", "other", "others", "same", "such", "whoever", "whatever", "anyone",
}


def bare(s):
    return re.sub(r"[^\w]", "", s or "").lower()


conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

# Replicate build_words_from_abp.load_lexicon: base -> set of definition words.
lex = {}
for strongs, kjv_def, strongs_def in conn.execute(
        "SELECT strongs, kjv_def, strongs_def FROM lexicon"):
    base = (strongs or "").lstrip("GH").split(".")[0]
    text = " ".join(filter(None, [kjv_def, strongs_def]))
    lex[base] = set(re.sub(r"[^\w\s]", " ", text).lower().split())

WCOLS = {r[1] for r in conn.execute("PRAGMA table_info(words)")}
HAS_PN = "is_pn" in WCOLS
PN_SEL = "w2.is_pn" if HAS_PN else "0 AS is_pn"


def neighbour(verse_id, position, delta):
    return conn.execute(
        f"SELECT w2.position, w2.english, w2.strongs_base, w2.bracket_id, {PN_SEL} "
        f"FROM words w2 WHERE w2.verse_id=? AND w2.position=?",
        (verse_id, position + delta)).fetchone()


def find_orphan(verse_id, position):
    """Adjacent EMPTY slot with a real content Strong's. Prefer the +1 slot
    (article precedes its noun: ὁ υἱός), then -1. Returns the row or None."""
    for delta in (1, -1):
        nb = neighbour(verse_id, position, delta)
        if nb and (nb["english"] or "").strip() == "":
            sb = nb["strongs_base"]
            if sb and sb not in ("*", "", ARTICLE_BASE) and sb not in HOSTS:
                return nb, delta
    return None, None


host_label = "G3588 + preps" if WITH_PREPS else "G3588 (article)"
q = (
    "SELECT w.verse_id, w.position, w.english, w.english_head, w.strongs_base, "
    "       w.bracket_id, v.book, v.chapter, v.verse "
    "FROM words w JOIN verses v ON v.id = w.verse_id "
    "WHERE w.strongs_base IN (%s) AND w.english_head IS NOT NULL "
    "ORDER BY w.verse_id, w.position" % ",".join("?" * len(HOSTS))
)
cands = conn.execute(q, tuple(HOSTS)).fetchall()

buckets = Counter()
per_host = Counter()                    # host base -> ARTIFACT-REPAIRABLE count
art_heads = Counter()                   # repairable head -> count
samples = {k: [] for k in
           ("ARTIFACT-REPAIRABLE", "ARTIFACT-PN", "ORPHAN-NOMATCH", "NO-ORPHAN")}

for c in cands:
    if BOOK_FILTER and c["book"] != BOOK_FILTER:
        continue
    head = c["english_head"]
    hb = bare(head)
    if not hb:
        buckets["LEGIT-SUBSTANTIVAL"] += 1     # head was all punctuation -> ignore
        continue
    if hb in SUBSTANTIVAL:
        buckets["LEGIT-SUBSTANTIVAL"] += 1
        continue

    orphan, delta = find_orphan(c["verse_id"], c["position"])
    ref = f"{c['book']} {c['chapter']}:{c['verse']}"
    if orphan is None:
        buckets["NO-ORPHAN"] += 1
        if len(samples["NO-ORPHAN"]) < 12:
            samples["NO-ORPHAN"].append((ref, c["strongs_base"], head, c["english"], "-"))
        continue

    obase = (orphan["strongs_base"] or "").lstrip("GH").split(".")[0]
    odetail = f"orphan[{delta:+d}]={orphan['strongs_base']}"
    if HAS_PN and orphan["is_pn"] == 1:
        tag = "ARTIFACT-PN"
    elif hb in lex.get(obase, set()):
        tag = "ARTIFACT-REPAIRABLE"
        per_host[c["strongs_base"]] += 1
        art_heads[hb] += 1
    else:
        tag = "ORPHAN-NOMATCH"
    buckets[tag] += 1
    if len(samples[tag]) < 15:
        samples[tag].append((ref, c["strongs_base"], head, c["english"], odetail))

conn.close()

# ── report ──────────────────────────────────────────────────────────────────
order = ["ARTIFACT-REPAIRABLE", "ARTIFACT-PN", "ORPHAN-NOMATCH",
         "NO-ORPHAN", "LEGIT-SUBSTANTIVAL"]
total = sum(buckets.values())
print(f"READ-ONLY function-word WRONG-SLOT audit -> {DB}")
print(f"  hosts: {host_label}   candidate slots (host + non-null english_head): {total:,}")
print(f"  (a non-null english_head means a CONTENT word is bundled on the function word;")
print(f"   pure 'the'/'of the' glosses have english_head NULL and are not even candidates.)\n")
for k in order:
    star = "  <-- #2/#3 TARGET" if k == "ARTIFACT-REPAIRABLE" else ""
    print(f"  {k:20}: {buckets[k]:6,}{star}")
print()
if per_host:
    print("  ARTIFACT-REPAIRABLE by host strongs_base:")
    for hb_, n in per_host.most_common():
        print(f"      {hb_:8}: {n:,}")
    print()
if art_heads:
    print(f"  top REPAIRABLE leaked nouns: {art_heads.most_common(20)}\n")

label = {
    "ARTIFACT-REPAIRABLE": "ref | host | english_head | host english | orphan",
    "ARTIFACT-PN": "ref | host | english_head | host english | orphan (proper noun)",
    "ORPHAN-NOMATCH": "ref | host | english_head | host english | orphan (gloss no-match)",
    "NO-ORPHAN": "ref | host | english_head | host english | (no empty content nbr)",
}
to_show = ["ARTIFACT-REPAIRABLE", "ARTIFACT-PN"]
if SHOW_NOMATCH:
    to_show += ["ORPHAN-NOMATCH", "NO-ORPHAN"]
for k in to_show:
    if samples[k]:
        print(f"  --- {k} samples ({label[k]}) ---")
        for ref, sb, head, eng, det in samples[k]:
            print(f"      {ref:12} | {sb:7} | {head!r:14} | {(eng or '')!r:30} | {det}")
        print()

print("ARTIFACT-REPAIRABLE is the partitioned target count. Report it before proposing")
print("a repair. (Same UPDATE-only dual-ordering as fix_lord_subject.py: move the noun")
print("onto its empty content slot, position=Greek order, greek_pos=reading order.)")
