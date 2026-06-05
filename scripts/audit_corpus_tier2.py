#!/usr/bin/env python3
"""
audit_corpus_tier2.py — Full Corpus Audit, TIER 2 (external alignment).

READ-ONLY. Validates the DELIVERED corpus (bible.db `words`) against independent
witness texts — Rahlfs-1935 LXX (OT) and STEPBible TAGNT (NT) — by aligning each
verse position-wise (reusing scripts/lxx_align.py's Needleman–Wunsch aligner) and
diffing every word's Strong's number + Greek lemma vs its aligned reference token.

WHY (vs Tier 1): Tier 1 only checked that a word's four signals AGREE WITH EACH
OTHER — it is blind to an error that is internally consistent but still wrong.
Tier 2 checks against an OUTSIDE source, giving a near-verifiable verdict on the
two objective signals (Strong's number + lemma) the way nothing else can.

We audit the DB (post-pronoun-fix, lemmas populated), NOT the raw ABP .txt:
auditing the source would re-flag every pronoun the fix already corrected;
auditing the DB validates what users see and lets pronouns show as CONFIRMED.
Content-word numbers are identical either way.

OUTPUT = a ranked report. Disagreements are partitioned:
  (a) gloss-contradiction — ABP's own English contradicts a pronoun number → REAL
  (b) textual divergence  — systematic ABP↔reference pair (Vaticanus/Sixtine vs
      Rahlfs eclectic, or an ABP LXX number-reuse convention) → expected
  (c) alignment gap       — no aligned reference token → versification / plus-word
The partition is the whole trick: it separates "bug" from "legitimately different
text." English correctness is NOT judged here (no machine ground truth — Tier 3).

NO WRITES. bible.db opened mode=ro; reference files read-only.

Usage (PythonAnywhere — bible.db + refs are PA-only):
  cd ~/bible-db && python3 scripts/audit_corpus_tier2.py bible.db \
       --rahlfs ~/LXX-Rahlfs-1935 --tagnt ~/TAGNT_*.txt
  # optional: --book Gen      audit one book only
  #           --samples 8     sample refs per class (default 8)
  #           --systematic 5  min count for a mismatch-pair to be "convention" (default 5)
"""
import os
import sys
import glob
import unicodedata
import sqlite3
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lxx_align as L   # RahlfsLXX, TAGNTSource, align, base, _category, _EN_BUCKET, _CAT_BUCKET, _last_en_word

# ── NT book set (ABP abbrevs) — selects TAGNT vs Rahlfs per book ──────────────
NT_BOOKS = {
    "Mat", "Mar", "Luk", "Joh", "Act", "Rom", "1Co", "2Co", "Gal", "Eph",
    "Php", "Col", "1Th", "2Th", "1Ti", "2Ti", "Tit", "Phm", "Heb", "Jas",
    "1Pe", "2Pe", "1Jn", "2Jn", "3Jn", "Jud", "Rev",
}

# ── args ─────────────────────────────────────────────────────────────────────
ARGS = sys.argv[1:]


