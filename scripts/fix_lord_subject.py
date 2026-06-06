#!/usr/bin/env python3
"""
fix_lord_subject.py — DUAL-ORDERING pilot #1. Give the divine name "LORD" its own
clickable κύριος/G2962 chip when ABP bundled the SUBJECT onto the verb.

THE SHAPE (1Ch 13:10, ~795 occurrences):
    slot A   verb (e.g. θυμόω/G2373)   english = "the LORD was enraged"   ← subject+verb bundled here
    slot A+1 κύριος/G2962               english = ∅ (empty, bracket-free, nominative)
The verb slot carries the whole "(the) LORD <verb...>" gloss; the κύριος slot that
should hold the divine name sits right after it, EMPTY. Clicking "LORD" therefore
gives the verb's Strong's, not κύριος.

THE FIX (dual-ordering — mirrors _redistribute_pronoun_compounds in the build):
  * move "the LORD"   -> the empty κύριος slot, greek_pos = 1 (reads FIRST in English)
  * keep "<verb>"     -> stays on the verb slot,  greek_pos = 2 (reads SECOND)
  * bind the two in a NEW per-verse bracket.
POSITIONS ARE NEVER MOVED, so:
  CHIP  (position order)  = "<verb>" · "the LORD"   (Greek/source order; each clickable; LORD→G2962)
  PROSE (greek_pos order) = "the LORD <verb>"        (English reading order — unchanged from today)
This is why the dual-ordering is required: the slot is in Greek (verb-subject) order but
the English reads subject-verb; a flat move would garble. We touch ONLY english /
english_head / greek_pos / bracket_id / italic_words / italic — never strongs /
strongs_base / morph / lemma / is_pn (each slot keeps its OWN Greek identity).

SCOPE — only the CLEAN head shape '(the) LORD <verb...>' with an adjacent empty,
non-bracketed κύριος/G2962. EXCLUDED (left for later use cases / out of scope):
  * wrapped jussives "May the LORD add" (a word precedes LORD → 2-slot move misorders)
  * "the LORD lives," oaths and "of the LORD" / single-"LORD" bundles (no adjacent empty G2962)
The matcher is identical to audit_lord_strongs.py's REPAIRABLE bucket (789 capital +
6 lowercase 'lord' = 795). Run that audit first to see the target set.

IDEMPOTENT: keyed on slot-pair SHAPE, not absolute position. After a run, slot A is
bracketed and slot B is non-empty, so neither matches again — safe to re-run. ADD to
the CLAUDE.md post-rebuild checklist (a fresh rebuild re-bundles these onto the verb).

Validate with audit_lord_strongs.py (WRONG-SLOT REPAIRABLE → ~0 after), health_check.py
(0/0), audit_bracket_order.py, and the strongs_base GLOB '[0-9]*' invariant (= 0).

Usage:
  python3 scripts/fix_lord_subject.py bible.db --dry-run
  python3 scripts/fix_lord_subject.py bible.db
"""
import os
import re
import signal
import sqlite3
import sys

# Don't traceback when piped into head/less (SIGPIPE). Unix-only; no-op elsewhere.
if hasattr(signal, "SIGPIPE"):
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_abp import _head_word          # last-content-word head (preserves LORD/God case)

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv
_ARTICLES = ("the", "a", "an")


def bare(s):
    return re.sub(r"[^\w]", "", s or "").lower()


def lord_prefix_split(eng):
    """'(the) LORD <rest...>' (LORD at the head, ≥1 word after) -> (move, keep).
    Else None — incl. wrapped 'May the LORD add' (a word before LORD)."""
    parts = eng.split()
    i = 0
    while i < len(parts) and bare(parts[i]) in _ARTICLES:
        i += 1
    if i >= len(parts) or bare(parts[i]) != "lord":
        return None
    move, keep = parts[: i + 1], parts[i + 1:]
    if not keep:
        return None
    return " ".join(move), " ".join(keep)


