#!/usr/bin/env python3
"""
fix_bracket_punct.py — relocate misplaced clause punctuation within ABP bracket
groups to the group's last displayed word.

Root cause (see audit_bracket_punct.py for the read-only scan):
ABP glues trailing clause punctuation (",", ".", ";", ":", "?", "!") onto
whichever Greek token it physically followed in the source. For most brackets
that token IS the source-last word of the group, so it renders fine. In 365
verses, though, the punctuation sits on a token that is NOT the last word of the
bracket in `position` (Greek source) order — e.g. 1Co 4:7 "[²you? ¹scrutinizes]"
renders "who you? scrutinizes" in chip/interlinear mode. Prose mode already
floats the punctuation at render time (getEnglishOrderWords in app.jsx); chip
mode does not, so it shows the punctuation mid-phrase.

Fix (DATA, `english` column ONLY — never touches strongs / strongs_base / is_pn /
greek_pos / bracket_id, so there is NO rebuild and none of the prefix/PN hazards):
for each bracket group, strip any trailing clause punctuation from non-last words
and append it to the position-last non-empty word of the group. This mirrors the
float getEnglishOrderWords does for prose, applied permanently so chip mode (and
every other `english` consumer) is correct too. Prose is unaffected: it re-floats
by greek_pos at render time and lands on the same/correct word regardless.

Idempotent and re-runnable (after a second run, no word has misplaced punct, so
nothing changes). Re-run after ANY words rebuild, like fix_greek_pos_gaps.py.

Usage:
  python3 scripts/fix_bracket_punct.py bible.db --dry-run
  python3 scripts/fix_bracket_punct.py bible.db
"""
import re
import sqlite3
import sys
from collections import defaultdict

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv

# Same trailing-clause-punctuation class as getEnglishOrderWords (app.jsx).
TRAIL = re.compile(r"[.,;:!?·]+$")

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

rows = conn.execute(
    """SELECT w.id, w.verse_id, w.position, w.english, w.bracket_id,
              v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       WHERE w.bracket_id IS NOT NULL
       ORDER BY w.verse_id, w.bracket_id, w.position"""
).fetchall()

groups = defaultdict(list)
for r in rows:
    groups[(r["verse_id"], r["bracket_id"])].append(r)


def eng(w):
    return (w["english"] or "").strip()


def is_pure_punct(text):
    return bool(text) and TRAIL.sub("", text) == ""


def target_index(members):
    """Position-last member with non-empty, non-pure-punct english — the last
    word actually displayed in chip/interlinear (position) order. `members` is
    already in position order."""
    for idx in range(len(members) - 1, -1, -1):
        t = eng(members[idx])
        if t and not is_pure_punct(t):
            return idx
    return None


# word_id -> new english string
updates = {}
affected_verses = {}

for (vid, _bid), members in groups.items():
    ti = target_index(members)
    if ti is None:
        continue
    trailing = ""
    pending = {}  # word_id -> stripped english (applied only if trailing != "")
    for i, w in enumerate(members):
        if i == ti:
            continue
        t = eng(w)
        if not t:
            continue
        if is_pure_punct(t):
            trailing += t
            pending[w["id"]] = ""          # blank out a standalone punct token
            continue
        m = TRAIL.search(t)
        if m:
            trailing += m.group()
            pending[w["id"]] = t[: m.start()].rstrip()
    if not trailing:
        continue
    # apply the strips and append the floated punctuation to the target word
    for wid, new_eng in pending.items():
        updates[wid] = new_eng
    tw = members[ti]
    updates[tw["id"]] = (tw["english"] or "").rstrip() + trailing
    affected_verses[vid] = (members[0]["book"], members[0]["chapter"], members[0]["verse"])

print(f"{'[DRY RUN] ' if DRY else ''}bracket clause-punctuation float -> {DB}")
print(f"  words to edit: {len(updates):,}  across {len(affected_verses):,} verses\n")

# ---- preview a sample of the actual english edits ----
id_to_row = {r["id"]: r for r in rows}
shown = 0
print("Sample english edits (old -> new):")
for wid, new_eng in updates.items():
    r = id_to_row[wid]
    old = r["english"]
    if old == new_eng:
        continue
    print(f"  {r['book']} {r['chapter']}:{r['verse']:<3} bid={r['bracket_id']} "
          f"pos={r['position']:<3} {old!r} -> {new_eng!r}")
    shown += 1
    if shown >= 30:
        print("  ...")
        break

if not DRY:
    conn.executemany("UPDATE words SET english=? WHERE id=?",
                     [(e, wid) for wid, e in updates.items()])
    conn.commit()
    print(f"\n  applied {len(updates):,} english edits.")
else:
    print("\n[DRY RUN] no changes written.")
conn.close()
