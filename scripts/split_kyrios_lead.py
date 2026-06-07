#!/usr/bin/env python3
"""split_kyrios_lead.py — split leading function words ("to/of/the") off a κύριος
(G2962) chip so only "LORD" carries G2962, and "to/of/the" become a separate chip
with NO Strong's (so clicking them no longer shows κύριος).

  before:  [ "To the LORD" = G2962 ]
  after:   [ "To the" = (no strongs) ]  [ "LORD" = G2962 ]

Inserts one row per split and renumbers the verse's positions. Only touches κύριος
chips whose english has a leading run of prepositions/article before LORD; leaves
"O LORD" / bare "LORD" alone. Scoped by --book/--chapter (default Dan 9); --all for
the whole corpus. READ-ONLY dry-run by default; --apply to write.

Usage:
  python3 scripts/split_kyrios_lead.py bible.db --book Dan --chapter 9
  python3 scripts/split_kyrios_lead.py bible.db --book Dan --chapter 9 --apply
  python3 scripts/split_kyrios_lead.py bible.db --all --apply
"""
import re
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
APPLY = "--apply" in sys.argv
ALL = "--all" in sys.argv


def opt(flag, d=None):
    a = sys.argv
    return a[a.index(flag) + 1] if flag in a and a.index(flag) + 1 < len(a) else d


BOOK = opt("--book", "Dan")
CHAP = opt("--chapter")
LEAD = {"to", "of", "the", "from", "by", "in", "unto", "upon", "with", "a", "an"}

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
COLS = [r[1] for r in conn.execute("PRAGMA table_info(words)")]


def split_eng(eng):
    """Return (leading, core) splitting before the LORD word, or None if not splittable."""
    m = re.search(r"\b[Ll][Oo][Rr][Dd]\b", eng or "")
    if not m or m.start() == 0:
        return None
    leading = eng[:m.start()].strip()
    core = eng[m.start():].strip()
    lead_words = [re.sub(r"[^\w]", "", w).lower() for w in leading.split()]
    lead_words = [w for w in lead_words if w]
    if not lead_words or not all(w in LEAD for w in lead_words):
        return None
    return leading, core


# Find candidate κύριος chips.
where = "w.strongs_base='G2962'"
params = []
if not ALL:
    where += " AND v.book=?"
    params.append(BOOK)
    if CHAP:
        where += " AND v.chapter=?"
        params.append(int(CHAP))
rows = conn.execute(
    f"""SELECT w.id, w.verse_id, w.position, w.english, w.english_head, v.book, v.chapter, v.verse
        FROM words w JOIN verses v ON v.id=w.verse_id
        WHERE {where} ORDER BY w.verse_id, w.position""", params).fetchall()

# Group splittable ones by verse.
by_verse = {}
for r in rows:
    sp = split_eng(r["english"])
    if sp:
        by_verse.setdefault(r["verse_id"], []).append((r, sp))

print(f"{'APPLYING' if APPLY else 'DRY-RUN'} — {sum(len(v) for v in by_verse.values())} "
      f"chip(s) in {len(by_verse)} verse(s)  [DB: {DB}]\n")

for vid, items in by_verse.items():
    r0 = items[0][0]
    ref = f"{r0['book']} {r0['chapter']}:{r0['verse']}"
    for r, (leading, core) in items:
        print(f"  {ref:<12} {r['english']!r} -> [{leading!r} (no #)] [{core!r} G2962]")
    if not APPLY:
        continue
    # Rebuild the whole verse's rows in order, inserting a supplied row before each split chip.
    allrows = conn.execute("SELECT * FROM words WHERE verse_id=? ORDER BY position", (vid,)).fetchall()
    split_ids = {r["id"]: (leading, core) for r, (leading, core) in items}
    newseq = []  # list of dicts: either existing row (with overrides) or a new supplied row
    for ar in allrows:
        if ar["id"] in split_ids:
            leading, core = split_ids[ar["id"]]
            supplied = {c: None for c in COLS}
            supplied.update(id=None, verse_id=vid, english=leading, english_head=None,
                            strongs="", strongs_base="",
                            greek_pos=ar["greek_pos"],          # ride the LORD chip's bracket order #
                            bracket_id=ar["bracket_id"], italic=0, italic_words="",
                            smcap_words="", is_pn=0, morph=None, lemma=None)
            newseq.append(supplied)
            core_row = {c: ar[c] for c in COLS}
            core_row.update(english=core, english_head="LORD")
            newseq.append(core_row)
        else:
            newseq.append({c: ar[c] for c in COLS})
    # Reassign positions and write: update existing rows, insert new ones.
    for pos, row in enumerate(newseq):
        if row["id"] is None:
            cols = [c for c in COLS if c != "id"]
            row["position"] = pos
            conn.execute(f"INSERT INTO words ({','.join(cols)}) VALUES ({','.join('?'*len(cols))})",
                         [row[c] for c in cols])
        else:
            conn.execute("UPDATE words SET position=?, english=?, english_head=? WHERE id=?",
                         (pos, row["english"], row["english_head"], row["id"]))

if APPLY:
    conn.commit()
    print("\nSaved.")
else:
    print("\n(dry-run — re-run with --apply to write)")
conn.close()