def carry_italics(words, src_iw_bare):
    """Sub-list of `words` whose bare form was italic on the source slot, comma-joined
    (matches the build's italic_words convention). '' if none."""
    return ",".join(w for w in words if bare(w) in src_iw_bare)


def italic_flag(head, iw_str):
    """Replicate build_verse_words: italic=1 iff the head/display word is italic."""
    iset = {x for x in (iw_str or "").split(",") if x}
    return 1 if head and head.lower() in iset else 0


conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

# Candidate verb slots: multi-word, non-bracketed, holding 'lord', not already κύριος.
cands = conn.execute(
    "SELECT w.verse_id, w.position, w.english, w.italic_words, "
    "       v.book, v.chapter, v.verse "
    "FROM words w JOIN verses v ON v.id = w.verse_id "
    "WHERE w.english LIKE '%lord%' AND w.english LIKE '% %' "
    "  AND w.bracket_id IS NULL AND w.strongs_base != 'G2962' "
    "ORDER BY w.verse_id, w.position"
).fetchall()

applied = 0
skipped = 0
print(f"{'[DRY RUN] ' if DRY else ''}LORD-subject dual-ordering fix -> {DB}\n")

for a in cands:
    split = lord_prefix_split(a["english"] or "")
    if not split:
        continue
    move, keep = split
    vid, pa = a["verse_id"], a["position"]

    # Slot B must be the immediately-following EMPTY, non-bracketed κύριος/G2962.
    b = conn.execute(
        "SELECT position, english, strongs_base, bracket_id "
        "FROM words WHERE verse_id=? AND position=?",
        (vid, pa + 1),
    ).fetchone()
    if not (b and (b["english"] or "").strip() == ""
            and b["strongs_base"] == "G2962" and b["bracket_id"] is None):
        continue

    src_iw_bare = {bare(x) for x in (a["italic_words"] or "").split(",") if x}
    move_words, keep_words = move.split(), keep.split()
    b_iw = carry_italics(move_words, src_iw_bare)     # "the" rides with LORD
    a_iw = carry_italics(keep_words, src_iw_bare)     # usually ""
    b_head = _head_word(move)                          # -> "LORD" / "lord"
    a_head = _head_word(keep)                          # -> verb (or None for bare copula)

    new_bid = (conn.execute(
        "SELECT COALESCE(MAX(bracket_id), 0) FROM words WHERE verse_id=?",
        (vid,)).fetchone()[0]) + 1

    ref = f"{a['book']} {a['chapter']}:{a['verse']}"
    print(f"  {ref:12} pos {pa}->{pa+1}  bid={new_bid}")
    print(f"      was : verb[{pa}]={a['english']!r}   κύριος[{pa+1}]=∅")
    print(f"      chip : {keep!r} (G·verb, gp2) · {move!r} (G2962, gp1)")
    print(f"      prose: {move} {keep}")

    if not DRY:
        # κύριος slot (B): receives "the LORD", reads first
        conn.execute(
            "UPDATE words SET english=?, english_head=?, greek_pos=1, bracket_id=?, "
            "italic_words=?, italic=? WHERE verse_id=? AND position=?",
            (move, b_head, new_bid, b_iw, italic_flag(b_head, b_iw), vid, pa + 1))
        # verb slot (A): keeps the verb gloss, reads second
        conn.execute(
            "UPDATE words SET english=?, english_head=?, greek_pos=2, bracket_id=?, "
            "italic_words=?, italic=? WHERE verse_id=? AND position=?",
            (keep, a_head, new_bid, a_iw, italic_flag(a_head, a_iw), vid, pa))
    applied += 1

if not DRY:
    conn.commit()
    print(f"\napplied {applied} LORD-subject fixes.")
else:
    print(f"\n[DRY RUN] {applied} fixes would be applied. No changes written.")
conn.close()
