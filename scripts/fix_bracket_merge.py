#!/usr/bin/env python3
"""
fix_bracket_merge.py — Merge fragmented bracket groups in bible.db.

When a single ABP bracket span is split across multiple bracket_ids (because
a non-null-english bridge word reset in_bracket during the build), this script
merges the fragments into one bracket_id per logical group.

Strategy:
  1. Find all gap groups where the missing greek_pos exists in ANOTHER bracket_id
     of the same verse (overlap / fragmentation).
  2. Build a graph: edge (bid_A, bid_B) if bid_A is missing X and bid_B has X.
  3. Union-Find: compute connected components.
  4. For each component: reassign all numbered words to the minimum bracket_id.
     Safety check: skip merge if the combined gpos set has duplicates (not fragments).

Usage:
    python3 scripts/fix_bracket_merge.py [bible.db] [--dry-run]
"""

import sys
import sqlite3
from collections import defaultdict

DRY_RUN = "--dry-run" in sys.argv
args    = [a for a in sys.argv[1:] if not a.startswith("--")]
DB      = args[0] if args else "bible.db"

print(f"{'[DRY RUN] ' if DRY_RUN else ''}fix_bracket_merge.py  db={DB}\n")

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row


# ── Union-Find ────────────────────────────────────────────────────────────────

_parent = {}

def _make(k):
    if k not in _parent:
        _parent[k] = k

def _find(k):
    if _parent[k] != k:
        _parent[k] = _find(_parent[k])
    return _parent[k]

def _union(a, b):
    _parent[_find(a)] = _find(b)


# ── Find all gap groups ───────────────────────────────────────────────────────

gap_rows = conn.execute("""
    WITH stats AS (
      SELECT verse_id, bracket_id,
        COUNT(*) as cnt, MAX(greek_pos) as max_pos
      FROM words
      WHERE bracket_id IS NOT NULL AND greek_pos IS NOT NULL
      GROUP BY verse_id, bracket_id
    )
    SELECT verse_id, bracket_id, cnt, max_pos
    FROM stats WHERE max_pos != cnt
    ORDER BY verse_id, bracket_id
""").fetchall()

print(f"Gap groups found: {len(gap_rows)}")

# ── For each gap group, find overlap relationships ────────────────────────────

merge_count   = 0
skip_count    = 0
overlap_found = 0

for row in gap_rows:
    verse_id = row["verse_id"]
    bid_A    = row["bracket_id"]
    key_A    = (verse_id, bid_A)
    _make(key_A)

    cur_A = {r["greek_pos"] for r in conn.execute(
        "SELECT greek_pos FROM words WHERE verse_id=? AND bracket_id=? AND greek_pos IS NOT NULL",
        (verse_id, bid_A)
    )}
    missing_A = set(range(1, row["max_pos"] + 1)) - cur_A
    if not missing_A:
        continue

    for miss_gpos in missing_A:
        other_bids = conn.execute("""
            SELECT DISTINCT bracket_id FROM words
            WHERE verse_id=? AND greek_pos=? AND bracket_id IS NOT NULL AND bracket_id!=?
        """, (verse_id, miss_gpos, bid_A)).fetchall()

        for ob in other_bids:
            bid_B = ob["bracket_id"]
            key_B = (verse_id, bid_B)
            _make(key_B)
            _union(key_A, key_B)
            overlap_found += 1

print(f"Overlap links found: {overlap_found}")

# ── Group into components ─────────────────────────────────────────────────────

components_by_root = defaultdict(set)
for key in _parent:
    components_by_root[_find(key)].add(key)

multi = [(root, keys) for root, keys in components_by_root.items() if len(keys) > 1]
print(f"Fragment components to merge: {len(multi)}\n")

# ── Merge each component ──────────────────────────────────────────────────────

for root, keys in sorted(multi):
    verse_id = root[0]
    bids = {k[1] for k in keys}
    min_bid = min(bids)

    # Safety check: combined gpos must have no duplicates
    all_gpos = []
    for bid in bids:
        gpos_vals = [r["greek_pos"] for r in conn.execute(
            "SELECT greek_pos FROM words WHERE verse_id=? AND bracket_id=? AND greek_pos IS NOT NULL",
            (verse_id, bid)
        )]
        all_gpos.extend(gpos_vals)

    if len(all_gpos) != len(set(all_gpos)):
        print(f"  SKIP verse={verse_id} bids={bids}: combined gpos has duplicates — not fragments")
        skip_count += 1
        continue

    other_bids = bids - {min_bid}
    if DRY_RUN:
        print(f"  MERGE verse={verse_id} bids={other_bids} → bid={min_bid}  "
              f"(combined gpos={sorted(all_gpos)})")
        merge_count += len(other_bids)
        continue

    for old_bid in other_bids:
        conn.execute(
            "UPDATE words SET bracket_id=? WHERE verse_id=? AND bracket_id=?",
            (min_bid, verse_id, old_bid)
        )
    merge_count += len(other_bids)

if not DRY_RUN:
    conn.commit()

print(f"\nMerged  : {merge_count} bracket_ids reassigned")
print(f"Skipped : {skip_count} (duplicate gpos — separate groups)")
if DRY_RUN:
    print("[DRY RUN] No changes written.")

conn.close()
