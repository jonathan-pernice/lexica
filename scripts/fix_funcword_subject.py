#!/usr/bin/env python3
"""
fix_funcword_subject.py — DUAL-ORDERING use-case #2, ROUND 1 (clear nouns).

THE BUG: a real Greek noun's English got bundled onto an adjacent FUNCTION-WORD
slot (the article G3588, or a preposition) while the noun's OWN content slot sits
EMPTY right beside it. Clicking the noun then opens the article/preposition, not
the noun. (Found + partitioned by audit_funcword_wrongslot.py.)

THE FIX (simplest safe form — even simpler than fix_lord_subject.py):
  Because one of the two adjacent slots is ALWAYS empty, we just RELOCATE the
  bundled English from the function-word slot onto the noun's own (empty) slot and
  blank the function-word slot. The two slots are adjacent and one is always empty,
  so the verse's visible word sequence is UNCHANGED — we only change WHICH Strong's
  each word is attached to. No reordering, no brackets, no greek_pos juggling, so
  there is zero chance of the bracket word-order garble this machinery has a history
  of. Touches english / english_head / italic / italic_words ONLY — never strongs /
  strongs_base / morph / lemma / position / greek_pos / bracket_id / is_pn.

  before:  [G3588  english="in his heart."] [G2588 καρδία  english=∅]
  after:   [G3588  english=∅]               [G2588 καρδία  english="in his heart."]
  -> verse still reads "...in his heart."; now clicking it opens καρδία/G2588.

SCOPE (round 1 = the clean concrete-noun set, ~26): a function-word host (article
or preposition) with a non-empty, content-headed gloss, whose ADJACENT (±1) slot is
an EMPTY, bracket-free, real-Strong's NOUN (morph POS = N, or is_pn) whose LEXICON
definition contains the host's head word (same kjv_def/strongs_def evidence test the
build's _split_compounds uses). EXCLUDES the idiom clusters κατὰ πρόσωπον "in front"
(G4383) and ἐν τάχει "quickly" (G5034) — those are round 2 (--include-idioms).
Both the host and the orphan must be bracket-free (mirrors fix_lord_subject.py).

IDEMPOTENT: after a run the host is empty (no longer a candidate) and the noun slot
is non-empty on a non-function Strong's (never a candidate) — safe to re-run. ADD to
the CLAUDE.md post-rebuild repair chain (a fresh rebuild re-bundles these); run AFTER
fix_lord_subject.py.

Validate: audit_funcword_wrongslot.py (REPAIRABLE-NOUN -> ~0 after, idioms aside),
health_check.py (0/0), strongs_base GLOB '[0-9]*' = 0, audit_bracket_order.py (at
baseline — we create NO brackets).

Usage:
  python3 scripts/fix_funcword_subject.py bible.db --dry-run
  python3 scripts/fix_funcword_subject.py bible.db
  python3 scripts/fix_funcword_subject.py bible.db --include-idioms   # round 2
"""
import os
import re
import signal
import sqlite3
import sys

if hasattr(signal, "SIGPIPE"):
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_abp import _head_word, _FUNCTION_WORDS, _HEAD_STOP

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv
INCLUDE_IDIOMS = "--include-idioms" in sys.argv

ARTICLE_BASE = "G3588"
PREP_BASES = {
    "G1722", "G1519", "G1537", "G575", "G4314", "G1909", "G2596", "G3326",
    "G1223", "G5259", "G5228", "G3844", "G4012", "G1799", "G1715", "G3694",
    "G561", "G1726", "G630", "G1838", "G3936",
}
HOSTS = {ARTICLE_BASE} | PREP_BASES

# Object/possessive pronouns + substantival words the build's set misses — these as
# the bundled "head" are never a concrete-noun leak (same list as the audit).
_EXTRA_FUNC = {
    "me", "him", "them", "us", "thee", "thy", "thine", "mine", "whom", "whose",
    "one", "ones", "thing", "things", "both", "who", "which", "what", "all",
    "any", "some", "each", "every", "other", "others", "same", "such",
    "whoever", "whatever", "anyone", "none",
}
SKIP_HEADS = set(_FUNCTION_WORDS) | set(_HEAD_STOP) | _EXTRA_FUNC

# Idiom clusters held back for round 2 (real nouns, but fixed prepositional idioms).
IDIOM_ORPHANS = {"4383", "5034"}     # πρόσωπον "in front/person/face", τάχος "quickly"


def bare(s):
    return re.sub(r"[^\w]", "", s or "").lower()


def derive_head(english):
    """Last content word of the gloss (skips SKIP_HEADS); None if all function."""
    for tok in reversed((english or "").split()):
        b = bare(tok)
        if b and b not in SKIP_HEADS:
            return b
    return None


