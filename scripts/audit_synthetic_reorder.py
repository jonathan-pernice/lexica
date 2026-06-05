#!/usr/bin/env python3
"""
audit_synthetic_reorder.py — READ-ONLY accuracy audit of the synthetic
pronoun-compound reorder brackets our build invents.

Background
----------
ABP often bundles a verb's whole English onto an adjacent PRONOUN slot and leaves
the verb's own slot glossless (Gen 3:16 "will dominate you." sits on σου; κυριεύω
is empty). `_redistribute_pronoun_compounds` (build_words_from_abp.py) splits that
back — pronoun word stays on the pronoun (greek_pos 2, English-second), the rest
moves to the verb slot (greek_pos 1, English-first) — and wraps the pair in a NEW
("synthetic") bracket so prose reads verb-then-pronoun. Unlike real ABP brackets,
WE invented the reorder here, so it's the order worth auditing.

What this checks
----------------
* Scope: how many synthetic reorder brackets exist, OT vs NT.
* Accuracy signal: the reconstruction reads "verb + pronoun", which is correct for
  an OBJECT/possessive pronoun ("scrutinizes you", "give heed to your") but WRONG
  for a SUBJECT pronoun ("he/they/we ..." would read "verb he"). So we FLAG any
  bracket whose pronoun word is a subject-form pronoun for manual review.

Identification (DB signature of the redistribute output): a bracket (≥2 displayed
words) whose HIGHEST-greek_pos word is a known pronoun Strong's AND whose gloss is
a bare pronoun word, with ≥1 lower-greek_pos partner (the moved verb phrase).

READ-ONLY (mode=ro). Never writes.

Usage:
  python3 scripts/audit_synthetic_reorder.py bible.db
  python3 scripts/audit_synthetic_reorder.py bible.db --sample 40
"""
import re
import sqlite3
import sys
from collections import defaultdict

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
SAMPLE = 20
if "--sample" in sys.argv:
    try:
        SAMPLE = int(sys.argv[sys.argv.index("--sample") + 1])
    except (ValueError, IndexError):
        pass

# Pronoun Strong's bases (prefixed) — mirrors _PRONOUN_BASES in the build.
PRONOUN_SB = {f"G{n}" for n in (
    "846", "4675", "4771", "4571", "4674", "4671",
    "5210", "5216", "5213", "5209", "2249", "2257", "2254", "2248",
)}

# English pronoun words ABP uses, split by likely syntactic role. SUBJECT forms
# are the ones where "verb + pronoun" reordering would read backwards → flag.
SUBJECT_PRON = {"i", "he", "she", "they", "we", "it"}
OBJ_POSS_PRON = {
    "me", "my", "mine", "myself",
    "you", "your", "yours", "yourself", "yourselves", "thou", "thee", "thy", "thine", "ye",
    "him", "his", "himself", "her", "hers", "herself", "its", "itself",
    "us", "our", "ours", "ourselves",
    "them", "their", "theirs", "themselves", "same",
}
PRON_WORDS = SUBJECT_PRON | OBJ_POSS_PRON

TRAIL = re.compile(r"[.,;:!?·]+$")
# OT books precede Mat; classify by a small NT set.
NT_BOOKS = {
    "Mat", "Mar", "Luk", "Joh", "Act", "Rom", "1Co", "2Co", "Gal", "Eph", "Php",
    "Col", "1Th", "2Th", "1Ti", "2Ti", "Tit", "Phm", "Heb", "Jas", "1Pe", "2Pe",
    "1Jn", "2Jn", "3Jn", "Jud", "Rev",
}


def bareword(eng):
    return re.sub(r"[^\w]", "", (eng or "")).lower()


conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    """SELECT w.id, w.verse_id, w.position, w.english, w.greek_pos, w.bracket_id,
              w.strongs_base, v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       WHERE w.bracket_id IS NOT NULL
       ORDER BY w.verse_id, w.bracket_id, w.position"""
).fetchall()

groups = defaultdict(list)
for r in rows:
    groups[(r["verse_id"], r["bracket_id"])].append(r)

candidates = []   # (ref, testament, pronoun_word, move_phrase, is_subject)
for (vid, bid), members in groups.items():
    disp = [m for m in members if (m["english"] or "").strip()]
    if len(disp) < 2:
        continue
    # highest greek_pos displayed word = the (English-last) pronoun in our output
    gp = [m for m in disp if m["greek_pos"] is not None]
    if not gp:
        continue
    pron = max(gp, key=lambda m: m["greek_pos"])
    pw = bareword(pron["english"])
    if pron["strongs_base"] not in PRONOUN_SB or pw not in PRON_WORDS:
        continue
    # must have a lower-greek_pos partner carrying the moved verb phrase
    movers = [m for m in disp if m is not pron and (m["greek_pos"] or 99) < pron["greek_pos"]]
    if not movers:
        continue
    book = pron["book"]
    testament = "NT" if book in NT_BOOKS else "OT"
    move_phrase = " ".join((m["english"] or "").strip() for m in
                           sorted(movers, key=lambda m: (m["greek_pos"] or 99, m["position"])))
    candidates.append({
        "ref": f"{book} {pron['chapter']}:{pron['verse']}",
        "testament": testament,
        "pron": (pron["english"] or "").strip(),
        "pw": pw,
        "move": move_phrase,
        "subject": pw in SUBJECT_PRON,
    })

n = len(candidates)
ot = sum(1 for c in candidates if c["testament"] == "OT")
nt = n - ot
flagged = [c for c in candidates if c["subject"]]

print(f"READ-ONLY synthetic-reorder audit -> {DB}\n")
print(f"  synthetic pronoun-reorder brackets ... {n:,}   (OT {ot:,} / NT {nt:,})")
print(f"  SUBJECT-pronoun cases (review!) ...... {len(flagged):,}")
print()
print("  Each reads 'verb + pronoun'. Correct for object/possessive pronouns;")
print("  a SUBJECT pronoun would read backwards ('verb he') and needs a look.\n")

if flagged:
    print("=== FLAGGED: subject-form pronoun (reads 'verb + subject') ===")
    for c in flagged[:SAMPLE]:
        print(f"  [{c['testament']}] {c['ref']:<12}  reorder reads: "
              f"\"{c['move']} {c['pron']}\"   (pronoun='{c['pron']}')")
    if len(flagged) > SAMPLE:
        print(f"  ... and {len(flagged) - SAMPLE:,} more flagged")
    print()

print("=== Sample of normal (object/possessive) cases ===")
shown = 0
for c in candidates:
    if c["subject"]:
        continue
    print(f"  [{c['testament']}] {c['ref']:<12}  \"{c['move']} {c['pron']}\"")
    shown += 1
    if shown >= SAMPLE:
        break

conn.close()
