#!/usr/bin/env python3
"""
audit_bracket_collapse.py — READ-ONLY. Scope finder for DUAL-ORDERING use-case #2
("split shared-Strong's bracket words onto their own slots").

THE QUESTION #2 ASKS:  inside a real (source-numbered) ABP bracket, is there a DB
slot whose English gloss actually covers >=2 DISTINCT Greek source tokens — i.e.
several numbered Greek words COLLAPSED onto one clickable slot, all sharing one
Strong's? Those (and only those) are the safe split targets: the source already
carries each token's own number (abp_pos) + Strong's, so splitting needs NO
heuristic — give each numbered token back its own slot, position=Greek/source
order, greek_pos=abp_pos reading order.

THE TRAP (why this is read-only-first):  the LEGIT case looks identical at a
glance — ONE Greek word glossed as several English words ("and the LORD" on a
single κύριος/G2962 token; "of the king" on one βασιλεύς/G935 token). Those SHARE
one Strong's BY DESIGN and must NOT be split (the extra English words are
ABP-supplied function words with NO source number — splitting them would invent
data; they are the project's NON-GOAL italics). The discriminator is the SOURCE
bracket numbers: a real collapse = one DB row covering tokens that have >=2
distinct abp_pos / >=2 distinct Strong's. A single source token with a multi-word
gloss is NOT a collapse, however many English words it has.

HOW IT DECIDES (per matched bracket):
  * Source side: parse the abp_texts/ line (same parser as audit_bracket_order.py).
    Each numbered bracket token = (gloss words, sbase, abp_pos, src order).
  * DB side: the bracket's rows (one row per source token by build design).
  * Match the DB bracket to the source bracket by Strong's overlap (audit_bracket_
    order.py's method). Build the two PRINTED-order word sequences (DB position
    order vs source src order). If they are NOT an identical word sequence the
    bracket is a REORDER/WORDSET case — out of #2's clean scope, counted under
    UNALIGNED and skipped (that is audit_bracket_order.py's job, not this one).
  * For cleanly-aligned brackets, walk the shared word sequence and tag each word
    with (its DB row, its source token). A DB row that maps to >=2 source tokens
    bearing >=2 DISTINCT non-supplied Strong's = a GENUINE COLLAPSE (the #2 target).

BUCKETS:
  GENUINE-COLLAPSE   a non-empty DB row spans >=2 distinct-Strong's source tokens
                     -> THE use-case #2 target set (split each numbered token out)
  SHARED-OK          >=2 DB rows share a strongs_base but each is its OWN source
                     token already on its OWN slot (recurring article G3588 "the
                     ... the ...", repeated πρόσωπον, etc.) -> already clickable,
                     NOTHING TO DO
  UNALIGNED          chip word-sequence != source printed sequence (reorder/wordset)
                     -> audit_bracket_order.py's domain, not #2

READ-ONLY: opens the DB mode=ro, only reads abp_texts/. Never writes.

Run on PA (where bible.db AND abp_texts/ both live), from the repo root:
  python3 scripts/audit_bracket_collapse.py bible.db
  python3 scripts/audit_bracket_collapse.py bible.db --book 1Ch
  python3 scripts/audit_bracket_collapse.py bible.db --show-shared   # list SHARED-OK too
"""
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

# ── args ──────────────────────────────────────────────────────────────────────
ARGS = sys.argv[1:]
DB = next((a for a in ARGS if not a.startswith("--")), "bible.db")
MIN_WORDS = 2                       # a collapse needs >=2 source tokens => >=2 words
if "--min-words" in ARGS:
    MIN_WORDS = int(ARGS[ARGS.index("--min-words") + 1])
BOOK_FILTER = ARGS[ARGS.index("--book") + 1] if "--book" in ARGS else None
SHOW_SHARED = "--show-shared" in ARGS

# ── source parser (identical conventions to audit_bracket_order.py) ────────────
_STRONGS_RE = re.compile(r"(G\*|G\d+(?:\.\d+)*)")
_VERSE_RE   = re.compile(r"^\((\w+)\s+(\d+):(\d+)\)\s+(.*)")
_LEAD_NUM   = re.compile(r"^\d+")
_WORD_NUM   = re.compile(r"(?<!\w)\d+")
_NONWORD    = re.compile(r"[^\w\s]")


def norm_words(text):
    t = (text or "").replace("[", "").replace("]", "")
    t = _WORD_NUM.sub("", t)
    t = _NONWORD.sub(" ", t)
    return [w for w in t.lower().split() if w]


