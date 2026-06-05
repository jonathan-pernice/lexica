#!/usr/bin/env python3
"""
fix_subject_reorder.py — dissolve 20 synthetic subject-pronoun reorder brackets
that read backwards, restoring the ABP source word order.

Each listed verse had a SYNTHETIC bracket (our _redistribute_pronoun_compounds
invention; the ABP source has no bracket there) whose greek_pos put a verb/copula
in front of its subject pronoun ("may ready he", "is he", "are you"). The source
reads them subject-first. For each, this:
  * clears bracket_id + greek_pos on the bracket's words (drops the bracket so it
    renders in plain position order, no [ ] glyphs / numbers), and
  * rewrites ONLY the glosses noted so position order matches the source, and
  * (Dan 2:47) retags the "he" word G5216 -> G846 (it is αυτος, not υμων).

Touches english / bracket_id / greek_pos / strongs_base / morph on the LISTED
slots ONLY. No other rows. Re-runnable (idempotent once applied). Validate with
diff_split_fix.py + audit_order_mismatch.py, eyeball canaries, then deploy.

Mat 25:37 is intentionally NOT here — its pronoun slot is mis-GLOSSED (a separate
defect), to be handled on its own.

Usage:
  python3 scripts/fix_subject_reorder.py bible.db --dry-run
  python3 scripts/fix_subject_reorder.py bible.db
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv

# (group, book, ch, vs, anchor_pos, {pos: new_english}, {pos: new_strongs_base}, {pos: new_morph})
FIXES = [
    ("drop",   "Mar", 1, 45, 12, {}, {}, {}),
    ("retag",  "Dan", 2, 47, 12, {}, {12: "G846"}, {12: "RD.NSM"}),
    ("drop",   "Mat", 5, 14, 0,  {}, {}, {}),
    ("drop",   "Act", 3, 25, 0,  {}, {}, {}),
    ("drop",   "Act", 10, 15, 11, {}, {}, {}),
    ("drop",   "Act", 11, 9, 13, {}, {}, {}),
    ("drop",   "2Ch", 6, 25, 1,  {}, {}, {}),
    ("drop",   "Ecc", 10, 17, 1, {}, {}, {}),
    ("gloss",  "1Pe", 5, 10, 18, {18: "may he", 19: "ready"}, {}, {}),
    ("gloss",  "Joh", 4, 51, 2,  {2: "as he", 3: "was going down,"}, {}, {}),
    ("gloss",  "Eze", 11, 3, 11, {11: "and we", 12: "are"}, {}, {}),
    ("gloss",  "Job", 35, 13, 7, {7: "for he", 8: "is"}, {}, {}),
    ("gloss",  "Psa", 79, 13, 0, {0: "But we", 1: "are"}, {}, {}),
    ("gloss",  "Isa", 65, 11, 0, {0: "But you", 1: "are"}, {}, {}),
    ("gloss",  "Isa", 28, 20, 4, {4: "but we", 5: "are ourselves"}, {}, {}),
    ("quest",  "2Ki", 19, 11, 16, {16: "shall you", 17: "be rescued?"}, {}, {}),
    ("quest",  "1Ki", 17, 20, 21, {21: "have you", 22: "inflicted evil"}, {}, {}),
    ("quest",  "1Ki", 1, 24, 6, {6: "have you", 7: "said,"}, {}, {}),
    ("cleft",  "Mat", 26, 48, 11, {11: "it", 12: "is he;"}, {}, {}),
    ("cleft",  "Mar", 14, 44, 11, {11: "it", 12: "is he;"}, {}, {}),
]

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row


def verse_reading(verse_id, eng_override, dissolve_bid):
    """Chip-mode (position order) reading of a verse, applying pending changes.
    Bracketed words still render position-ordered here (chip view), which is what
    the user sees; dissolving the bracket only removes the [ ] glyphs/numbers."""
    rows = conn.execute(
        "SELECT position, english FROM words WHERE verse_id=? ORDER BY position",
        (verse_id,)).fetchall()
    out = []
    for r in rows:
        e = eng_override.get(r["position"], r["english"]) or ""
        if e.strip():
            out.append(e.strip())
    return " ".join(out)


applied = 0
print(f"{'[DRY RUN] ' if DRY else ''}subject-reorder fix -> {DB}\n")
for grp, book, ch, vs, anchor, overrides, retag, remorph in FIXES:
    v = conn.execute("SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                     (book, ch, vs)).fetchone()
    if not v:
        print(f"  !! {book} {ch}:{vs} not found — SKIPPED")
        continue
    vid = v["id"]
    anchor_row = conn.execute(
        "SELECT bracket_id, english FROM words WHERE verse_id=? AND position=?",
        (vid, anchor)).fetchone()
    if not anchor_row or anchor_row["bracket_id"] is None:
        print(f"  !! {book} {ch}:{vs} pos {anchor} has no bracket (already fixed?) — SKIPPED")
        continue
    bid = anchor_row["bracket_id"]

    before = verse_reading(vid, {}, None)
    after = verse_reading(vid, overrides, bid)
    print(f"  [{grp}] {book} {ch}:{vs}")
    print(f"      before: {before}")
    print(f"      after : {after}")
    if retag:
        print(f"      retag : {retag}")
    print()

    if not DRY:
        conn.execute(
            "UPDATE words SET bracket_id=NULL, greek_pos=NULL WHERE verse_id=? AND bracket_id=?",
            (vid, bid))
        for pos, eng in overrides.items():
            conn.execute("UPDATE words SET english=? WHERE verse_id=? AND position=?",
                         (eng, vid, pos))
        for pos, sb in retag.items():
            conn.execute("UPDATE words SET strongs_base=? WHERE verse_id=? AND position=?",
                         (sb, vid, pos))
        for pos, mo in remorph.items():
            conn.execute("UPDATE words SET morph=? WHERE verse_id=? AND position=?",
                         (mo, vid, pos))
        applied += 1

if not DRY:
    conn.commit()
    print(f"applied {applied} verse fixes.")
else:
    print("[DRY RUN] no changes written.")
conn.close()
