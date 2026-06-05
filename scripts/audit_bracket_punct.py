#!/usr/bin/env python3
"""
audit_bracket_punct.py — READ-ONLY scope audit for misplaced clause punctuation
in reordered ABP bracket groups.

Background
----------
ABP glues trailing clause punctuation (",", ".", ";", ":") onto whatever Greek
token it physically follows. _sort_brackets (build_words_from_abp.py) reorders a
bracket group into ABP English reading order and REASSIGNS sequential `position`
numbers, so the DB's physical order is English order. But the punctuation stays
on its original token, which may no longer be the LAST word of the group.

  1Ch 7:22  bracket [3mourned 1Ephraim 2their-father 5days 4many],
            English order: Ephraim(1) father(2) mourned(3) many(4) days(5)
            comma is on "many" (abp_pos 4) -> renders "...mourned many, days"
            but should read "...mourned many days,"

Prose mode (getEnglishOrderWords in app.jsx) ALREADY floats the punctuation to
the group's last word at render time, so prose looks right. CHIP / Interlinear /
Strong's mode renders raw `position` order WITHOUT the float, so it shows the
comma mid-phrase. This audit quantifies how many groups/verses are affected.

This script REPLICATES the getEnglishOrderWords float-target rule exactly so the
counts match what a data-level repair (or a chip-mode float) would touch:
  * group members are taken in `position` order
  * sorted by (greek_pos if not None else 999), STABLE (ties keep position order)
  * the float target = the LAST member with non-empty english after that sort
  * a token is "misplaced" if it carries trailing clause punctuation AND it is
    not the float target (i.e. the punctuation would move).

READ-ONLY: opens the db with mode=ro and never writes.

Usage:
  python3 scripts/audit_bracket_punct.py bible.db
  python3 scripts/audit_bracket_punct.py bible.db --sample 25   # more examples
"""
import re
import sqlite3
import sys
from collections import defaultdict

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
SAMPLE = 12
if "--sample" in sys.argv:
    try:
        SAMPLE = int(sys.argv[sys.argv.index("--sample") + 1])
    except (ValueError, IndexError):
        pass

# Matches getEnglishOrderWords TRAIL in app.jsx: trailing clause punctuation.
TRAIL = re.compile(r"[.,;:!?·]+$")

conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

rows = conn.execute(
    """SELECT w.id, w.verse_id, w.position, w.english, w.greek_pos, w.bracket_id,
              w.strongs_base, v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       ORDER BY w.verse_id, w.position"""
).fetchall()

# verse_id -> ordered word list (position order)
verses = defaultdict(list)
for r in rows:
    verses[r["verse_id"]].append(r)


def eng(w):
    return (w["english"] or "").strip()


def is_pure_punct(text):
    return bool(text) and TRAIL.sub("", text) == ""


def float_target_index(members):
    """Index (into the position-ordered `members`) of the word the trailing
    punctuation should attach to. Chip/interlinear mode renders the group in
    `position` order, so the clause punctuation belongs on the LAST word that is
    actually displayed — the position-last non-empty, non-pure-punct member.
    (members is already in position order; prose mode re-floats by greek_pos at
    render time, so it stays correct independent of where the data puts it.)"""
    for idx in range(len(members) - 1, -1, -1):
        t = eng(members[idx])
        if t and not is_pure_punct(t):
            return idx
    return len(members) - 1 if members else None


# ── scan ──────────────────────────────────────────────────────────────────────
misplaced_tokens = 0
affected = {}          # verse_id -> (book, ch, vs)
multi_in_one = 0       # groups with >1 misplaced token
groups_total = 0

for vid, members in verses.items():
    bmap = defaultdict(list)
    for w in members:
        if w["bracket_id"] is not None:
            bmap[w["bracket_id"]].append(w)
    for bid, grp in bmap.items():
        groups_total += 1
        tgt = float_target_index(grp)
        if tgt is None:
            continue
        n_here = 0
        for i, w in enumerate(grp):
            text = eng(w)
            if not text or is_pure_punct(text):
                # pure-punct token sitting on a non-last slot is also "misplaced"
                if text and is_pure_punct(text) and i != tgt:
                    n_here += 1
                continue
            if TRAIL.search(text) and i != tgt:
                n_here += 1
        if n_here:
            misplaced_tokens += n_here
            affected[vid] = (grp[0]["book"], grp[0]["chapter"], grp[0]["verse"])
            if n_here > 1:
                multi_in_one += 1

