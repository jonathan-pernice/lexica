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
  the article "the"; the SUBSTANTIVAL article (he/she/it/this/that/who/one/ones/
  things/both); the OBLIQUE-case article carrying the case's English preposition
  (τοῦ→"of", τῷ→"to/in the"). A blanket "article = only 'the'" rule would DESTROY
  real Greek. So we partition legit-vs-artifact using the DATA, never a wordlist.

DISCRIMINATOR — a candidate must clear ALL of:
  1. the function-word slot's bundled head (re-derived here, NOT trusted from the
     stale english_head column) is a CONTENT word — i.e. NOT in the build's own
     _FUNCTION_WORDS / _HEAD_STOP / object-pronoun / substantival sets. (This drops
     the false positives where the gloss is itself just "the"/"to"/"in"/"me".)
  2. an ADJACENT slot is EMPTY (no english) yet carries a REAL content Strong's
     (not G3588, not '*', not '') — that is the orphaned Greek word's own slot.
  3. the orphan slot's LEXICON definition CONTAINS that head (head 'god' ∈
     def(G2316 θεός); 'name' ∈ def(G3686 ὄνομα)). Same kjv_def/strongs_def
     evidence test the build's _split_compounds uses — ties the leaked noun to its
     real empty Greek slot with no heuristic.

  The matched set is then split by the ORPHAN's part of speech (its morph column):
  NOUN orphans are the high-value concrete/proper-noun leaks (God, name, heart,
  judgment, midst, riches…); ADJ/ADV/other orphans (own, whole, all, quickly,
  alone — real Greek words too, but adverbial/quantifier) are shown apart so the
  fix can be prioritised or scoped.

BUCKETS:
  REPAIRABLE-NOUN   content head + empty orphan + gloss-match + orphan is a NOUN
                    (or is_pn) -> the high-value #2/#3 target
  REPAIRABLE-OTHER  same, but orphan is adj/adv/quantifier/pronoun (gray zone)
  ORPHAN-NOMATCH    empty orphan but its gloss does NOT contain the head — review
  NO-ORPHAN         content head, no empty content neighbour (supplied 'son of X',
                    substantival) — NOT a target
  SKIPPED-FUNC-HEAD the bundled head is itself a function/pronoun word — not a target

READ-ONLY (mode=ro). Run on PA from the repo root (needs bible.db only):
  python3 scripts/audit_funcword_wrongslot.py bible.db
  python3 scripts/audit_funcword_wrongslot.py bible.db --preps        # add prep hosts
  python3 scripts/audit_funcword_wrongslot.py bible.db --dump-all      # list every hit
  python3 scripts/audit_funcword_wrongslot.py bible.db --book 1Sa
