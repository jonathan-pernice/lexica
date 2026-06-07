#!/usr/bin/env python3
"""fix_lord_oath.py — repairs the "As the LORD lives" oath formula (Hebrew
chay-YHWH), where the reorder put "As" on κύριος/G2962 (LORD) and "the LORD lives"
on the next chip ζάω/G2198 (live). Greek order is κύριος ζάω = "LORD lives", so
"the LORD" belongs to κύριος and "lives" to ζάω.

Fix: move the "the LORD"/"the Lord" piece from the ζάω chip onto the κύριος chip
-> κύριος = "As the LORD", ζάω = "lives,". Reading order ("As the LORD lives,")
and positions are unchanged. 29 verses corpus-wide, one uniform shape.

Pinned to the exact pattern (κύριος english == "As"/"as" + next chip ζάω starting
"the LORD"), so it only acts on the bad state — safe to re-run, safe in the
post-rebuild repair chain. Dry-run by default; --apply to write.

Usage:
  python3 scripts/fix_lord_oath.py bible.db          # dry-run
  python3 scripts/fix_lord_oath.py bible.db --apply
"""
import re
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
APPLY = "--apply" in sys.argv

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row


def head(eng):
    for w in re.sub(r"[^\w ]", " ", eng or "").split():
        if w.lower() not in ("the", "a", "an", "as"):
            return w
    return (eng or "").split()[0] if eng else None


rows = conn.execute(
    """SELECT w.id, w.verse_id, w.position, w.english, v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       WHERE w.strongs_base = 'G2962' AND lower(trim(w.english)) = 'as'
       ORDER BY v.id, w.position"""
).fetchall()

planned = []
for r in rows:
    nxt = conn.execute(
        "SELECT id, strongs_base, english FROM words WHERE verse_id=? AND position>? ORDER BY position LIMIT 1",
        (r["verse_id"], r["position"]),
    ).fetchone()
    if not nxt or nxt["strongs_base"] != "G2198":
        continue
    m = re.match(r"^(the [Ll][Oo][Rr][Dd])\s+(.*)$", nxt["english"] or "")
    if not m:
        continue
    det, remainder = m.group(1), m.group(2)          # "the LORD", "lives,"
    new_kyrios = f"{r['english'].strip()} {det}"       # "As the LORD"
    ref = f"{r['book']} {r['chapter']}:{r['verse']}"
    planned.append((ref,
                    (r["id"], new_kyrios, det.split()[1]),        # κύριος: eng, head ("LORD")
                    (nxt["id"], remainder, head(remainder))))     # ζάω: eng, head

print(f"{'APPLYING' if APPLY else 'DRY-RUN'} — {len(planned)} oath verse(s)  [DB: {DB}]\n")
for ref, (kid, k_eng, k_head), (zid, z_eng, z_head) in planned:
    print(f"  {ref:<12} G2962 -> {k_eng!r:<18} G2198 -> {z_eng!r}")
    if APPLY:
        conn.execute("UPDATE words SET english=?, english_head=? WHERE id=?", (k_eng, k_head, kid))
        conn.execute("UPDATE words SET english=?, english_head=? WHERE id=?", (z_eng, z_head, zid))

if APPLY:
    conn.commit()
    print("\nSaved.")
else:
    print("\n(dry-run — re-run with --apply to write)")
conn.close()
