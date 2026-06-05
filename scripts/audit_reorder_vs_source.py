#!/usr/bin/env python3
"""
audit_reorder_vs_source.py — READ-ONLY. Find synthetic reorder brackets whose
English-last word is a SUBJECT pronoun (nominative), and print our current
order next to the raw ABP source line so we can re-order to match the source.

A synthetic reorder put the pronoun at the highest greek_pos (English-last) with
the verb at a lower greek_pos (English-first) — i.e. it reads "verb + subject".
For a subject pronoun that's usually backwards. The ABP source line is the
ground truth for the correct order.

Subject detection = grammar tag (morph) is NOMINATIVE, OR the gloss is a plain
subject word (he/she/they/we/I) — the OR catches mis-tagged morphs (e.g. Dan 2:47
"he" is wrongly tagged genitive). "you/it" are caught only when morph-nominative,
to avoid the (common) object uses.

READ-ONLY (mode=ro for the DB; reads abp_texts/ source files). Never writes.

Usage (run on PA where bible.db + abp_texts/ both live):
  python3 scripts/audit_reorder_vs_source.py bible.db
"""
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")

PRONOUN_SB = {f"G{n}" for n in (
    "846", "4675", "4771", "4571", "4674", "4671",
    "5210", "5216", "5213", "5209", "2249", "2257", "2254", "2248",
)}
SUBJECT_WORDS = {"i", "he", "she", "they", "we"}

KNOWN8 = {
    ("1Pe", 5, 10), ("Mar", 1, 45), ("Joh", 4, 51), ("Jer", 10, 16),
    ("Dan", 2, 47), ("Psa", 79, 13), ("Eze", 11, 3), ("Job", 35, 13),
}


def bareword(s):
    return re.sub(r"[^\w]", "", (s or "")).lower()


def is_nominative(morph):
    """True if the grammar tag is nominative, in either scheme.
    CATSS (OT, dotted): RP.NP, RD.NSM ... -> case is first letter after '.'
    Robinson (NT, hyphen): P-NSM, P-1NS, P-2NP ... -> case after 'P-' (+person digit)."""
    m = (morph or "").strip()
    if not m:
        return False
    if "." in m:                       # CATSS
        tail = m.split(".", 1)[1].lstrip("123")
        return tail[:1] == "N"
    parts = m.split("-")               # Robinson
    if len(parts) >= 2:
        return parts[1].lstrip("123")[:1] == "N"
    return False


# ── build a source verse-ref -> raw line map from abp_texts/ ──────────────────
SRC_RE = re.compile(r"^\((\w+)\s+(\d+):(\d+)\)")
src_map = {}
for d in (Path("abp_texts/abp_ot_texts"), Path("abp_texts/abp_nt_texts")):
    if not d.is_dir():
        continue
    for txt in sorted(d.glob("*.txt")):
        with txt.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                m = SRC_RE.match(line.strip())
                if m:
                    src_map[(m.group(1), int(m.group(2)), int(m.group(3)))] = line.strip()

# ── scan the DB ──────────────────────────────────────────────────────────────
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    """SELECT w.verse_id, w.position, w.english, w.greek_pos, w.bracket_id,
              w.strongs_base, w.morph, v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       WHERE w.bracket_id IS NOT NULL
       ORDER BY w.verse_id, w.bracket_id, w.position"""
).fetchall()

groups = defaultdict(list)
for r in rows:
    groups[(r["verse_id"], r["bracket_id"])].append(r)

cands = []
for (vid, bid), members in groups.items():
    disp = [m for m in members if (m["english"] or "").strip()]
    gp = [m for m in disp if m["greek_pos"] is not None]
    if len(disp) < 2 or not gp:
        continue
    pron = max(gp, key=lambda m: m["greek_pos"])
    if pron["strongs_base"] not in PRONOUN_SB:
        continue
    pw = bareword(pron["english"])
    if not (is_nominative(pron["morph"]) or pw in SUBJECT_WORDS):
        continue
    movers = [m for m in disp if m is not pron and (m["greek_pos"] or 99) < pron["greek_pos"]]
    if not movers:
        continue
    ref = (pron["book"], pron["chapter"], pron["verse"])
    pos_order = " ".join(f"{(m['english'] or '').strip()}" for m in sorted(disp, key=lambda m: m["position"]))
    gp_order = " ".join(f"{(m['english'] or '').strip()}" for m in sorted(disp, key=lambda m: (m["greek_pos"] or 99, m["position"])))
    cands.append({"ref": ref, "pron": (pron["english"] or "").strip(),
                  "morph": pron["morph"] or "", "pos": pos_order, "gp": gp_order})

cands.sort(key=lambda c: (c["ref"] not in KNOWN8, c["ref"]))  # NEW ones last? show known first
new = [c for c in cands if c["ref"] not in KNOWN8]

print(f"READ-ONLY reorder-vs-source sweep -> {DB}")
print(f"  candidate subject-pronoun reorders: {len(cands)}   "
      f"(known 8: {len(cands)-len(new)}, NEW: {len(new)})\n")

for c in cands:
    b, ch, vs = c["ref"]
    tag = "      " if c["ref"] in KNOWN8 else "[NEW] "
    print(f"{tag}{b} {ch}:{vs}   pronoun='{c['pron']}'  morph={c['morph']}")
    print(f"         our reorder shows : {c['gp']}")
    print(f"         (source/pos order): {c['pos']}")
    src = src_map.get(c["ref"])
    print(f"         ABP source: {src if src else '(source line not found)'}")
    print()

conn.close()
