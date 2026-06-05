#!/usr/bin/env python3
"""
audit_bracket_order.py — READ-ONLY. The word-ORDER slice of the Full Corpus Audit.

Compares, for every REAL multi-word ABP bracket (>=3 displayed words), our rendered
word order against the ABP source line's numbered order in abp_texts/ — the source's
`[2day 1the second]` superscript numbers (abp_pos) are the ground truth for English
reading order.

WHY A FRESH COMPARATOR (not audit_order_mismatch.py): that script greedily projects
source words onto our words via a Counter, which mis-pairs repeated words (you/we/the)
-> ~63 false positives. This one never fuzzy-matches words: it builds two ORDERED word
sequences (source ground-truth vs DB) and compares them as lists. No greedy pairing.

TWO AXES — the build never calls _sort_brackets, so `position` is NOT abp_pos order:
  CHIP  = words in `position` order  -> should equal the source's PRINTED (Greek
          L-to-R) token order. Only `_split_compounds` fronting perturbs `position`,
          so a CHIP mismatch is a real garble (the 1Ch 15:13 "the and LORD" class).
  PROSE = words in `greek_pos` order -> should equal the abp_pos READING order
          (the frontend sorts brackets by greek_pos). A PROSE-only mismatch is
          greek_pos-vs-abp_pos (BH numbering) divergence — a separate, lower
          priority class, NOT the _split_compounds garble.
  ( `[2day 1the second]`  printed = "day the second" (chip);  abp# reading =
    "the second day" (prose).  Earlier versions wrongly judged BOTH against the
    reading order, flagging every reordered bracket -> ~647 false positives. )

REAL vs SYNTHETIC:
  Source brackets are numbered `[...]` in the txt. Synthetic brackets (created by
  `_redistribute_pronoun_compounds`, the 2-word pronoun+verb brackets) have NO `[` in
  the source. This audit is SOURCE-bracket-driven, so it only ever inspects REAL
  brackets. DB brackets that match no source bracket are counted as synthetic and
  listed by ref only (their order is the _redistribute design, not a defect).

CLASSIFICATION of a real-bracket mismatch:
  REORDER     same word multiset, different order      -> genuine order garble (rank high)
  WORDSET     different word multiset                  -> a word moved out of / into the
                                                          bracket (redistribution); inspect
  Benign tags (down-rank, do NOT auto-trust):
    [kurios-dup]   bracket contains the κύριος "the LORD"/article shared-index pattern
                   (G2962 + G3588) — Tier-1 D-class benign dup
    [empty-carrier] DB bracket has >=1 empty-english slot (redistribution carrier)

READ-ONLY: opens the DB with mode=ro and only reads abp_texts/. Never writes.

Usage (run on PA, where bible.db AND abp_texts/ both live):
  python3 scripts/audit_bracket_order.py bible.db
  python3 scripts/audit_bracket_order.py bible.db --min-words 3      # default 3
  python3 scripts/audit_bracket_order.py bible.db --all              # show WORDSET too
  python3 scripts/audit_bracket_order.py bible.db --book 1Ch         # filter one book
"""
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

# ── args ──────────────────────────────────────────────────────────────────────
ARGS = sys.argv[1:]
DB = next((a for a in ARGS if not a.startswith("--")), "bible.db")
MIN_WORDS = 3
if "--min-words" in ARGS:
    MIN_WORDS = int(ARGS[ARGS.index("--min-words") + 1])
SHOW_ALL = "--all" in ARGS
BOOK_FILTER = ARGS[ARGS.index("--book") + 1] if "--book" in ARGS else None

# ── regexes (match build_words_from_abp.py exactly) ───────────────────────────
_STRONGS_RE = re.compile(r"(G\*|G\d+(?:\.\d+)*)")
_VERSE_RE   = re.compile(r"^\((\w+)\s+(\d+):(\d+)\)\s+(.*)")
_LEAD_NUM   = re.compile(r"^\d+")
_WORD_NUM   = re.compile(r"(?<!\w)\d+")
_NONWORD    = re.compile(r"[^\w\s]")


