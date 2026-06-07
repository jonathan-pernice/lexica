#!/usr/bin/env python3
"""fix_theos_filler_tags.py — repairs two ABP rows where θεός (G2316) ended up
on a filler word in the Lexicon. READ-ONLY by default; pass --apply to write.

Both are pinned to an exact verse + position + current value, so the script only
acts when the bad state is present (safe to re-run, safe after a rebuild — add
it to the post-rebuild repair chain).

1) Lam 3:16 pos 0 — ABP itself put θεός/G2316 on the conjunction "and". There is
   no "God" in the verse; "and" is καί. Fix: number -> G2532 (καί) and clear the
   now-stale lemma/morph so the morphology line doesn't show θεός's parse.

2) 1Pe 1:23 — the genitive reorder "of God living" (Greek: living of God) split
   wrong: θεός/G2316 kept only "of" while the next chip (ζάω/G2198) carried
   "God living". Fix: move "God" back onto the θεός chip -> "of God" + "living".
   No Strong's numbers change.

Usage:
  python3 scripts/fix_theos_filler_tags.py bible.db            # dry-run
  python3 scripts/fix_theos_filler_tags.py bible.db --apply
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
APPLY = "--apply" in sys.argv

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cols = {r["name"] for r in conn.execute("PRAGMA table_info(words)")}
has_lemma = "lemma" in cols
has_morph = "morph" in cols


def verse_id(book, ch, vs):
    r = conn.execute(
        "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
        (book, ch, vs),
    ).fetchone()
    return r["id"] if r else None


def row_at(vid, pos):
    return conn.execute(
        "SELECT * FROM words WHERE verse_id=? AND position=?", (vid, pos)
    ).fetchone()


plan = []  # (label, sql, params, precheck_ok)

# --- 1) Lam 3:16 "and" wrongly tagged θεός -> καί -----------------------------
vid = verse_id("Lam", 3, 16)
if vid is not None:
    r = row_at(vid, 0)
    if r and r["strongs_base"] == "G2316" and (r["english"] or "").strip().lower() == "and":
        sets = ["strongs_base='G2532'", "strongs='2532'"]
        if has_lemma:
            sets.append("lemma=NULL")
        if has_morph:
            sets.append("morph=NULL")
        plan.append((
            "Lam 3:16 pos0  'and'  G2316/θεός -> G2532/καί (clear stale lemma/morph)",
            f"UPDATE words SET {', '.join(sets)} WHERE verse_id=? AND position=0",
            (vid,),
        ))
    else:
        print("Lam 3:16: already fixed or shape changed — skipping")

# --- 2) 1Pe 1:23 'of God living' split: move 'God' onto the θεός chip ---------
vid = verse_id("1Pe", 1, 23)
if vid is not None:
    r9 = row_at(vid, 9)
    r10 = row_at(vid, 10)
    ok9 = r9 and r9["strongs_base"] == "G2316" and (r9["english"] or "").strip().lower() == "of"
    ok10 = r10 and r10["strongs_base"] == "G2198" and (r10["english"] or "").strip().lower() == "god living"
    if ok9 and ok10:
        plan.append((
            "1Pe 1:23 pos9  θεός  'of' -> 'of God'  (head -> 'God')",
            "UPDATE words SET english='of God', english_head='God' WHERE verse_id=? AND position=9",
            (vid,),
        ))
        plan.append((
            "1Pe 1:23 pos10 ζάω   'God living' -> 'living'  (head -> 'living')",
            "UPDATE words SET english='living', english_head='living' WHERE verse_id=? AND position=10",
            (vid,),
        ))
    else:
        print("1Pe 1:23: already fixed or shape changed — skipping")

if not plan:
    print("\nNothing to do.")
    sys.exit(0)

print(f"\n{'APPLYING' if APPLY else 'DRY-RUN'} — {len(plan)} change(s)  [DB: {DB}]\n")
for label, sql, params in plan:
    print(f"  {label}")
    if APPLY:
        conn.execute(sql, params)

if APPLY:
    conn.commit()
    print("\nSaved.")
else:
    print("\n(dry-run — re-run with --apply to save)")
conn.close()
