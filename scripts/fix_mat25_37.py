#!/usr/bin/env python3
"""
fix_mat25_37.py — Mat 25:37 "when did we see you" (order + mis-gloss).

Deferred from fix_subject_reorder.py because this verse isn't just a backwards
reorder — its slots are mis-glossed:
  pos 8  G4571 (σε = "you", object)   glossed "we"            <- wrong
  pos 9  G1492 (εἴδομεν = "did we see") glossed "did see"
  pos 10 G3983 (πεινῶντα = "hungering") glossed "you hungering" <- "you" bundled

Prose currently reads "when did see we you ..."; source/intended is
"when did we see you hungering ...". Fix (strongs-correct):
  * put the verb (G1492 "did we see") at pos 8, the pronoun (G4571 "you") at pos 9
    (swap their positions so English reads verb-then-object),
  * G3983 -> "hungering," (drop the duplicated "you"),
  * clear bracket_id + greek_pos on the two bracket words.

Verifies the strongs at each slot before touching anything; aborts if they differ
(e.g. already fixed). Touches Mat 25:37 only. --dry-run.

Usage:
  python3 scripts/fix_mat25_37.py bible.db --dry-run
  python3 scripts/fix_mat25_37.py bible.db
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

v = conn.execute("SELECT id FROM verses WHERE book='Mat' AND chapter=25 AND verse=37").fetchone()
if not v:
    print("Mat 25:37 not found"); sys.exit(1)
vid = v["id"]


def at(pos):
    return conn.execute("SELECT id, position, english, strongs_base, bracket_id, greek_pos "
                        "FROM words WHERE verse_id=? AND position=?", (vid, pos)).fetchone()


def reading():
    rows = conn.execute("SELECT english FROM words WHERE verse_id=? ORDER BY position", (vid,)).fetchall()
    return " ".join((r["english"] or "").strip() for r in rows if (r["english"] or "").strip())


w_you, w_verb, w_hung = at(8), at(9), at(10)   # expected G4571, G1492, G3983
expect = [(w_you, "G4571"), (w_verb, "G1492"), (w_hung, "G3983")]
if any(w is None or w["strongs_base"] != sb for w, sb in expect):
    print("Slots don't match expected G4571/G1492/G3983 at pos 8/9/10 — aborting "
          "(already fixed, or different DB state).")
    for w, sb in expect:
        print(f"   pos {w['position'] if w else '?'}: have "
              f"{w['strongs_base'] if w else '-'}, expected {sb}")
    sys.exit(1)

print(f"{'[DRY RUN] ' if DRY else ''}Mat 25:37 fix -> {DB}")
print(f"  before: {reading()}")

if not DRY:
    # swap positions via a temp slot to avoid a (verse,position) collision
    conn.execute("UPDATE words SET position=9999, english='you', bracket_id=NULL, greek_pos=NULL WHERE id=?",
                 (w_you["id"],))
    conn.execute("UPDATE words SET position=8, english='did we see', bracket_id=NULL, greek_pos=NULL WHERE id=?",
                 (w_verb["id"],))
    conn.execute("UPDATE words SET position=9 WHERE id=?", (w_you["id"],))
    conn.execute("UPDATE words SET english='hungering,' WHERE id=?", (w_hung["id"],))
    conn.commit()
    print(f"  after : {reading()}")
    print("  applied.")
else:
    # preview without writing
    rows = conn.execute("SELECT id, position, english FROM words WHERE verse_id=? ORDER BY position", (vid,)).fetchall()
    prev = {w_verb["id"]: (8, "did we see"), w_you["id"]: (9, "you"), w_hung["id"]: (10, "hungering,")}
    seq = []
    for r in rows:
        pos, eng = prev.get(r["id"], (r["position"], r["english"]))
        seq.append((pos, (eng or "").strip()))
    after = " ".join(e for _, e in sorted(seq) if e)
    print(f"  after : {after}")
    print("[DRY RUN] no changes written.")
conn.close()
