#!/usr/bin/env python3
"""audit_lord_strongs.py — READ-ONLY. Why does the word "LORD" (κύριος/G2962)
sometimes render without its G2962 Strong's in chip mode? This quantifies it and
buckets the cause.

It replicates the frontend `strongsAnchorIndex` (static/app.jsx) to predict which
word of a multi-word gloss actually shows the Strong's, then checks whether the
"LORD" word lands on a G2962 row AND is that anchor word.

Buckets (per "LORD"/"lord" word occurrence):
  OK            "LORD" sits on a G2962 row and IS the displayed anchor → shows G2962 ✓
  ANCHOR-MORPH  "LORD" on a G2962 row but NOT the anchor — the anchor fell to the first
                word because the row has no morph (isContent=false). FRONTEND-fixable:
                anchor on english_head even when morph is null.
  WRONG-SLOT    the "LORD" text sits on a NON-G2962 row (bundled onto a sibling, e.g. the
                article) — the κύριος slot is elsewhere/empty. DATA class (tier1 C1).

READ-ONLY (mode=ro). Run on PA:  python3 scripts/audit_lord_strongs.py bible.db
"""
import re
import sqlite3
import sys
from collections import Counter

DB = next((a for a in sys.argv[1:] if not a.startswith("-")), "bible.db")


def bare(s):
    return re.sub(r"[^\w]", "", s or "").lower()


def anchor_index(parts, italic_set, morph, head):
    """Mirror of strongsAnchorIndex(parts, italicSet, w) in app.jsx."""
    first_non_italic = next((i for i, w in enumerate(parts)
                             if bare(w) not in italic_set), 0)
    m = morph or ""
    is_content = bool(m) and m[0] in ("V", "N", "A")
    if is_content and head:
        hb = bare(head)
        for i, w in enumerate(parts):
            if bare(w) == hb and bare(w) not in italic_set:
                return i
    return first_non_italic


conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT english, english_head, strongs_base, morph, italic_words, bracket_id "
    "FROM words WHERE english LIKE '%lord%'"
).fetchall()

buckets = Counter()
upper_only = Counter()          # restrict to capital "LORD" (divine name)
samples = {"ANCHOR-MORPH": [], "WRONG-SLOT": []}

for r in rows:
    eng = r["english"] or ""
    parts = eng.split()
    italic_set = set((r["italic_words"] or "").split(",")) if r["italic_words"] else set()
    lord_idxs = [i for i, w in enumerate(parts) if bare(w) == "lord"]
    if not lord_idxs:
        continue
    single = " " not in eng
    ai = None if single else anchor_index(parts, italic_set, r["morph"], r["english_head"])
    for li in lord_idxs:
        is_upper = parts[li].replace(",", "").replace(".", "").isupper()
        # single-word rows show their own Strong's directly (no anchor logic)
        if single:
            tag = "OK" if r["strongs_base"] == "G2962" else "WRONG-SLOT"
        elif r["strongs_base"] != "G2962":
            tag = "WRONG-SLOT"
        elif li == ai:
            tag = "OK"
        else:
            tag = "ANCHOR-MORPH"
        buckets[tag] += 1
        if is_upper:
            upper_only[tag] += 1
        if tag in samples and len(samples[tag]) < 12:
            samples[tag].append((r["strongs_base"], r["morph"] or "∅", eng))
conn.close()

total = sum(buckets.values())
print(f"READ-ONLY 'LORD'/κύριος Strong's-display audit -> {DB}")
print(f"  total 'LORD'/'lord' word occurrences: {total:,}  (capital 'LORD' only: {sum(upper_only.values()):,})\n")
for tag in ("OK", "ANCHOR-MORPH", "WRONG-SLOT"):
    print(f"  {tag:13}: {buckets[tag]:6,}   (capital LORD: {upper_only[tag]:,})")
print()
print("  ANCHOR-MORPH = frontend strongsAnchorIndex fix (anchor on head even w/ null morph)")
print("  WRONG-SLOT   = data: 'LORD' bundled onto a non-κύριος slot (tier1 C1 class)\n")
for tag in ("ANCHOR-MORPH", "WRONG-SLOT"):
    if samples[tag]:
        print(f"  --- {tag} samples (strongs_base | morph | english) ---")
        for sb, m, eng in samples[tag]:
            print(f"      {sb:7} | {m:8} | {eng!r}")
        print()
