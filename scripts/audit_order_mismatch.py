#!/usr/bin/env python3
"""
audit_order_mismatch.py — READ-ONLY. Of the synthetic subject-pronoun reorders,
show ONLY the ones where our rendered order DISAGREES with the ABP source order.

Most subject-pronoun reorders are correct (our "but we" == source "but we"); only
a few are genuinely backwards (our "may ready he" vs source "may he ready"). This
compares our greek_pos reading word-for-word against the source line's word order
and prints just the mismatches — the real fix set.

Lines whose source contains a real ABP bracket "[" near the words are TAGGED
[SRC-BRACKET?] — those may be legitimate ABP reorders (numbered in the source),
not synthetic, so review before touching.

READ-ONLY (mode=ro DB; reads abp_texts/). Never writes.

Usage (on PA):  python3 scripts/audit_order_mismatch.py bible.db
"""
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")

PRONOUN_SB = {f"G{n}" for n in (
    "846", "4675", "4771", "4571", "4674", "4671",
    "5210", "5216", "5213", "5209", "2249", "2257", "2254", "2248",
)}
SUBJECT_WORDS = {"i", "he", "she", "they", "we"}


def norm(s):
    return re.sub(r"[^\w]", "", (s or "")).lower()


def is_nominative(morph):
    m = (morph or "").strip()
    if not m:
        return False
    if "." in m:
        return m.split(".", 1)[1].lstrip("123")[:1] == "N"
    parts = m.split("-")
    return len(parts) >= 2 and parts[1].lstrip("123")[:1] == "N"


def source_words(line):
    """English words of a raw ABP source line, in order, strongs stripped."""
    body = re.sub(r"^\([^)]*\)\s*", "", line)
    out = []
    for tok in body.split():
        t = re.sub(r"(G\*|G\d[\d.]*|H\d[\d.]*)$", "", tok)  # strip glued strongs
        t = norm(t)
        if t:
            out.append(t)
    return out


# source map
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

mismatches = []
for (vid, bid), members in groups.items():
    disp = [m for m in members if (m["english"] or "").strip()]
    gp = [m for m in disp if m["greek_pos"] is not None]
    if len(disp) < 2 or not gp:
        continue
    pron = max(gp, key=lambda m: m["greek_pos"])
    if pron["strongs_base"] not in PRONOUN_SB:
        continue
    if not (is_nominative(pron["morph"]) or norm(pron["english"]) in SUBJECT_WORDS):
        continue
    if not [m for m in disp if m is not pron and (m["greek_pos"] or 99) < pron["greek_pos"]]:
        continue

    ref = (pron["book"], pron["chapter"], pron["verse"])
    line = src_map.get(ref)
    if not line:
        continue

    # our reading = greek_pos order, flattened to words
    our_seq = []
    for m in sorted(disp, key=lambda m: (m["greek_pos"] or 99, m["position"])):
        our_seq += [norm(w) for w in (m["english"] or "").split() if norm(w)]
    # source reading of the SAME words, in source order
    src_all = source_words(line)
    want = Counter(our_seq)
    src_seq = []
    for w in src_all:
        if want.get(w, 0) > 0:
            src_seq.append(w)
            want[w] -= 1

    if len(src_seq) == len(our_seq) and src_seq != our_seq:
        mismatches.append({
            "ref": ref, "our": " ".join(our_seq), "src": " ".join(src_seq),
            "srcbracket": "[" in line, "line": line,
        })

mismatches.sort(key=lambda c: c["ref"])
print(f"READ-ONLY order-mismatch audit -> {DB}")
print(f"  genuine order mismatches (our reading != source): {len(mismatches)}\n")
for c in mismatches:
    tag = "  [SRC-BRACKET?]" if c["srcbracket"] else ""
    b, ch, vs = c["ref"]
    print(f"  {b} {ch}:{vs}{tag}")
    print(f"      ours  : {c['our']}")
    print(f"      source: {c['src']}")
print()
print("Fix = make these read in the source order, drop the synthetic bracket.")
print("[SRC-BRACKET?] = source has a real bracket; review before touching.")
conn.close()
