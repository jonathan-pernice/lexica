#!/usr/bin/env python3
"""
fix_bracket_gaps_absorb.py — make non-contiguous brackets contiguous (Chip cosmetic).

A glossless word (english NULL/empty — e.g. an absorbed article ὁ) sometimes sits
between two members of the same bracket with bracket_id=NULL. In Chip mode
groupForGreekMode treats that NULL as a group break, so the bracket draws as TWO
boxes (e.g. Exo 1:20 "[3good 1And 2God][2did]"). Prose is unaffected (it groups by
bracket_id, ignoring gaps).

Fix: absorb such a glossless gap word into the surrounding bracket so the run is
contiguous. Touches bracket_id ONLY, and ONLY for glossless words flanked by the
same bracket. Safe + re-runnable. Skips the Hab 3:14 class (duplicate rows — a
different bug; reported, not touched).

Usage:
  python3 scripts/fix_bracket_gaps_absorb.py bible.db --dry-run
  python3 scripts/fix_bracket_gaps_absorb.py bible.db
"""
import sqlite3
import sys

DB  = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

frag = conn.execute(
    """SELECT verse_id, bracket_id, min(position) mn, max(position) mx, count(*) c
       FROM words WHERE bracket_id IS NOT NULL
       GROUP BY verse_id, bracket_id
       HAVING (max(position) - min(position) + 1) != count(*)"""
).fetchall()

updates = []     # (bracket_id, word_id)
skipped = []     # (verse_id, bracket_id, reason)

for f in frag:
    members = conn.execute(
        """SELECT id, position, english, bracket_id FROM words
           WHERE verse_id=? AND position BETWEEN ? AND ? ORDER BY position""",
        (f["verse_id"], f["mn"], f["mx"]),
    ).fetchall()

    positions = [m["position"] for m in members]
    if len(positions) != len(set(positions)):       # duplicate rows (Hab 3:14)
        skipped.append((f["verse_id"], f["bracket_id"], "duplicate rows — separate bug"))
        continue

    for m in members:
        if m["bracket_id"] is None:
            if (m["english"] or "").strip():
                skipped.append((f["verse_id"], f["bracket_id"],
                                f"non-glossless gap {m['english']!r} — left as is"))
            else:
                updates.append((f["bracket_id"], m["id"]))

print(f"{'[DRY RUN] ' if DRY else ''}absorb glossless gap words -> {DB}")
print(f"  fragmented brackets: {len(frag)}")
print(f"  glossless gap words to absorb: {len(updates)}\n")

for vid, bid, why in skipped:
    ref = conn.execute("SELECT book,chapter,verse FROM verses WHERE id=?", (vid,)).fetchone()
    print(f"  SKIP {ref['book']} {ref['chapter']}:{ref['verse']} bracket {bid} — {why}")

if updates:
    print("\n  absorbing:")
    for bid, wid in updates:
        r = conn.execute(
            "SELECT v.book,v.chapter,v.verse,w.position FROM words w "
            "JOIN verses v ON v.id=w.verse_id WHERE w.id=?", (wid,)).fetchone()
        print(f"    {r['book']} {r['chapter']}:{r['verse']} pos {r['position']} -> bracket {bid}")

if not DRY and updates:
    conn.executemany("UPDATE words SET bracket_id=? WHERE id=?", updates)
    conn.commit()
    print(f"\n  applied {len(updates)} bracket_id updates.")
elif DRY:
    print("\n[DRY RUN] no changes written.")
conn.close()
