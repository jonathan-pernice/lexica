#!/usr/bin/env python3
"""fix_split_merges.py — repairs ABP reorder-merge garbles where two source words
got crammed onto one chip and the other chip left blank (1Sa 28:13 "I see
magistrates" with ὁράω/G3708 empty; "they know not" with the verb empty; etc.).

WHY a data-patch and not a build change: the build's splitter assigns English to
Greek words by matching lexicon text, which is too leaky to fix this class
globally without regressing hundreds of other verses (article/copula garbles).
So instead we ran the improved splitter LOCALLY over the whole corpus, kept only
the provably-clean fixes (verb genuinely matches its own word; no function word
gains content; nothing emptied), and froze that vetted list in
scripts/split_merge_fixes.json. This applies exactly those.

Each fix is pinned to verse + position + Strong's + current English, so it only
acts when the known-bad state is present — safe to re-run, and safe to add to the
post-rebuild repair chain. Dry-run by default; --apply to write.

Usage:
  python3 scripts/fix_split_merges.py bible.db            # dry-run
  python3 scripts/fix_split_merges.py bible.db --apply
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
APPLY = "--apply" in sys.argv
FIXES = json.loads((Path(__file__).parent / "split_merge_fixes.json").read_text(encoding="utf-8"))

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row


def verse_id(book, ch, vs):
    r = conn.execute("SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                     (book, int(ch), int(vs))).fetchone()
    return r["id"] if r else None


applied = skipped = 0
skip_samples = []

for verse, ops in FIXES.items():
    book, rest = verse.rsplit(" ", 1)
    ch, vs = rest.split(":")
    vid = verse_id(book, ch, vs)
    if vid is None:
        skipped += 1
        if len(skip_samples) < 10:
            skip_samples.append(f"{verse}: verse not found")
        continue

    # Resolve + guard every op BEFORE touching anything (all-or-nothing per verse).
    plan = []
    ok = True
    for op in ops:
        row = conn.execute(
            "SELECT id, english, strongs_base FROM words WHERE verse_id=? AND position=?",
            (vid, op["old_pos"])).fetchone()
        if row is None:
            ok = False; reason = f"no row at pos {op['old_pos']}"; break
        if row["strongs_base"] != "G" + op["sbase"]:
            ok = False; reason = f"strongs mismatch pos {op['old_pos']} ({row['strongs_base']} != G{op['sbase']})"; break
        if (row["english"] or "") != (op["old_eng"] or ""):
            ok = False; reason = f"english mismatch pos {op['old_pos']} ({row['english']!r})"; break
        plan.append((row["id"], op["new_eng"], op["new_head"], op["new_pos"]))
    if not ok:
        skipped += 1
        if len(skip_samples) < 10:
            skip_samples.append(f"{verse}: {reason}")
        continue

    if APPLY:
        for rid, new_eng, new_head, new_pos in plan:
            conn.execute(
                "UPDATE words SET english=?, english_head=?, position=? WHERE id=?",
                (new_eng, new_head, new_pos, rid))
    applied += 1

if APPLY:
    conn.commit()
conn.close()

print(f"{'APPLIED' if APPLY else 'DRY-RUN'} — {applied} verse(s) "
      f"{'patched' if APPLY else 'ready'}, {skipped} skipped  [DB: {DB}]")
if skip_samples:
    print("skip samples (already fixed, or state changed):")
    for s in skip_samples:
        print("   " + s)
if not APPLY:
    print("\n(dry-run — re-run with --apply to write)")