"""
import os
import re
import sqlite3
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from parse_abp import _FUNCTION_WORDS, _HEAD_STOP
except Exception:                                       # pragma: no cover
    _FUNCTION_WORDS, _HEAD_STOP = frozenset(), frozenset()

ARGS = sys.argv[1:]
DB = next((a for a in ARGS if not a.startswith("--")), "bible.db")
WITH_PREPS = "--preps" in ARGS
DUMP_ALL = "--dump-all" in ARGS
BOOK_FILTER = ARGS[ARGS.index("--book") + 1] if "--book" in ARGS else None

ARTICLE_BASE = "G3588"
PREP_BASES = {
    "G1722", "G1519", "G1537", "G575", "G4314", "G1909", "G2596", "G3326",
    "G1223", "G5259", "G5228", "G3844", "G4012", "G1799", "G1715", "G3694",
    "G561", "G1726", "G630", "G1838", "G3936",
}
HOSTS = {ARTICLE_BASE} | (PREP_BASES if WITH_PREPS else set())

# Object/possessive pronouns + substantival renderings the build's set misses —
# these as the "head" are never a concrete-noun leak.
_EXTRA_FUNC = {
    "me", "him", "them", "us", "thee", "thy", "thine", "mine", "whom", "whose",
    "one", "ones", "thing", "things", "both", "who", "which", "what", "all",
    "any", "some", "each", "every", "other", "others", "same", "such",
    "whoever", "whatever", "anyone", "none",
}
SKIP_HEADS = set(_FUNCTION_WORDS) | set(_HEAD_STOP) | _EXTRA_FUNC


def bare(s):
    return re.sub(r"[^\w]", "", s or "").lower()


def singular(w):
    """Crude singulariser so a plural head matches a singular gloss (fruits->fruit)."""
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith(("ses", "xes", "zes", "ches", "shes")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def gloss_has(head, base):
    d = lex.get(base, set())
    return head in d or singular(head) in d


def derive_head(english):
    """Re-derive the content head from the gloss (last word not in SKIP_HEADS),
    independent of the possibly-stale english_head column. None if all function."""
    for tok in reversed((english or "").split()):
        b = bare(tok)
        if b and b not in SKIP_HEADS:
            return b
    return None


def pos_of(morph):
    """Coarse part-of-speech letter from the morph code (CATSS OT / Robinson NT
    both lead with the POS letter). 'N'=noun, 'A'=adjective, 'V'=verb, etc."""
    if not morph:
        return None
    c = morph.lstrip("-")[:1].upper()
    return c if c.isalpha() else None


conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

lex, lex_text = {}, {}
for strongs, kjv_def, strongs_def in conn.execute(
        "SELECT strongs, kjv_def, strongs_def FROM lexicon"):
    base = (strongs or "").lstrip("GH").split(".")[0]
    text = " ".join(filter(None, [kjv_def, strongs_def]))
    lex[base] = set(re.sub(r"[^\w\s]", " ", text).lower().split())
    lex_text[base] = (kjv_def or strongs_def or "")[:32]

WCOLS = {r[1] for r in conn.execute("PRAGMA table_info(words)")}
HAS_PN = "is_pn" in WCOLS
HAS_MORPH = "morph" in WCOLS
PN_SEL = "w2.is_pn" if HAS_PN else "0 AS is_pn"
MORPH_SEL = "w2.morph" if HAS_MORPH else "NULL AS morph"


def neighbour(verse_id, position, delta):
    return conn.execute(
        f"SELECT w2.english, w2.strongs_base, w2.bracket_id, {PN_SEL}, {MORPH_SEL} "
        f"FROM words w2 WHERE w2.verse_id=? AND w2.position=?",
        (verse_id, position + delta)).fetchone()


def find_orphan(verse_id, position):
    """Adjacent EMPTY slot with a real content Strong's. Prefer +1 (article
    precedes its noun: ὁ υἱός), then -1."""
    for delta in (1, -1):
        nb = neighbour(verse_id, position, delta)
        if nb and (nb["english"] or "").strip() == "":
            sb = nb["strongs_base"]
            if sb and sb not in ("*", "", ARTICLE_BASE) and sb not in HOSTS:
                return nb, delta
    return None, None


host_label = "G3588 + preps" if WITH_PREPS else "G3588 (article)"
q = (
    "SELECT w.verse_id, w.position, w.english, w.strongs_base, w.bracket_id, "
    "       v.book, v.chapter, v.verse "
    "FROM words w JOIN verses v ON v.id = w.verse_id "
    "WHERE w.strongs_base IN (%s) AND w.english IS NOT NULL AND w.english != '' "
    "ORDER BY w.verse_id, w.position" % ",".join("?" * len(HOSTS))
)
cands = conn.execute(q, tuple(HOSTS)).fetchall()

buckets = Counter()
per_host = Counter()             # REPAIRABLE-NOUN by host
pos_tally = Counter()            # all gloss-matched orphans by POS
art_heads = Counter()           # REPAIRABLE-NOUN head -> count
hits = {"REPAIRABLE-NOUN": [], "REPAIRABLE-OTHER": [],
        "ORPHAN-NOMATCH": [], "ARTIFACT-PN": []}

for c in cands:
    if BOOK_FILTER and c["book"] != BOOK_FILTER:
        continue
    hb = derive_head(c["english"])
    if not hb:
        buckets["SKIPPED-FUNC-HEAD"] += 1
        continue

    orphan, delta = find_orphan(c["verse_id"], c["position"])
    ref = f"{c['book']} {c['chapter']}:{c['verse']}"
    if orphan is None:
        buckets["NO-ORPHAN"] += 1
        continue

    obase = (orphan["strongs_base"] or "").lstrip("GH").split(".")[0]
    opos = pos_of(orphan["morph"])
    gloss = lex_text.get(obase, "")
    odetail = (f"orphan[{delta:+d}]={orphan['strongs_base']} "
               f"pos={opos or '?'} def={gloss!r}")
    rec = (ref, c["strongs_base"], hb, c["english"], odetail)

    if HAS_PN and orphan["is_pn"] == 1:
        buckets["ARTIFACT-PN"] += 1
        hits["ARTIFACT-PN"].append(rec)
    elif gloss_has(hb, obase):
        pos_tally[opos or "?"] += 1
        is_noun = (opos == "N") or (HAS_PN and orphan["is_pn"] == 1)
        if is_noun:
            buckets["REPAIRABLE-NOUN"] += 1
            per_host[c["strongs_base"]] += 1
            art_heads[hb] += 1
            hits["REPAIRABLE-NOUN"].append(rec)
        else:
            buckets["REPAIRABLE-OTHER"] += 1
            hits["REPAIRABLE-OTHER"].append(rec)
    else:
        buckets["ORPHAN-NOMATCH"] += 1
        hits["ORPHAN-NOMATCH"].append(rec)

conn.close()

# ── report ──────────────────────────────────────────────────────────────────
order = ["REPAIRABLE-NOUN", "REPAIRABLE-OTHER", "ARTIFACT-PN",
         "ORPHAN-NOMATCH", "NO-ORPHAN", "SKIPPED-FUNC-HEAD"]
total = sum(buckets.values())
print(f"READ-ONLY function-word WRONG-SLOT audit -> {DB}")
print(f"  hosts: {host_label}   candidate function-word slots (with english): {total:,}")
print(f"  (head re-derived from the gloss, NOT the stale english_head column)\n")
for k in order:
    star = "  <-- #2/#3 TARGET" if k == "REPAIRABLE-NOUN" else ""
    print(f"  {k:18}: {buckets[k]:6,}{star}")
print()
print(f"  matched-orphan POS breakdown (N=noun A=adj V=verb '?'=no morph): "
      f"{dict(pos_tally.most_common())}")
if per_host:
    print(f"\n  REPAIRABLE-NOUN by host: {dict(per_host.most_common())}")
if art_heads:
    print(f"  top REPAIRABLE-NOUN leaked words: {art_heads.most_common(25)}")
print()

show = ["REPAIRABLE-NOUN", "REPAIRABLE-OTHER", "ARTIFACT-PN"]
if DUMP_ALL:
    show += ["ORPHAN-NOMATCH"]
for k in show:
    rows = hits[k] if DUMP_ALL else hits[k][:15]
    if rows:
        print(f"  --- {k} ({len(hits[k])}) — ref | host | head | host english | orphan ---")
        for ref, sb, head, eng, det in rows:
            print(f"      {ref:12} | {sb:7} | {head!r:12} | {(eng or '')!r:24} | {det}")
        print()

print("REPAIRABLE-NOUN is the partitioned, high-value target. REPAIRABLE-OTHER is the")
print("adverb/quantifier gray zone (real Greek too, lower priority). Report both before")
print("a repair (UPDATE-only dual-ordering like fix_lord_subject.py).")
