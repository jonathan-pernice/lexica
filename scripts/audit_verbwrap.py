#!/usr/bin/env python3
"""
audit_verbwrap.py — READ-ONLY. Scope finder for DUAL-ORDERING use-case #3:
a Greek VERB's English gloss bundled onto a NEIGHBOUR (usually the subject
pronoun) while the verb's OWN slot sits EMPTY — often with a leading wrapper word
("may"/"as"/"when"/"shall") that wraps around the subject in English.

  1Pe 5:10:  "may he ready" on G1473 (αὐτός) | G2675 καταρτίζω = ∅
  Joh 4:51:  "as he was going down" on G1473 | G2597 καταβαίνω = ∅

This is the harder case than #1/#2: the verb slot is empty, but the gloss can't be
moved WHOLE (the subject pronoun "he" must stay on its own pronoun slot), and the
verb wraps AROUND the subject in English — so a faithful fix needs to split the verb
words off (and may need an INSERTED row to preserve the "may … ready" wrap). This
audit only SCOPES + BUCKETS; it fixes nothing.

WHAT IT FINDS: every EMPTY slot that is a real-Strong's VERB (morph POS = V), and
the adjacent non-empty slot ("host") that carries the bundled gloss. Buckets:
  PRONOUN-HOST   host is a pronoun (the 1Pe 5:10 / Joh 4:51 shape) — the core target
  NOUN-HOST      host is a noun/other content slot
  BRACKETED      the empty verb or its host is inside a bracket (jussive shape,
                 1Th 3:11 / Num 6:24) — needs bracket-aware handling
  NO-HOST        empty verb with no adjacent non-empty slot (nothing bundled nearby)
Within PRONOUN/NOUN-HOST, flags whether the host gloss starts with a known WRAPPER
word (may/as/when/while/shall/will/should/would/let/to/having/being/if/that) — those
are the clearest "verb-gloss wrapped around the subject" cases.

READ-ONLY (mode=ro). Run on PA:  python3 scripts/audit_verbwrap.py bible.db
  --book 1Pe     filter one book
  --show all      dump every PRONOUN-HOST (default: samples)
"""
import re
import sqlite3
import sys
from collections import Counter

ARGS = sys.argv[1:]
DB = next((a for a in ARGS if not a.startswith("--")), "bible.db")
BOOK_FILTER = ARGS[ARGS.index("--book") + 1] if "--book" in ARGS else None
SHOW_ALL = "--show" in ARGS and ARGS[ARGS.index("--show") + 1] == "all" \
    if "--show" in ARGS else False

ARTICLE_BASE = "G3588"
# Pronoun Strong's (αὐτός + the personal/possessive paradigm bases).
PRONOUN_BASES = {
    "846", "1473", "4771", "5210", "2248", "2249", "5209", "5213", "5216",
    "1700", "1698", "3427", "3450", "3165", "4675", "4671", "4572", "1683",
    "2257", "2254", "5100", "3739",
}
WRAPPERS = {
    "may", "as", "when", "while", "shall", "will", "should", "would", "let",
    "to", "having", "being", "if", "that", "so", "in", "for",
}


def bare(s):
    return re.sub(r"[^\w]", "", s or "").lower()


def pos_of(morph):
    if not morph:
        return None
    c = morph.lstrip("-")[:1].upper()
    return c if c.isalpha() else None


conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
WCOLS = {r[1] for r in conn.execute("PRAGMA table_info(words)")}
HAS_MORPH = "morph" in WCOLS
if not HAS_MORPH:
    print("ERROR: words.morph not present — needed to detect verbs.")
    sys.exit(1)


def neighbour(verse_id, position, delta):
    return conn.execute(
        "SELECT position, english, english_head, strongs_base, bracket_id, morph "
        "FROM words WHERE verse_id=? AND position=?",
        (verse_id, position + delta)).fetchone()


# Empty slots that are real-Strong's VERBS.
empties = conn.execute(
    "SELECT w.verse_id, w.position, w.strongs_base, w.bracket_id, w.morph, "
    "       v.book, v.chapter, v.verse "
    "FROM words w JOIN verses v ON v.id = w.verse_id "
    "WHERE (w.english IS NULL OR w.english = '') "
    "  AND w.morph IS NOT NULL "
    "ORDER BY w.verse_id, w.position"
).fetchall()

buckets = Counter()
wrapper_hits = Counter()
samples = {k: [] for k in ("PRONOUN-HOST", "NOUN-HOST", "BRACKETED")}

for e in empties:
    if BOOK_FILTER and e["book"] != BOOK_FILTER:
        continue
    if pos_of(e["morph"]) != "V":
        continue
    sb = e["strongs_base"]
    if not sb or sb in ("*", "", ARTICLE_BASE):
        continue

    # the bundled gloss should be on an adjacent non-empty slot
    host, hdelta = None, None
    for delta in (-1, 1):          # verb usually trails its bundled subject (pronoun first)
        nb = neighbour(e["verse_id"], e["position"], delta)
        if nb and (nb["english"] or "").strip():
            host, hdelta = nb, delta
            break
    ref = f"{e['book']} {e['chapter']}:{e['verse']}"
    if host is None:
        buckets["NO-HOST"] += 1
        continue

    if e["bracket_id"] is not None or host["bracket_id"] is not None:
        bucket = "BRACKETED"
    else:
        hbase = (host["strongs_base"] or "").lstrip("GH").split(".")[0]
        if hbase in PRONOUN_BASES or pos_of(host["morph"]) in ("R", "P"):
            bucket = "PRONOUN-HOST"
        else:
            bucket = "NOUN-HOST"
    buckets[bucket] += 1

    first = bare((host["english"] or "").split()[0]) if host["english"] else ""
    has_wrap = first in WRAPPERS
    if bucket in ("PRONOUN-HOST", "NOUN-HOST") and has_wrap:
        wrapper_hits[bucket] += 1

    if bucket in samples:
        cap = 9999 if (SHOW_ALL and bucket == "PRONOUN-HOST") else 15
        if len(samples[bucket]) < cap:
            samples[bucket].append((
                ref, e["strongs_base"], f"{hdelta:+d}", host["strongs_base"],
                (host["english"] or "")[:42], "WRAP" if has_wrap else ""))

conn.close()

print(f"READ-ONLY verb-wrap audit (DUAL-ORDERING #3 scope) -> {DB}")
print(f"  empty real-Strong's VERB slots, by where the gloss bundled:\n")
for k in ("PRONOUN-HOST", "NOUN-HOST", "BRACKETED", "NO-HOST"):
    extra = ""
    if k in wrapper_hits:
        extra = f"   ({wrapper_hits[k]} start with a wrapper word may/as/when/…)"
    print(f"  {k:13}: {buckets[k]:6,}{extra}")
print()
print("  PRONOUN-HOST + WRAP = the clean 1Pe 5:10 / Joh 4:51 core (verb gloss wrapped")
print("  around the subject pronoun). BRACKETED = the jussive shape (1Th 3:11 / Num 6:24).")
print()
for k in ("PRONOUN-HOST", "NOUN-HOST", "BRACKETED"):
    if samples[k]:
        print(f"  --- {k} samples (ref | empty-verb | host@Δ | host strongs | host english | wrap) ---")
        for ref, vb, d, hsb, heng, w in samples[k]:
            print(f"      {ref:12} | {vb:7} | {d:+3} | {hsb or '-':7} | {heng!r:44} | {w}")
        print()
print("Read-only. Report PRONOUN-HOST/WRAP count before proposing a #3 fix (it may need")
print("an INSERTED row to keep the verb wrapping around the subject).")