def pos_of(morph):
    if not morph:
        return None
    c = morph.lstrip("-")[:1].upper()
    return c if c.isalpha() else None


conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

lex = {}
for strongs, kjv_def, strongs_def in conn.execute(
        "SELECT strongs, kjv_def, strongs_def FROM lexicon"):
    base = (strongs or "").lstrip("GH").split(".")[0]
    text = " ".join(filter(None, [kjv_def, strongs_def]))
    lex[base] = set(re.sub(r"[^\w\s]", " ", text).lower().split())

WCOLS = {r[1] for r in conn.execute("PRAGMA table_info(words)")}
HAS_PN = "is_pn" in WCOLS
HAS_MORPH = "morph" in WCOLS
PN_SEL = "is_pn" if HAS_PN else "0 AS is_pn"
MORPH_SEL = "morph" if HAS_MORPH else "NULL AS morph"


def neighbour(verse_id, position, delta):
    return conn.execute(
        f"SELECT position, english, english_head, strongs_base, bracket_id, "
        f"       italic, italic_words, {PN_SEL}, {MORPH_SEL} "
        f"FROM words WHERE verse_id=? AND position=?",
        (verse_id, position + delta)).fetchone()


def orphan_ok(nb):
    """nb is an EMPTY, bracket-free, real-Strong's NOUN whose def matches the head
    (checked by caller). Returns the bare base if it qualifies structurally."""
    if not nb or (nb["english"] or "").strip() != "":
        return None
    if nb["bracket_id"] is not None:
        return None
    sb = nb["strongs_base"]
    if not sb or sb in ("*", "", ARTICLE_BASE) or sb in HOSTS:
        return None
    base = sb.lstrip("GH").split(".")[0]
    is_noun = (pos_of(nb["morph"]) == "N") or (HAS_PN and nb["is_pn"] == 1)
    if not is_noun:
        return None
    if not INCLUDE_IDIOMS and base in IDIOM_ORPHANS:
        return None
    return base


cands = conn.execute(
    "SELECT w.verse_id, w.position, w.english, w.italic, w.italic_words, "
    "       w.bracket_id, v.book, v.chapter, v.verse "
    "FROM words w JOIN verses v ON v.id = w.verse_id "
    f"WHERE w.strongs_base IN ({','.join('?' * len(HOSTS))}) "
    "  AND w.english IS NOT NULL AND w.english != '' AND w.bracket_id IS NULL "
    "ORDER BY w.verse_id, w.position", tuple(HOSTS)).fetchall()

applied = 0
print(f"{'[DRY RUN] ' if DRY else ''}function-word noun-relocate fix -> {DB}"
      f"  (idioms {'INCLUDED' if INCLUDE_IDIOMS else 'excluded'})\n")

for c in cands:
    head = derive_head(c["english"])
    if not head:
        continue
    vid, ph = c["verse_id"], c["position"]

    # Find the adjacent empty NOUN slot (prefer +1) whose def contains the head.
    chosen = None
    for delta in (1, -1):
        nb = neighbour(vid, ph, delta)
        base = orphan_ok(nb)
        if base and head in lex.get(base, set()):
            chosen = (nb, delta, base)
            break
    if not chosen:
        continue
    nb, delta, base = chosen

    moved_eng = c["english"]
    new_head = _head_word(moved_eng)
    ref = f"{c['book']} {c['chapter']}:{c['verse']}"
    print(f"  {ref:12} host[{ph}]{c['strongs_base']:7} -> noun[{nb['position']}]"
          f"{nb['strongs_base']:7} ({'after' if delta > 0 else 'before'})")
    print(f"      move english {moved_eng!r}  (head -> {new_head!r})")

    if not DRY:
        # noun slot receives the bundled english (keeps its OWN strongs/morph/lemma)
        conn.execute(
            "UPDATE words SET english=?, english_head=?, italic=?, italic_words=? "
            "WHERE verse_id=? AND position=?",
            (moved_eng, new_head, c["italic"], c["italic_words"] or "",
             vid, nb["position"]))
        # function-word slot goes empty (keeps its OWN G3588/prep strongs)
        conn.execute(
            "UPDATE words SET english=NULL, english_head=NULL, italic=0, italic_words='' "
            "WHERE verse_id=? AND position=?",
            (vid, ph))
    applied += 1

if not DRY:
    conn.commit()
    print(f"\napplied {applied} function-word noun-relocate fixes.")
else:
    print(f"\n[DRY RUN] {applied} fixes would be applied. No changes written.")
conn.close()