def _opt(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS and ARGS.index(name) + 1 < len(ARGS) else default


def _opt_list(name):
    if name not in ARGS:
        return []
    i, out = ARGS.index(name) + 1, []
    while i < len(ARGS) and not ARGS[i].startswith("--"):
        out.append(ARGS[i]); i += 1
    return out


DB = next((a for a in ARGS if not a.startswith("--") and a.endswith(".db")), "bible.db")
RAHLFS = _opt("--rahlfs")
TAGNT_GLOBS = _opt_list("--tagnt")
ONLY_BOOK = _opt("--book")
SAMPLES = int(_opt("--samples", "8"))
SYSTEMATIC = int(_opt("--systematic", "5"))

tagnt_paths = []
for g in TAGNT_GLOBS:
    tagnt_paths += glob.glob(os.path.expanduser(g))


# ── lemma normalisation + edit distance (same basis as Tier 1) ───────────────
def norm_lemma(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower().replace("ς", "σ").replace("ῳ", "ω").replace("ῃ", "η").replace("ᾳ", "α")
    return "".join(c for c in s if c.isalpha())


def edit_distance(a, b, cap=2):
    a, b = norm_lemma(a), norm_lemma(b)
    if a == b:
        return 0
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
        if min(prev) > cap:
            return cap + 1
    return prev[len(b)]


# ── load reference sources ───────────────────────────────────────────────────
print(f"\n=== FULL CORPUS AUDIT · TIER 2 (external alignment, read-only) ===")
print(f"    db={DB}  rahlfs={'yes' if RAHLFS else 'NO'}  "
      f"tagnt={len(tagnt_paths)} file(s)  book={ONLY_BOOK or 'ALL'}\n")

rx = nt = None
try:
    if RAHLFS:
        rx = L.RahlfsLXX(os.path.expanduser(RAHLFS))
except Exception as e:
    print(f"  !! Rahlfs load failed: {e}\n     (OT books will be skipped)")
try:
    if tagnt_paths:
        nt = L.TAGNTSource(tagnt_paths)
except Exception as e:
    print(f"  !! TAGNT load failed: {e}\n     (NT books will be skipped)")

if rx is None and nt is None:
    print("\n  No reference source loaded — pass --rahlfs and/or --tagnt. Aborting.\n")
    sys.exit(1)

# ── read DB (read-only), all words in (book, ch, vs, position) order ─────────
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
where = "WHERE v.book = ?" if ONLY_BOOK else ""
params = (ONLY_BOOK,) if ONLY_BOOK else ()
rows = conn.execute(
    f"""SELECT v.book AS book, v.chapter AS ch, v.verse AS vs, w.position AS pos,
               w.strongs_base AS sb, w.lemma AS lem, w.english AS eng,
               COALESCE(w.is_pn, 0) AS is_pn
        FROM words w JOIN verses v ON v.id = w.verse_id
        {where}
        ORDER BY v.book, v.chapter, v.verse, w.position""", params).fetchall()
conn.close()

# group consecutive rows into verses
verses = []
cur_key = None
cur_words = None
for r in rows:
    key = (r["book"], r["ch"], r["vs"])
    if key != cur_key:
        cur_words = []
        verses.append((key, cur_words))
        cur_key = key
    cur_words.append(r)

# ══════════════════════════════════════════════════════════════════════════════
# Align each verse to its reference, classify each ABP word.
# ══════════════════════════════════════════════════════════════════════════════
def fmt(b):
    """Format a Strong's base for display: H-numbers keep their H, bare = Greek."""
    return b if (b[:1] == "H") else "G" + b


def abp_gloss_bucket(eng, own_cat):
    """ABP English person-bucket for a slot, with reflexive/intensive neutralised
    against ABP's own number (a '-self' gloss never contradicts)."""
    gw = L._last_en_word(eng or "")
    eb = L._EN_BUCKET.get(gw)
    if gw.endswith("self") or gw.endswith("selves"):
        eb = L._CAT_BUCKET.get(own_cat)   # never flag intensive/reflexive
    return gw, eb


# per-book tallies (NON-PN content words only)
bk = defaultdict(lambda: dict(anchorable=0, confirmed=0, gap=0, nummis=0, lemmis=0, verses=0))
num_pairs = defaultdict(int)          # (abp_base, ref_base) -> count  (non-PN)
num_pair_refs = defaultdict(list)
lem_pairs = defaultdict(int)
lem_pair_refs = defaultdict(list)
internal_contra = []                  # (a) ABP gloss contradicts ABP's OWN number → REAL
pron_diverge = 0                      # pronoun slot: ABP self-consistent, reference differs → textual
skipped_books = defaultdict(int)
pn_blank = 0                          # '*'/blank abp slots (not audited)
unmatched_ref = 0
# proper-noun (is_pn / H-number) cross-numbering — different system, not comparable
pn_total = pn_match = pn_cross = 0
pn_pairs = defaultdict(int)
pn_pair_refs = defaultdict(list)


def ref_for(book):
    if book in NT_BOOKS:
        return (nt, nt.booknum(book)) if nt else (None, None)
    return (rx, rx.booknum(book)) if rx else (None, None)


for (book, ch, vs), words in verses:
    src, bnum = ref_for(book)
    if src is None or bnum is None:
        skipped_books[book] += len(words)
        continue
    ref_verse = src.verse(bnum, ch, vs)
    ref = f"{book} {ch}:{vs}"
    bk[book]["verses"] += 1
    if not ref_verse:
        unmatched_ref += 1
        for w in words:
            if (L.base(w["sb"]) or "") not in ("", "*"):
                bk[book]["gap"] += 1
        continue

    a_bases = [L.base(w["sb"]) for w in words]
    b = ref_verse
    b_bases = [t[0] for t in b]
    b_pron = [t[2] for t in b]
    pairs = L.align(a_bases, b_bases, b_pron)
    amap = {ai: bj for ai, bj in pairs if ai >= 0}

    for i, w in enumerate(words):
        ab = a_bases[i]
        if ab in ("", "*"):
            pn_blank += 1
            continue
        is_pn = bool(w["is_pn"]) or ab[:1] == "H"
        bj = amap.get(i, -1)
        rt = b[bj] if bj is not None and bj >= 0 else None

        # ── (a) ABP-INTERNAL check: does ABP's gloss contradict ABP's OWN number?
        # Independent of the reference — a genuine residual mis-tag (e.g. a G1473
        # slot glossed "him"/"it"). This is the class Tier 1 never checked.
        own_cat = L._category(ab)
        if own_cat != "?" and not is_pn:
            gw, eb = abp_gloss_bucket(w["eng"], own_cat)
            cb = L._CAT_BUCKET.get(own_cat)
            if eb is not None and cb is not None and eb != cb:
                internal_contra.append(
                    f"{ref}  abp={fmt(ab)}/{own_cat}({cb}) but gloss '{gw}'({eb})")

        # ── proper-noun H↔G cross-numbering: different numbering system ──
        if is_pn:
            if rt is not None and rt[0] != "":
                pn_total += 1
                if ab == rt[0]:
                    pn_match += 1
                else:
                    pn_cross += 1
                    key = (ab, rt[0])
                    pn_pairs[key] += 1
                    if len(pn_pair_refs[key]) < SAMPLES:
                        pn_pair_refs[key].append(f"{ref}  {fmt(ab)}→{fmt(rt[0])}({rt[3] or '?'})")
            continue

        # ── content-word alignment vs reference ──
        if rt is None or rt[0] == "":
            bk[book]["gap"] += 1
            continue
        bk[book]["anchorable"] += 1
        ref_base, ref_morph, ref_is_pron, ref_lemma = rt
        if ab == ref_base:
            bk[book]["confirmed"] += 1
            al, rl = w["lem"], ref_lemma
            if al and rl and norm_lemma(al) != norm_lemma(rl) and edit_distance(al, rl) > 2:
                bk[book]["lemmis"] += 1
                key = (al, rl)
                lem_pairs[key] += 1
                if len(lem_pair_refs[key]) < SAMPLES:
                    lem_pair_refs[key].append(f"{ref}  {fmt(ab)}")
            continue
        # number disagrees with reference
        bk[book]["nummis"] += 1
        key = (ab, ref_base)
        num_pairs[key] += 1
        if len(num_pair_refs[key]) < SAMPLES:
            num_pair_refs[key].append(
                f"{ref}  abp={fmt(ab)}({w['lem'] or '?'}) vs ref={fmt(ref_base)}({ref_lemma or '?'})")
        # pronoun slot where ABP is self-consistent but the reference text differs
        # = textual divergence (NOT an ABP error; the internal check above owns errors)
        if own_cat != "?" or L._category(ref_base) != "?":
            pron_diverge += 1

# ── totals ────────────────────────────────────────────────────────────────────
T_anchor = sum(b["anchorable"] for b in bk.values())
T_conf = sum(b["confirmed"] for b in bk.values())
T_gap = sum(b["gap"] for b in bk.values())
T_num = sum(b["nummis"] for b in bk.values())
T_lem = sum(b["lemmis"] for b in bk.values())

# partition number-mismatch pairs: systematic (convention/textual) vs one-off (suspect)
sys_pairs = {k: v for k, v in num_pairs.items() if v >= SYSTEMATIC}
one_pairs = {k: v for k, v in num_pairs.items() if v < SYSTEMATIC}
sys_rows = sum(sys_pairs.values())
one_rows = sum(one_pairs.values())

# ══════════════════════════════════════════════════════════════════════════════
# REPORT
# ══════════════════════════════════════════════════════════════════════════════
def pct(a, b):
    return f"{100*a/b:.2f}%" if b else "—"


print("┌─ HEADLINE: content-word Strong's agreement vs independent witness " + "─" * 6)
print(f"│  anchorable CONTENT words (aligned, non-PN): {T_anchor}")
print(f"│  CONFIRMED (abp number == reference): {T_conf}   = {pct(T_conf, T_anchor)}")
print(f"│  number-mismatch: {T_num}   lemma-mismatch (num agreed, lemma far): {T_lem}")
print(f"│  alignment gaps (no ref token): {T_gap}   |  '*'/blank slots skipped: {pn_blank}")
print(f"│  verses with NO reference verse (versification/scope): {unmatched_ref}")
print("├─ proper nouns audited SEPARATELY (ABP Hebrew# vs Rahlfs/TAGNT Greek#) " + "─" * 2)
print(f"│  is_pn/H-number slots aligned: {pn_total}   "
      f"H↔G cross-numbered (same name, expected): {pn_cross}   coincident G-match: {pn_match}")
print("└" + "─" * 72)

print("\n┌─ PER-BOOK agreement (sorted worst-first — low % = offset/divergence) " + "─" * 3)
print(f"│  {'book':<5} {'verses':>6} {'anchor':>7} {'confirm%':>9} {'gap':>6} {'numMis':>7} {'lemMis':>7}")
for book in sorted(bk, key=lambda b: (bk[b]["confirmed"] / bk[b]["anchorable"]) if bk[b]["anchorable"] else 1):
    d = bk[book]
    print(f"│  {book:<5} {d['verses']:>6} {d['anchorable']:>7} "
          f"{pct(d['confirmed'], d['anchorable']):>9} {d['gap']:>6} {d['nummis']:>7} {d['lemmis']:>7}")
print("└" + "─" * 72)

print(f"\n┌─ PN H↔G cross-numbering top pairs (ABP Hebrew# vs reference Greek#) " + "─" * 3)
print(f"│  {pn_cross} rows — same proper noun, two numbering systems. ALL EXPECTED (TIPNR).")
for (ab, rb), n in sorted(pn_pairs.items(), key=lambda kv: -kv[1])[:12]:
    ex = pn_pair_refs[(ab, rb)][0] if pn_pair_refs[(ab, rb)] else ""
    print(f"│   {fmt(ab)} → {fmt(rb)}  ×{n}    e.g. {ex}")
print("└" + "─" * 72)

print(f"\n┌─ (b) SYSTEMATIC content mismatch pairs (count ≥ {SYSTEMATIC}) — convention/textual " + "─" * 2)
print(f"│  {sys_rows} rows across {len(sys_pairs)} pairs. Recurring abp→ref = a same-word")
print(f"│  convention (τις/τίς, εἴδω/ὁράω) or a stable textual difference (κύριος/θεός).")
for (ab, rb), n in sorted(sys_pairs.items(), key=lambda kv: -kv[1])[:25]:
    ex = num_pair_refs[(ab, rb)][0] if num_pair_refs[(ab, rb)] else ""
    print(f"│   {fmt(ab)} → {fmt(rb)}  ×{n}    e.g. {ex}")
print("└" + "─" * 72)

print(f"\n┌─ (c)+SUSPECTS: ONE-OFF content mismatch pairs (count < {SYSTEMATIC}) " + "─" * 8)
print(f"│  {one_rows} rows across {len(one_pairs)} pairs. Scattered = local textual variant,")
print(f"│  alignment slip, OR a genuine one-off mis-tag — the human-review pile.")
shown = 0
for (ab, rb), n in sorted(one_pairs.items(), key=lambda kv: -kv[1]):
    if shown >= SAMPLES * 2:
        break
    ex = num_pair_refs[(ab, rb)][0] if num_pair_refs[(ab, rb)] else ""
    print(f"│   {fmt(ab)} → {fmt(rb)}  ×{n}    {ex}")
    shown += 1
print("└" + "─" * 72)

print("\n┌─ LEMMA-mismatch where the NUMBER agrees (edit>2) — possible lemma drift " + "─" * 1)
print(f"│  {T_lem} rows across {len(lem_pairs)} lemma-pairs (number confirmed, lexeme differs).")
for (al, rl), n in sorted(lem_pairs.items(), key=lambda kv: -kv[1])[:20]:
    ex = lem_pair_refs[(al, rl)][0] if lem_pair_refs[(al, rl)] else ""
    print(f"│   abp {al!r} vs ref {rl!r}  ×{n}    e.g. {ex}")
print("└" + "─" * 72)

print("\n┌─ (a) REAL-ERROR bucket: ABP gloss contradicts ABP's OWN pronoun number " + "─" * 1)
print(f"│  {len(internal_contra)} slot(s) — INTERNAL contradiction (e.g. a G1473 slot glossed")
print(f"│  'him'/'it'). Reference-independent → a genuine residual mis-tag. This is the")
print(f"│  real fixable class (Tier 1 never checked gloss-vs-number).")
for s in internal_contra[:40]:
    print(f"│   {s}")
print("├─ (informational) pronoun textual divergence (ABP self-consistent, ref differs) " + "─" * 1)
print(f"│  {pron_diverge} pronoun slots where ABP's number+gloss AGREE but the reference text")
print(f"│  reads a different pronoun → ABP↔Rahlfs/TAGNT textual variant, NOT an ABP error.")
print("└" + "─" * 72)

if skipped_books:
    print("\n┌─ NOT AUDITED (no reference source / scope) " + "─" * 28)
    for book, n in sorted(skipped_books.items(), key=lambda kv: -kv[1]):
        why = "no --tagnt" if book in NT_BOOKS else "no --rahlfs / unmapped"
        print(f"│   {book:<5} {n:>7} words   ({why})")
    print("└" + "─" * 72)

print(f"\nSUMMARY  content-word Strong's confirmed {pct(T_conf, T_anchor)} of {T_anchor} "
      f"vs reference.\n  (a) REAL internal-contradiction slots: {len(internal_contra)}.  "
      f"PN H↔G cross-numbered (expected): {pn_cross}.\n  Content convention/textual: "
      f"{sys_rows} systematic + {one_rows} one-off.  Pronoun divergence: {pron_diverge}.  "
      f"Gaps: {T_gap}.\n  Tier 3 (LLM English) only if the one-off suspect pile warrants it.\n")
