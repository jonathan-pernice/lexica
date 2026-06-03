#!/usr/bin/env python3
"""
fix_greek_pos_gaps.py — backfill missing greek_pos for bracketed words.

Root cause: build_words_from_abp.py sourced greek_pos from the BH scrape (which
its own docstring calls "unreliable") instead of the ABP position numbers. When a
multi-word ABP token like "[2God did]" was split into two DB words ("God" G2316 +
"did" G4160), the continuation word ("did") never received a greek_pos. With
greek_pos NULL, getEnglishOrderWords sorts it to the end (?? 999), mis-ordering
prose: "And God good did" instead of "And God did good".
Scope: ~1,829 words across ~1,681 verses (2026-06-03).

Fix (DATA, greek_pos ONLY — never touches strongs / english / is_pn, so there is
no rebuild and none of the prefix/PN hazards): a bracketed word with NULL
greek_pos inherits the greek_pos of the nearest PRECEDING numbered word in the
same bracket (the word it was split from). A stable sort by (greek_pos, position)
then keeps it immediately after that word. Safe and re-runnable.

Usage:
  python3 scripts/fix_greek_pos_gaps.py bible.db --dry-run
  python3 scripts/fix_greek_pos_gaps.py bible.db
"""
import sqlite3
import sys
from collections import defaultdict

DB  = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
DRY = "--dry-run" in sys.argv

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

rows = conn.execute(
    """SELECT w.id, w.verse_id, w.position, w.english, w.greek_pos, w.bracket_id,
              v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       WHERE w.bracket_id IS NOT NULL
       ORDER BY w.verse_id, w.bracket_id, w.position"""
).fetchall()

groups = defaultdict(list)
for r in rows:
    groups[(r["verse_id"], r["bracket_id"])].append(r)


def has_gloss(w):
    return bool((w["english"] or "").strip())


updates = {}   # word_id -> new greek_pos
for members in groups.values():
    # forward pass: inherit from the nearest PRECEDING numbered word
    last = None
    for w in members:
        if w["greek_pos"] is not None:
            last = w["greek_pos"]
        elif has_gloss(w) and last is not None:
            updates[w["id"]] = last
    # backward pass: any LEADING null-gp words (nothing precedes) take the next number
    nxt = None
    for w in reversed(members):
        if w["greek_pos"] is not None:
            nxt = w["greek_pos"]
        elif has_gloss(w) and w["id"] not in updates and nxt is not None:
            updates[w["id"]] = nxt

print(f"{'[DRY RUN] ' if DRY else ''}greek_pos backfill -> {DB}")
print(f"  bracketed words with NULL greek_pos to fix: {len(updates):,}\n")


# ---- preview: full-verse prose reading order before vs after ----
def verse_reading(vwords, override):
    bmap = defaultdict(list)
    for w in vwords:
        if w["bracket_id"] is not None:
            bmap[w["bracket_id"]].append(w)

    def key(w):
        gp = override.get(w["id"], w["greek_pos"])
        return (gp if gp is not None else 999, w["position"])

    for bid in bmap:
        bmap[bid] = sorted(bmap[bid], key=key)

    out, seen_b = [], set()
    for w in vwords:
        b = w["bracket_id"]
        if b is None:
            if has_gloss(w):
                out.append(w["english"].strip())
        elif b not in seen_b:
            seen_b.add(b)
            out += [x["english"].strip() for x in bmap[b] if has_gloss(x)]
    return " ".join(out)


# collect affected verses, show Exo 1:20 first if present
affected = {}
for (vid, _bid), members in groups.items():
    if any(m["id"] in updates for m in members):
        affected[vid] = (members[0]["book"], members[0]["chapter"], members[0]["verse"])

ordered = sorted(affected.items(), key=lambda kv: (kv[1] != ("Exo", 1, 20), kv[1]))
print("Sample before -> after (full-verse prose order):")
for vid, ref in ordered[:8]:
    vwords = conn.execute(
        """SELECT id, position, english, greek_pos, bracket_id
           FROM words WHERE verse_id=? ORDER BY position""", (vid,)
    ).fetchall()
    print(f"\n  {ref[0]} {ref[1]}:{ref[2]}")
    print(f"    before: {verse_reading(vwords, {})}")
    print(f"    after : {verse_reading(vwords, updates)}")

if not DRY:
    conn.executemany(
        "UPDATE words SET greek_pos=? WHERE id=?",
        [(gp, wid) for wid, gp in updates.items()],
    )
    conn.commit()
    print(f"\n  applied {len(updates):,} greek_pos updates.")
else:
    print("\n[DRY RUN] no changes written.")
conn.close()