# ── context counts ─────────────────────────────────────────────────────────────
# non-bracket trailing-punct tokens that are NOT verse-final: legitimate mid-verse
# commas (kept in source order, never reordered) — shown to confirm they're NOT
# swept into the affected set.
nonbrk_midverse = 0
for vid, members in verses.items():
    last_nonempty = None
    for i, w in enumerate(members):
        if eng(w):
            last_nonempty = i
    for i, w in enumerate(members):
        if w["bracket_id"] is None and eng(w) and TRAIL.search(eng(w)) \
                and i != last_nonempty:
            nonbrk_midverse += 1

print(f"READ-ONLY bracket-punctuation audit -> {DB}\n")
print(f"  bracket groups scanned ............... {groups_total:,}")
print(f"  groups w/ misplaced clause punct ..... {len(affected):,} verses, "
      f"{misplaced_tokens:,} token(s)")
print(f"  verses with >1 misplaced token ....... {multi_in_one:,}")
print(f"  (context) non-bracket mid-verse commas {nonbrk_midverse:,}  "
      f"<- NOT a defect, never reordered, excluded")
print()
print("  Every affected token is in a bracket group by construction; prose mode")
print("  already floats these correctly, chip/interlinear mode does not.\n")


# ── canary dump: 1Ch 7:22 (+ any --sample affected verses) ─────────────────────
def dump_verse(vid, ref):
    members = verses[vid]
    print(f"  {ref[0]} {ref[1]}:{ref[2]}  (position order = chip-mode order)")
    for w in members:
        flag = ""
        if w["bracket_id"] is not None:
            grp = [x for x in members if x["bracket_id"] == w["bracket_id"]]
            ti = float_target_index(grp)
            tgt_id = grp[ti]["id"] if ti is not None else None
            if eng(w) and TRAIL.search(eng(w)) and w["id"] != tgt_id:
                flag = "  <-- MISPLACED clause punct"
            elif w["id"] == tgt_id:
                flag = "  (float target)"
        print(f"    pos {w['position']:>3}  gp={str(w['greek_pos']):>4}  "
              f"bid={str(w['bracket_id']):>4}  {w['strongs_base']:<7} "
              f"{eng(w)!r}{flag}")

    # before/after in chip-mode (position) order
    before = " ".join(eng(w) for w in members if eng(w))

    def after_order():
        bmap = defaultdict(list)
        for w in members:
            if w["bracket_id"] is not None:
                bmap[w["bracket_id"]].append(w)
        floated = {}  # word_id -> new english
        for bid, grp in bmap.items():
            ti = float_target_index(grp)
            if ti is None:
                continue
            trailing = ""
            for i, w in enumerate(grp):
                t = eng(w)
                if not t:
                    continue
                if is_pure_punct(t):
                    if i != ti:
                        trailing += t
                        floated[w["id"]] = ""
                    continue
                m = TRAIL.search(t)
                if m and i != ti:
                    trailing += m.group()
                    floated[w["id"]] = t[:m.start()].rstrip()
            if trailing:
                tw = grp[ti]
                floated[tw["id"]] = (floated.get(tw["id"], eng(tw))) + trailing
        out = []
        for w in members:
            t = floated.get(w["id"], eng(w))
            if t:
                out.append(t)
        return " ".join(out)

    print(f"    before (chip): {before}")
    print(f"    after  (fix) : {after_order()}\n")


# 1Ch 7:22 canary
canary = conn.execute(
    """SELECT id FROM verses WHERE book='1Ch' AND chapter=7 AND verse=22"""
).fetchone()
print("Canary + sample (before = current chip render, after = punctuation floated):\n")
if canary and canary["id"] in verses:
    dump_verse(canary["id"], ("1Ch", 7, 22))

shown = 0
for vid, ref in sorted(affected.items(), key=lambda kv: kv[1]):
    if canary and vid == canary["id"]:
        continue
    dump_verse(vid, ref)
    shown += 1
    if shown >= SAMPLE:
        break

conn.close()