def norm_words(text):
    """Normalized word list of an English gloss: lowercase, punctuation stripped,
    bracket position-numbers removed, empties dropped."""
    t = (text or "").replace("[", "").replace("]", "")
    t = _WORD_NUM.sub("", t)
    t = _NONWORD.sub(" ", t)
    return [w for w in t.lower().split() if w]


def clean_eng(raw):
    t = raw.strip().replace("[", "").replace("]", "")
    t = _WORD_NUM.sub("", t)
    return t.strip()


def src_base(raw_strongs):
    """Source strongs token -> DB-style strongs_base. 'G2962'->'G2962',
    'G1249.2'->'G1249', 'G*'->'*'."""
    if raw_strongs == "G*":
        return "*"
    return raw_strongs.split(".")[0]


def bracket_info(raw):
    opens  = "[" in raw
    closes = "]" in raw
    s = re.sub(r"[^\w\s]", "", raw.strip().lstrip("[")).strip()
    m = _LEAD_NUM.match(s)
    abp_pos = int(m.group()) if m else None
    return abp_pos, opens, closes


def parse_source_line(text):
    """Yield source tokens of a verse body as dicts, tagging which numbered source
    bracket each belongs to (br_idx; None outside brackets)."""
    parts = _STRONGS_RE.split(text)
    toks = []
    pairs = []
    i = 0
    while i < len(parts) - 1:
        pairs.append((parts[i], parts[i + 1]))
        i += 2
    if parts and parts[-1].strip():
        pairs.append((parts[-1], None))

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


# ── load source ───────────────────────────────────────────────────────────────
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
                toks = parse_source_line(m.group(4))
                bygrp = defaultdict(list)
                for t in toks:
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
        b = it[key] if isinstance(it, dict) else it[key]
        if b and b not in ("*", ""):
            c[b] += 1
    return c


def overlap(a, b):
    keys = set(a) | set(b)
    return sum(min(a.get(k, 0), b.get(k, 0)) for k in keys)


# ── compare ───────────────────────────────────────────────────────────────────
chip_hits = []        # chip (position) disagrees with PRINTED source order
prose_hits = []       # chip OK but prose (greek_pos) disagrees with READING order
synthetic_refs = set()
real_checked = 0

for ref, grpmap in src_brackets.items():
    if BOOK_FILTER and ref[0] != BOOK_FILTER:
        continue
    db_grps = db_brackets.get(ref, {})
    used_db = set()

    for br_idx, stoks in grpmap.items():
        disp = [t for t in stoks if t["words"]]            # displayed source tokens
        if len(disp) < MIN_WORDS:
            continue

        # TWO ground-truth axes — the build never calls _sort_brackets, so:
        #   CHIP  renders in `position` = source PRINTED (Greek L-to-R) order
        #   PROSE renders in `greek_pos` = abp_pos READING order (frontend sorts by it)
        # Each DB channel must be judged against its OWN source axis, NOT a single one
        # (checking chip against the reading order flagged every reordered bracket).
        printed_gt = [w for t in sorted(disp, key=lambda t: t["src_i"]) for w in t["words"]]
        abp_gt = [w for t in sorted(disp, key=lambda t: (t["abp_pos"] if t["abp_pos"] is not None else 9999, t["src_i"]))
                  for w in t["words"]]
        src_ms = base_multiset(disp, "sbase")

        # find best-matching unused DB bracket in this verse (by strongs overlap)
        best_bid, best_ov = None, 0
        for bid, rows in db_grps.items():
            if bid in used_db:
                continue
            ov = overlap(src_ms, base_multiset(rows, "strongs_base"))
            if ov > best_ov:
                best_ov, best_bid = ov, bid
        if best_bid is None or best_ov < 2:
            continue                                       # no DB counterpart -> skip (likely split differently)
        used_db.add(best_bid)
        real_checked += 1

        rows = db_grps[best_bid]
        disp_rows = [r for r in rows if (r["english"] or "").strip()]
        chip_seq = [w for r in sorted(disp_rows, key=lambda r: r["position"])
                    for w in norm_words(r["english"])]
        prose_seq = [w for r in sorted(disp_rows, key=lambda r: (r["greek_pos"] if r["greek_pos"] is not None else 9999, r["position"]))
                     for w in norm_words(r["english"])]

        chip_bad  = chip_seq != printed_gt      # chip judged vs PRINTED order
        prose_bad = prose_seq != abp_gt          # prose judged vs READING order
        if not chip_bad and not prose_bad:
            continue

        # A chip mismatch can only come from _split_compounds fronting a redistributed
        # word (the only pass that perturbs `position`); that is the real "our build
        # tangled the printed order" garble. A prose-only mismatch is greek_pos vs
        # abp_pos divergence (BH numbering) — separate, lower-priority.
        bases = [r["strongs_base"] for r in rows]
        tags = []
        if "G2962" in bases and "G3588" in bases:
            tags.append("kurios-dup")
        if any(not (r["english"] or "").strip() for r in rows):
            tags.append("empty-carrier")

        hit = {
            "ref": ref, "tags": tags,
            "printed": " ".join(printed_gt), "reading": " ".join(abp_gt),
            "chip": " ".join(chip_seq), "prose": " ".join(prose_seq),
            "chip_bad": chip_bad, "prose_bad": prose_bad,
            "chip_reorder": sorted(chip_seq) == sorted(printed_gt),   # same words, wrong order
            "prose_reorder": sorted(prose_seq) == sorted(abp_gt),
            "nwords": len(printed_gt),
        }
        if chip_bad:
            chip_hits.append(hit)
        elif prose_bad:
            prose_hits.append(hit)

    # any DB bracket left unmatched in a verse that HAS source brackets is synthetic-ish
    for bid in db_grps:
        if bid not in used_db:
            synthetic_refs.add((ref, bid))


