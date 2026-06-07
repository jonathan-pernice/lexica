#!/usr/bin/env python3
"""fix_kyrios_mistags.py — two stray κύριος/G2962 mistags the source got wrong
(Κύρου "Cyrus" / καί "and" look like κυρίου "of the lord"). READ-ONLY by default;
--apply to write. Each pinned to its exact bad state, so safe to re-run / repair-chain.

1) Dan 4:19 — "Belteshazzar answered AND said, O lord": the "and" at that slot is
   καί (G2532), not κύριος (the real κύριος "O lord" is the next chip). Retag the
   "and" to G2532 and clear the stale lemma/morph.

2) "Cyrus" tagged G2962 (2 rows): Cyrus is the name Koresh, tagged H3566 (proper
   noun) in its other 21 occurrences. Retag these to H3566 / is_pn=1 / strongs='*'
   to match, and clear the stale lemma/morph.

Usage:
  python3 scripts/fix_kyrios_mistags.py bible.db          # dry-run
  python3 scripts/fix_kyrios_mistags.py bible.db --apply
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
APPLY = "--apply" in sys.argv

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cols = {r["name"] for r in conn.execute("PRAGMA table_info(words)")}
HAS = {c: (c in cols) for c in ("lemma", "morph", "is_pn")}


def clear_cols():
    bits = []
    if HAS["lemma"]:
        bits.append("lemma=NULL")
    if HAS["morph"]:
        bits.append("morph=NULL")
    return bits


plan = []  # (label, sql, params)

# 1) Dan 4:19 "and" G2962 -> καί G2532
v = conn.execute("SELECT id FROM verses WHERE book='Dan' AND chapter=4 AND verse=19").fetchone()
if v:
    r = conn.execute(
        "SELECT id, english, strongs_base FROM words WHERE verse_id=? AND position=33", (v["id"],)
    ).fetchone()
    if r and r["strongs_base"] == "G2962" and (r["english"] or "").strip().lower() == "and":
        sets = ["strongs_base='G2532'", "strongs='2532'"] + clear_cols()
        plan.append(("Dan 4:19 pos33  'and'  G2962 -> G2532 (kai)",
                     f"UPDATE words SET {', '.join(sets)} WHERE id=?", (r["id"],)))
    else:
        print("Dan 4:19: already fixed or shape changed — skipping")

# 2) "Cyrus" mistagged G2962 -> H3566 proper noun
cyrus = conn.execute(
    "SELECT id, english FROM words WHERE strongs_base='G2962' AND english LIKE '%Cyrus%'"
).fetchall()
for r in cyrus:
    sets = ["strongs_base='H3566'", "strongs='*'"] + (["is_pn=1"] if HAS["is_pn"] else []) + clear_cols()
    plan.append((f"Cyrus row id={r['id']} ({r['english']!r})  G2962 -> H3566 (proper noun)",
                 f"UPDATE words SET {', '.join(sets)} WHERE id=?", (r["id"],)))
if not cyrus:
    print("Cyrus: none tagged G2962 — already fixed or none present")

if not plan:
    print("\nNothing to do.")
    sys.exit(0)

print(f"\n{'APPLYING' if APPLY else 'DRY-RUN'} — {len(plan)} change(s)  [DB: {DB}]\n")
for label, sql, params in plan:
    print("  " + label)
    if APPLY:
        conn.execute(sql, params)
if APPLY:
    conn.commit()
    print("\nSaved.")
else:
    print("\n(dry-run — re-run with --apply to write)")
conn.close()
