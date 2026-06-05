#!/usr/bin/env python3
"""
fix_supplied_attach.py — clean up click-attribution on 5 subject-reorder verses.

fix_subject_reorder.py got the READING right ("But we are") but, to avoid moving
positions, pushed a conjunction (δέ/γάρ) and a supplied copula ("are"/"is") onto
the wrong Greek slots: e.g. Psa 79:13 had G2249(ἡμεῖς) glossed "But we" and
G1161(δέ) glossed "are". Clicking a word then showed the wrong Greek.

This swaps the two slots' positions so each Greek word carries its own gloss and
the supplied copula rides with its subject (G1161 -> "But", G2249 -> "we are").
Reading is unchanged. Only these 5 verses; verifies the slot strongs before
touching; --dry-run.

  (book, ch, vs, pron_pos, conj_pos, pron_sb, conj_sb, conj_gloss, pron_gloss)
  pron slot currently sits EARLIER (pron_pos); conj slot LATER (conj_pos). After:
  conj slot -> pron_pos (reads first) w/ conj_gloss; pron slot -> conj_pos w/ pron_gloss.

Usage:
  python3 scripts/fix_supplied_attach.py bible.db --dry-run
  python3 scripts/fix_supplied_attach.py bible.db
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv

FIXES = [
    ("Psa", 79, 13, 0, 1, "G2249", "G1161", "But", "we are"),
    ("Eze", 11, 3, 11, 12, "G2249", "G1161", "and", "we are"),
    ("Job", 35, 13, 7, 8, "G846", "G1063", "for", "he is"),
    ("Isa", 65, 11, 0, 1, "G5210", "G1161", "But", "you are"),
    ("Isa", 28, 20, 4, 5, "G846", "G1161", "but", "we are ourselves"),
]

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row


def reading(vid, override):
    rows = conn.execute("SELECT id, position, english FROM words WHERE verse_id=? ORDER BY position",
                        (vid,)).fetchall()
    seq = []
    for r in rows:
        pos, eng = override.get(r["id"], (r["position"], r["english"]))
        seq.append((pos, (eng or "").strip()))
    return " ".join(e for _, e in sorted(seq) if e)


print(f"{'[DRY RUN] ' if DRY else ''}supplied-attach swap -> {DB}\n")
applied = 0
for book, ch, vs, pp, cp, psb, csb, cg, pg in FIXES:
    v = conn.execute("SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                     (book, ch, vs)).fetchone()
    if not v:
        print(f"  !! {book} {ch}:{vs} not found — SKIP"); continue
    vid = v["id"]
    wp = conn.execute("SELECT id, strongs_base FROM words WHERE verse_id=? AND position=?", (vid, pp)).fetchone()
    wc = conn.execute("SELECT id, strongs_base FROM words WHERE verse_id=? AND position=?", (vid, cp)).fetchone()
    if not wp or not wc or wp["strongs_base"] != psb or wc["strongs_base"] != csb:
        print(f"  !! {book} {ch}:{vs} slots don't match {psb}/{csb} (already fixed?) — SKIP"); continue

    # preview: conj slot -> pron_pos w/ conj_gloss; pron slot -> conj_pos w/ pron_gloss
    override = {wc["id"]: (pp, cg), wp["id"]: (cp, pg)}
    print(f"  {book} {ch}:{vs}")
    print(f"      before: {reading(vid, {})}")
    print(f"      after : {reading(vid, override)}")
    print()

    if not DRY:
        conn.execute("UPDATE words SET position=9999, english=? WHERE id=?", (pg, wp["id"]))
        conn.execute("UPDATE words SET position=?, english=? WHERE id=?", (pp, cg, wc["id"]))
        conn.execute("UPDATE words SET position=? WHERE id=?", (cp, wp["id"]))
        applied += 1

if not DRY:
    conn.commit()
    print(f"applied {applied} verse fixes.")
else:
    print("[DRY RUN] no changes written.")
conn.close()