def clean_eng(raw):
    t = raw.strip().replace("[", "").replace("]", "")
    return _WORD_NUM.sub("", t).strip()


def src_base(raw_strongs):
    if raw_strongs == "G*":
        return "*"
    return raw_strongs.split(".")[0]


def bracket_info(raw):
    opens = "[" in raw
    closes = "]" in raw
    s = re.sub(r"[^\w\s]", "", raw.strip().lstrip("[")).strip()
    m = _LEAD_NUM.match(s)
    abp_pos = int(m.group()) if m else None
    return abp_pos, opens, closes


def parse_source_line(text):
    parts = _STRONGS_RE.split(text)
    pairs = []
    i = 0
    while i < len(parts) - 1:
        pairs.append((parts[i], parts[i + 1]))
        i += 2
    if parts and parts[-1].strip():
        pairs.append((parts[-1], None))

    toks = []
    in_bracket = False
    br_idx = 0
    src_order = 0
    for raw, strongs in pairs:
        abp_pos, opens, closes = bracket_info(raw)
        if opens and not in_bracket:
            br_idx += 1
            in_bracket = True
        cur_br = br_idx if in_bracket else None
        if closes:
            in_bracket = False
        toks.append({
            "eng": clean_eng(raw),
            "words": norm_words(raw),
            "sbase": src_base(strongs) if strongs else "",
            "abp_pos": abp_pos,
            "br": cur_br,
            "src_i": src_order,
        })
        src_order += 1
    return toks


# ── load source brackets ───────────────────────────────────────────────────────
src_brackets = {}     # (book,ch,vs) -> { br_idx: [tokens...] }
for d in (Path("abp_texts/abp_ot_texts"), Path("abp_texts/abp_nt_texts")):
    if not d.is_dir():
        continue
    for txt in sorted(d.glob("*.txt")):
        with txt.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                m = _VERSE_RE.match(line.strip())
                if not m:
                    continue
                ref = (m.group(1), int(m.group(2)), int(m.group(3)))
                bygrp = defaultdict(list)
                for t in parse_source_line(m.group(4)):
                    if t["br"] is not None:
                        bygrp[t["br"]].append(t)
                if bygrp:
                    src_brackets[ref] = dict(bygrp)

if not src_brackets:
    print("ERROR: no source brackets parsed — run from repo root (abp_texts/ must be reachable).")
    sys.exit(1)

# ── load DB bracketed words ───────────────────────────────────────────────────
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
db_rows = conn.execute(
    """SELECT w.position, w.english, w.greek_pos, w.bracket_id, w.strongs_base,
              v.book, v.chapter, v.verse
       FROM words w JOIN verses v ON v.id = w.verse_id
       WHERE w.bracket_id IS NOT NULL
       ORDER BY v.book, v.chapter, v.verse, w.bracket_id, w.position"""
).fetchall()
conn.close()

db_brackets = defaultdict(lambda: defaultdict(list))   # ref -> {bracket_id: [rows]}
for r in db_rows:
    ref = (r["book"], r["chapter"], r["verse"])
    db_brackets[ref][r["bracket_id"]].append(r)


def base_multiset(items, key):
    c = defaultdict(int)
    for it in items:
        b = it[key]
        if b and b not in ("*", ""):
            c[b] += 1
    return c


def overlap(a, b):
    return sum(min(a.get(k, 0), b.get(k, 0)) for k in set(a) | set(b))


# ── compare ───────────────────────────────────────────────────────────────────
genuine = []          # GENUINE-COLLAPSE hits  (the #2 target)
shared_ok = []        # >=2 rows share a base but each is its own source token
unaligned = 0         # chip seq != source printed seq (reorder/wordset; out of scope)
checked = 0