def rank_key(h):
    # no benign tag first, most words first
    return (bool(h["tags"]), -h["nwords"], h["ref"])


chip_hits.sort(key=rank_key)
prose_hits.sort(key=rank_key)

chip_clean  = [h for h in chip_hits if not h["tags"]]
chip_tagged = [h for h in chip_hits if h["tags"]]

print(f"READ-ONLY bracket-ORDER audit -> {DB}")
print(f"  source verses with brackets : {len(src_brackets)}")
print(f"  real brackets compared (>= {MIN_WORDS} words): {real_checked}")
print()
print(f"  CHIP mismatches (position != source PRINTED order): {len(chip_hits)}")
print(f"      genuine (no benign tag)              : {len(chip_clean)}   <-- TRIAGE THESE")
print(f"      tagged benign (kurios-dup/carrier)   : {len(chip_tagged)}")
print(f"  PROSE-only mismatches (greek_pos vs reading order): {len(prose_hits)}   (use --all)")
print(f"  synthetic / unmatched DB brackets        : {len(synthetic_refs)}")
print()
print("  CHIP = position order, should equal the source's PRINTED (Greek L-to-R) order;")
print("        only _split_compounds fronting perturbs it -> a mismatch is real garble.")
print("  PROSE-only = greek_pos disagrees with abp_pos reading order (BH numbering);")
print("        separate, lower-priority class — not the _split_compounds garble.")
print()


def show(title, hits, axis):
    print(f"=== {title} ({len(hits)}) ===")
    for h in hits:
        b, ch, vs = h["ref"]
        kind = "reorder" if h[("chip_reorder" if axis == "chip" else "prose_reorder")] else "WORDSET"
        tagstr = ("  [" + ",".join(h["tags"]) + "]") if h["tags"] else ""
        print(f"  {b} {ch}:{vs}  ({kind}, {h['nwords']}w){tagstr}")
        if axis == "chip":
            print(f"      printed: {h['printed']}")
            print(f"      chip   : {h['chip']}")
        else:
            print(f"      reading: {h['reading']}")
            print(f"      prose  : {h['prose']}")
    print()


show("GENUINE CHIP GARBLE — triage first (position vs printed order)", chip_clean, "chip")
if chip_tagged:
    show("CHIP mismatch w/ benign tag — verify before trusting", chip_tagged, "chip")
if SHOW_ALL and prose_hits:
    show("PROSE-only mismatches (greek_pos vs reading order)", prose_hits, "prose")

print("Next: triage the GENUINE CHIP list — these are brackets where _split_compounds")
print("fronting tangled the printed word order (the 1Ch 15:13 'the and LORD' class).")
print("Fix nothing from this script — report scope, then propose a targeted repair.")
