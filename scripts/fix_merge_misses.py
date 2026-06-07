#!/usr/bin/env python3
"""fix_merge_misses.py — hand-verified reorder-MERGE fixes that the automatic
generator (_gen_split_candidates.py) can't catch, because the verb's English is a
word-FORM the lexicon match misses ("hearkened" vs the dictionary's "hearken").

Same shape as fix_split_merges: two source words crammed on one chip, the verb's
chip left blank. These are added one at a time as spotted. Each row is pinned to
verse+position+strongs+current-english, so it only acts on the bad state — safe to
re-run and to keep in the post-rebuild repair chain.

Usage:
  python3 scripts/fix_merge_misses.py bible.db          # dry-run
  python3 scripts/fix_merge_misses.py bible.db --apply

Each entry: (book, ch, vs, [ (old_pos, strongs_base, old_eng, new_eng, new_head, new_pos), ... ])
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
APPLY = "--apply" in sys.argv

MISSES = [
    # Dan 9:10 "we hearkened not to the voice": εἰσακούω/G1522 (hearken) left blank,
    # "we hearkened" lumped on the negation οὐ/G3756. Move the verb to its own chip
    # and put it first so reading order stays "we hearkened not to the voice".
    ("Dan", 9, 10, [
        (1, "G3756", "we hearkened not to", "not to",       None,        2),
        (2, "G1522", None,                  "we hearkened", "hearkened", 1),
    ]),
]

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

applied = skipped = 0
for book, ch, vs, ops in MISSES:
    v = conn.execute("SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                     (book, ch, vs)).fetchone()
    ref = f"{book} {ch}:{vs}"
    if not v:
        print(f"{ref}: verse not found — skip"); skipped += 1; continue
    plan, ok = [], True
    for old_pos, sbase, old_eng, new_eng, new_head, new_pos in ops:
        r = conn.execute("SELECT id, english, strongs_base FROM words WHERE verse_id=? AND position=?",
                         (v["id"], old_pos)).fetchone()
        if not r or r["strongs_base"] != sbase or (r["english"] or "") != (old_eng or ""):
            ok = False
            cur = (r["strongs_base"], r["english"]) if r else None
            print(f"{ref}: pos {old_pos} state changed/fixed ({cur}) — skip")
            break
        plan.append((r["id"], new_eng, new_head, new_pos))
    if not ok:
        skipped += 1; continue
    print(f"{ref}: " + "  ".join(f"pos{op[0]}->{op[3]} {op[1]!r}" for op in ops))
    if APPLY:
        for rid, new_eng, new_head, new_pos in plan:
            conn.execute("UPDATE words SET english=?, english_head=?, position=? WHERE id=?",
                         (new_eng, new_head, new_pos, rid))
    applied += 1

if APPLY:
    conn.commit()
conn.close()
print(f"\n{'APPLIED' if APPLY else 'DRY-RUN'} — {applied} verse(s), {skipped} skipped  [DB: {DB}]")
if not APPLY:
    print("(dry-run — re-run with --apply to write)")