for ref, grpmap in src_brackets.items():
    if BOOK_FILTER and ref[0] != BOOK_FILTER:
        continue
    db_grps = db_brackets.get(ref, {})
    used_db = set()

    for br_idx, stoks in grpmap.items():
        disp = [t for t in stoks if t["words"]]
        if len(disp) < MIN_WORDS:
            continue

        src_ms = base_multiset(disp, "sbase")
        best_bid, best_ov = None, 0
        for bid, rows in db_grps.items():
            if bid in used_db:
                continue
            ov = overlap(src_ms, base_multiset(rows, "strongs_base"))
            if ov > best_ov:
                best_ov, best_bid = ov, bid
        if best_bid is None or best_ov < 2:
            continue
        used_db.add(best_bid)
        checked += 1

        rows = db_grps[best_bid]
        disp_rows = [r for r in rows if (r["english"] or "").strip()]

        # PRINTED-order word sequences, each word tagged with its owning unit.
        src_seq = [(w, t["src_i"], t["sbase"])
                   for t in sorted(disp, key=lambda t: t["src_i"]) for w in t["words"]]
        db_seq = [(w, idx, r["strongs_base"])
                  for idx, r in enumerate(sorted(disp_rows, key=lambda r: r["position"]))
                  for w in norm_words(r["english"])]

        # #2 is only unambiguous when the two PRINTED word sequences are identical
        # (same words, same order). A difference = reorder/wordset = the other audit.
        if [w for w, _, _ in src_seq] != [w for w, _, _ in db_seq]:
            unaligned += 1
            continue

        # Walk the aligned sequences; record which source tokens each DB row covers.
        row_tokens = defaultdict(set)        # db_row_idx -> {(src_i, sbase)}
        for (_, row_idx, _), (__, src_i, sbase) in zip(db_seq, src_seq):
            row_tokens[row_idx].add((src_i, sbase))

        collapsed = []
        for row_idx, toks in row_tokens.items():
            distinct_bases = {sb for _, sb in toks if sb not in ("*", "")}
            if len(toks) >= 2 and len(distinct_bases) >= 2:
                collapsed.append((row_idx, sorted(toks)))

        if collapsed:
            genuine.append((ref, best_bid, disp_rows, disp, collapsed))
            continue

        # not a collapse — note whether sibling rows merely share a base (already-separate)
        db_ms = base_multiset(disp_rows, "strongs_base")
        if any(c >= 2 for c in db_ms.values()):
            shared_ok.append((ref, [b for b, c in db_ms.items() if c >= 2], disp))


total_src_brackets = (len([r for r in src_brackets if not BOOK_FILTER or r[0] == BOOK_FILTER]))

print(f"READ-ONLY bracket-COLLAPSE audit (DUAL-ORDERING use-case #2 scope) -> {DB}")
print(f"  source verses with brackets        : {total_src_brackets}")
print(f"  real brackets matched + checked    : {checked}")
print()
print(f"  GENUINE-COLLAPSE (the #2 target)   : {len(genuine)}   <-- SPLIT THESE")
print(f"  SHARED-OK (already own slots)      : {len(shared_ok)}   (recurring article etc. — nothing to do)")
print(f"  UNALIGNED (reorder/wordset)        : {unaligned}   (audit_bracket_order.py's domain, not #2)")
print()
print("  GENUINE-COLLAPSE = one DB slot's gloss spans >=2 source tokens with >=2 distinct")
print("  Strong's (several numbered Greek words bundled onto one chip). SHARED-OK = >=2 rows")
print("  share a base but each is its OWN numbered token already on its OWN slot.")
print()

if genuine:
    print("=== GENUINE-COLLAPSE samples (ref | source tokens vs DB rows) ===")
    for ref, bid, disp_rows, disp, collapsed in genuine[:30]:
        b, ch, vs = ref
        print(f"  {b} {ch}:{vs}  bracket_id={bid}")
        print("      source tokens : " + " | ".join(
            f"{t['abp_pos']}·{t['sbase']}·{t['eng']!r}" for t in sorted(disp, key=lambda t: t['src_i'])))
        print("      DB rows        : " + " | ".join(
            f"{r['strongs_base']}·{(r['english'] or '').strip()!r}"
            for r in sorted(disp_rows, key=lambda r: r['position'])))
        for row_idx, toks in collapsed:
            print(f"      -> row {row_idx} bundles tokens: " +
                  ", ".join(f"{sb}" for _, sb in toks))
    print()
else:
    print("=== GENUINE-COLLAPSE: none found ===")
    print("  Every numbered Greek word in a real bracket already has its own DB slot.")
    print("  (Expected: build_verse_words emits one row per source token, and")
    print("   _split_compounds skips bracketed slots since commit 0a4b146.)")
    print()

if SHOW_SHARED and shared_ok:
    print("=== SHARED-OK samples (>=2 rows share a base, each its own token) ===")
    for ref, bases, disp in shared_ok[:30]:
        b, ch, vs = ref
        toks = " | ".join(f"{t['abp_pos']}·{t['sbase']}·{t['eng']!r}"
                          for t in sorted(disp, key=lambda t: t['src_i']))
        print(f"  {b} {ch}:{vs}  shared={bases}")
        print(f"      {toks}")
    print()

print("This script writes nothing. Report GENUINE-COLLAPSE count before proposing a repair.")
