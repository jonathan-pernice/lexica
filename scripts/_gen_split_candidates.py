#!/usr/bin/env python3
"""_gen_split_candidates.py — LOCAL dev tool. Generates the vetted merge-fix list
(scripts/split_merge_fixes.json) by running the IMPROVED splitter over the rows of
a real bible.db and keeping only the provably-clean results.

Reads live rows (so every fix is pinned to the actual data — pronoun corrections
and all), copies each verse, runs the patched _split_compounds on the copy, then
classifies the change:

  CLEAN only if, for every changed Greek word:
    * a FUNCTION word (article/copula/negation/conjunction/preposition) only SHEDS
      to its own meaning ("they know not" -> "not") — never emptied, never gains a
      content word (the article restricted to determiners, its def leaks "be");
    * a content/pronoun slot that goes empty -> filled gets a word genuinely in its
      own definition; no content slot is emptied;
    * any changed Greek word that repeats in the verse only changed once (pinnable).

Usage: python scripts/_gen_split_candidates.py bible.db [--dump]
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_words_from_abp as B

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")

FUNC = {
    "3588", "1510",
    "3756", "3361", "3364", "3761", "3762", "3763", "3777", "3780",
    "2532", "1161", "3767", "235", "1063", "3754", "2443", "1487", "5613",
    "1437", "3303", "2228", "686", "1065", "5037",
    "1722", "1519", "1537", "575", "4314", "2596", "3326", "1223", "1909",
    "4012", "5228", "5259", "4253", "473", "303", "3844", "1799", "1715",
    "3694", "561", "1726", "630", "3936",
}
FUNC_ENG = {
    "the", "a", "an", "this", "that", "these", "those",
    "my", "thy", "your", "his", "her", "our", "their", "its", "whose",
    "i", "you", "ye", "thou", "thee", "we", "they", "he", "she", "it",
    "me", "him", "them", "us", "who", "whom", "which", "what",
    "do", "did", "does", "shall", "will", "would", "should", "may", "might",
    "can", "could", "must", "let", "have", "has", "had",
    "am", "is", "are", "was", "were", "be", "been", "being",
    "not", "no", "nor", "never", "lest",
    "and", "or", "but", "if", "for", "because", "when", "while", "as", "than",
    "so", "then", "therefore", "yet", "though", "until", "both",
    "of", "in", "by", "with", "to", "from", "at", "on", "into", "unto", "upon",
    "over", "under", "through", "within", "against", "among", "before", "after",
    "about", "concerning", "during", "toward", "towards", "out", "off", "up",
    "down", "around", "between", "near", "onto", "behind", "beside",
}
_ART_DET = {"the", "a", "an", "this", "that", "these", "those",
            "my", "thy", "your", "his", "her", "our", "its", "their", "whose"}
_NORM = re.compile(r"[^\w]")

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
lex = B.load_lexicon(conn)


def split_sbase(sb):
    """Strong's base as the splitter should see it. Greek -> bare number. Hebrew
    (H-numbers, from tipnr) + placeholders -> '*', so _split_compounds ignores
    them exactly as it did at build time (PN slots were '*' then). This also
    avoids a bare H-number colliding with the same Greek number in the lexicon."""
    if sb and sb[0] == "G":
        return sb[1:]
    return "*"


def in_own_def(sbase, eng):
    own = lex.get(sbase, set())
    if not own or not eng:
        return False
    return any(_NORM.sub("", w).lower() in own for w in eng.split())


def all_func_eng(eng):
    ws = [_NORM.sub("", w).lower() for w in (eng or "").split()]
    ws = [w for w in ws if w]
    return bool(ws) and all(w in FUNC_ENG for w in ws)


# Load every verse's rows in the 13-wide shape _split_compounds expects.
rows_by_v = {}
ref_by_v = {}
for r in conn.execute(
    """SELECT w.verse_id, w.position, w.english, w.english_head, w.strongs,
              w.strongs_base, w.greek_pos, w.bracket_id, w.italic,
              w.italic_words, w.smcap_words, w.morph, w.lemma,
              v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       ORDER BY w.verse_id, w.position"""
):
    vid = r["verse_id"]
    if vid not in rows_by_v:
        rows_by_v[vid] = []
        ref_by_v[vid] = f"{r['book']} {r['chapter']}:{r['verse']}"
    rows_by_v[vid].append((
        r["position"], r["english"], r["english_head"], r["strongs"],
        split_sbase(r["strongs_base"]),
        r["greek_pos"], r["bracket_id"], r["italic"],
        r["italic_words"] or "", r["smcap_words"] or "",
        (r["greek_pos"] if r["bracket_id"] is not None else None),
        r["morph"], r["lemma"],
    ))
conn.close()

clean = {}
reasons = {}
changed = 0

for vid, rows in rows_by_v.items():
    before = [(r[0], r[4], r[1]) for r in rows]  # pos, sbase, english
    work = [tuple(r) for r in rows]
    B._split_compounds(work, lex, carry=True)
    after = [(r[0], r[4], r[1]) for r in work]
    if after == before:
        continue
    changed += 1

    if sorted(x[1] for x in before) != sorted(x[1] for x in after):
        reasons["strongs-set-differs"] = reasons.get("strongs-set-differs", 0) + 1
        continue

    b_by, n_by = {}, {}
    for pos, sb, eng in before:
        b_by.setdefault(sb, []).append((pos, eng))
    for pos, sb, eng in after:
        n_by.setdefault(sb, []).append((pos, eng))

    ops, bad = [], None
    for sb in b_by:
        changed_pairs = [(b, n) for b, n in zip(sorted(b_by[sb]), sorted(n_by[sb])) if b != n]
        if not changed_pairs:
            continue
        if len(changed_pairs) > 1:
            bad = "ambiguous-multi-change-same-strongs"; break
        (b_pos, b_eng), (n_pos, n_eng) = changed_pairs[0]
        b_empty = not (b_eng and b_eng.strip())
        n_empty = not (n_eng and n_eng.strip())
        if sb in FUNC:
            if not b_empty and n_empty:
                bad = "function-word-emptied"; break
            if sb == "3588":
                ws = [_NORM.sub("", w).lower() for w in (n_eng or "").split()]
                if not all(w in _ART_DET for w in ws if w):
                    bad = "article-gains-nondeterminer"; break
            elif not all_func_eng(n_eng):
                bad = "function-word-gains-content"; break
        else:
            if not b_empty and n_empty:
                bad = "content-slot-emptied"; break
            if b_empty and not in_own_def(sb, n_eng):
                bad = "filled-but-no-def-match"; break
        ops.append({"sbase": sb, "old_pos": b_pos, "old_eng": b_eng,
                    "new_pos": n_pos, "new_eng": n_eng, "new_head": B._head_word(n_eng)})
    if bad:
        reasons[bad] = reasons.get(bad, 0) + 1
        continue
    if not ops:
        reasons["no-op"] = reasons.get("no-op", 0) + 1
        continue
    clean[ref_by_v[vid]] = sorted(ops, key=lambda o: o["new_pos"])

Path("scripts/split_merge_fixes.json").write_text(
    json.dumps(clean, ensure_ascii=False, indent=1), encoding="utf-8")

print(f"changed verses: {changed}")
print(f"CLEAN (written to split_merge_fixes.json): {len(clean)}")
print("dropped by reason:")
for r, c in sorted(reasons.items(), key=lambda x: -x[1]):
    print(f"   {c:>4}  {r}")

if "--dump" in sys.argv:
    print("\n--- sample ---")
    for v in list(clean)[:30]:
        s = " ; ".join(f"G{o['sbase']}:{o['old_eng']!r}->{o['new_eng']!r}" for o in clean[v])
        print(f"{v}: {s}")
