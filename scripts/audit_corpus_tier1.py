#!/usr/bin/env python3
"""
audit_corpus_tier1.py — Full Corpus Audit, TIER 1 (internal consistency only).

READ-ONLY. Opens bible.db with mode=ro and NEVER writes. Pure SQL + Python over
the ~624k `words` rows. No external files (that is Tier 2: Rahlfs/TAGNT alignment).

PRINCIPLE (from the αὐτός/G1473 saga): you cannot audit a corpus against itself,
but the FOUR independent signals on each word — Strong's number, Greek lemma,
morphology, and the English slot/order — must AGREE internally. Disagreement is a
real defect. The single Strong's↔lemma check below would have caught the original
αὐτός→ἐγώ corruption and the Dan 2:47 mismatch instantly.

Output = a RANKED report of defect CLASSES (counts + sample refs), partitioned so
known-OK noise (unpopulated lemma, LXX-only/dotted Strong's, proper-noun extended
numbers, supplied/italic English, accent-only lemma diffs, redistribution slots)
does not drown the signal. NO FIXES — triage happens after the numbers are in.

Usage (on PythonAnywhere — bible.db is PA-only):
  cd ~/bible-db && python3 scripts/audit_corpus_tier1.py bible.db
  # optional: --samples N  (sample refs per class, default 8)
  #           --dominance F (modal-POS threshold for Class B, default 0.90)

Companion to scripts/health_check.py (flat pass/fail). This is the exploratory,
ranked sibling; overlaps are labelled "[also in health_check]".
"""
import sqlite3
import sys
import unicodedata
from collections import defaultdict

# ── args ─────────────────────────────────────────────────────────────────────
ARGS = sys.argv[1:]
DB = next((a for a in ARGS if not a.startswith("--")), "bible.db")


def _opt(name, default, cast):
    if name in ARGS:
        i = ARGS.index(name)
        if i + 1 < len(ARGS):
            try:
                return cast(ARGS[i + 1])
            except Exception:
                pass
    return default


SAMPLES = _opt("--samples", 8, int)
DOMINANCE = _opt("--dominance", 0.90, float)

# ── read-only connection (cannot write even if it tried) ─────────────────────
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row


def cols(table):
    try:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    except Exception:
        return set()


WCOLS = cols("words")
HAS_LEMMA = "lemma" in WCOLS
HAS_MORPH = "morph" in WCOLS

# verses ref expression for samples
VCOLS = cols("verses")
if {"book", "chapter", "verse"} <= VCOLS:
    REF = "v.book || ' ' || v.chapter || ':' || v.verse"
else:
    REF = "'verse_id=' || v.id"


def sample_refs(where, params=(), n=SAMPLES, extra_cols=""):
    """Return up to n sample 'Book C:V' strings (+ optional extra columns) for a
    WHERE clause over words w (joined to verses v). Read-only."""
    sel = REF + (", " + extra_cols if extra_cols else "")
    sql = (f"SELECT {sel} FROM words w JOIN verses v ON v.id = w.verse_id "
           f"WHERE {where} LIMIT {int(n)}")
    try:
        rows = conn.execute(sql, params).fetchall()
    except Exception as e:
        return [f"(sample query failed: {str(e)[:60]})"]
    out = []
    for r in rows:
        if extra_cols:
            out.append(f"{r[0]}  [{' | '.join('' if r[i] is None else str(r[i]) for i in range(1, len(r)))}]")
        else:
            out.append(str(r[0]))
    return out


def scalar(sql, params=()):
    try:
        return conn.execute(sql, params).fetchone()[0]
    except Exception:
        return None


# ── morph → coarse POS family (mirrors decodeMorph in app.jsx) ────────────────
# CATSS (OT, dotted) and Robinson (NT, hyphen) use CONFLICTING letters, so the
# scheme is detected first (delimiter) exactly like the frontend. Pronoun
# sub-classes all collapse to PRON so αὐτός "pronoun vs demonstrative" never
# false-flags. Returns a coarse family or None when unmappable.
_CATSS = {"V": "VERB", "N": "NOUN", "A": "ADJ", "RA": "ART", "RP": "PRON",
          "RD": "PRON", "RR": "PRON", "RI": "PRON", "RX": "PRON", "C": "CONJ",
          "P": "PREP", "D": "ADV", "X": "PART", "M": "NUM", "I": "INTERJ"}
_ROB = {"V": "VERB", "N": "NOUN", "A": "ADJ", "T": "ART", "P": "PRON",
        "R": "PRON", "D": "PRON", "K": "PRON", "I": "PRON", "X": "PRON",
        "F": "PRON", "S": "PRON", "C": "PRON", "Q": "PRON", "CONJ": "CONJ",
        "PREP": "PREP", "ADV": "ADV", "PRT": "PART", "COND": "PART",
        "INJ": "INTERJ", "HEB": "OTHER", "ARAM": "OTHER"}


def coarse_pos(morph):
    if not morph:
        return None
    m = morph.strip()
    if "." in m:                       # CATSS (OT)
        return _CATSS.get(m.split(".", 1)[0])
    if "-" in m:                       # Robinson (NT)
        return _ROB.get(m.split("-", 1)[0])
    # bare POS token
    return _CATSS.get(m) if len(m) == 1 else _ROB.get(m)


# content vs non-content (for slot-integrity confidence)
CONTENT = {"VERB", "NOUN", "ADJ"}


# ── lemma normalisation (accent / final-sigma / case insensitive) ─────────────
def norm_lemma(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")  # strip accents
    s = s.lower().replace("ς", "σ")                     # final ς → σ
    s = s.replace("ῳ", "ω").replace("ῃ", "η").replace("ᾳ", "α")   # drop iota subscr.
    return "".join(c for c in s if c.isalpha())                   # drop punct/space


def share_root(a, b, frac=0.6, floor=4):
    """True if two normalised lemmas are the SAME word inflected/spelled
    differently (shared leading root) rather than genuinely different words.
    Catches γῆρας/γῆρος, διαλέγομαι/διαλέγω, διασώζω/διασῴζω; NOT σύ/ὑμῖν
    (suppletive — those are caught instead by the PRON-POS partition)."""
    a, b = norm_lemma(a), norm_lemma(b)
    if not a or not b:
        return False
    if a.startswith(b) or b.startswith(a):
        return True
    common = 0
    for ca, cb in zip(a, b):
        if ca != cb:
            break
        common += 1
    return common >= floor and common >= frac * min(len(a), len(b))


def edit_distance(a, b, cap=2):
    """Levenshtein on normalised lemmas, early-out above `cap`. Catches INTERNAL
    spelling variants share_root misses: ἄρσην/ἄῤῥην (σ/ρ), νοέω/νοιέω (ι-insert),
    χοῦς/χόος (contraction), ἔνατος/ἔννατος (νν). Distance >cap = genuinely
    different word (παρεμβάλλω/παρεκτός)."""
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


# ══════════════════════════════════════════════════════════════════════════════
# Collect findings.  Each finding: (tier, name, count, likelihood, rationale, samples)
# tier 0 = HIGH signal, 1 = MEDIUM, 2 = LOW/structural.  partition = known-OK notes.
# ══════════════════════════════════════════════════════════════════════════════
findings = []
partition = []


def add(tier, name, count, likelihood, rationale, samples):
    findings.append([tier, name, count or 0, likelihood, rationale, samples or []])


print(f"\n=== FULL CORPUS AUDIT · TIER 1 (internal consistency, read-only) ===")
print(f"    db={DB}  lemma_col={'yes' if HAS_LEMMA else 'MISSING'}  "
      f"morph_col={'yes' if HAS_MORPH else 'MISSING'}  samples/class={SAMPLES}\n")

total_g = scalar("SELECT count(*) FROM words WHERE strongs_base LIKE 'G%'")
total_all = scalar("SELECT count(*) FROM words")

# ── morph → coarse-POS aggregation per G-base (shared by Class A1 refine + B) ──
pos_counts = defaultdict(lambda: defaultdict(int))   # sb -> family -> n
modal_pos = {}                                       # sb -> dominant family
morph_unmappable = 0
if HAS_MORPH:
    for r in conn.execute(
            """SELECT strongs_base AS sb, morph, COUNT(*) AS n
               FROM words
               WHERE strongs_base LIKE 'G%' AND morph IS NOT NULL AND morph != ''
               GROUP BY strongs_base, morph"""):
        fam = coarse_pos(r["morph"])
        if fam is None:
            morph_unmappable += r["n"]
            continue
        pos_counts[r["sb"]][fam] += r["n"]
    for sb, fams in pos_counts.items():
        modal_pos[sb] = max(fams.items(), key=lambda kv: kv[1])[0]

# ──────────────────────────────────────────────────────────────────────────────
# CLASS A — Strong's ↔ lemma  (the headline check)
# For G-words, compare words.lemma against lexicon.lemma on
#   l.strongs = SUBSTR(strongs_base,2)  AND strongs_base LIKE 'G%'
# A1 normalized mismatch  = REAL (different word) → the αὐτός/ἐγώ class
# A2 raw≠ but normalized=  = cosmetic accent/form diff → PARTITIONED
# A3 same G-base, >1 distinct words.lemma = internal corruption signal
# Partitioned: lemma NULL (only ~78% populated), G-base absent from lexicon.
# ──────────────────────────────────────────────────────────────────────────────
if HAS_LEMMA:
    rows = conn.execute(
        """SELECT w.strongs_base AS sb, w.lemma AS wlem, l.lemma AS llem, COUNT(*) AS n
           FROM words w
           LEFT JOIN lexicon l ON l.strongs = SUBSTR(w.strongs_base, 2)
                              AND w.strongs_base LIKE 'G%'
           WHERE w.strongs_base LIKE 'G%'
           GROUP BY w.strongs_base, w.lemma, l.lemma""").fetchall()

    a1 = []          # (sb, wlem, llem, n) real mismatch
    a1_rows = 0
    a2_rows = 0      # cosmetic
    no_lex_rows = 0  # G-base not in lexicon (no ground truth)
    null_lem_rows = 0
    lemma_by_sb = defaultdict(set)

    for r in rows:
        sb, wlem, llem, n = r["sb"], r["wlem"], r["llem"], r["n"]
        if wlem:
            lemma_by_sb[sb].add(wlem)
        if not wlem:
            null_lem_rows += n
            continue
        if llem is None:
            no_lex_rows += n
            continue
        if norm_lemma(wlem) == norm_lemma(llem):
            if wlem != llem:
                a2_rows += n
        else:
            a1.append((sb, wlem, llem, n))
            a1_rows += n

    a1.sort(key=lambda t: -t[3])
    # ── REFINE: split the raw A1 mismatches into known-benign vs genuine ──
    # pron/art POS  → dictionary-lemma vs Strong's case-headword (σύ/ὑμῖν) → benign
    # shared root   → orthographic/declension variant (γῆρας/γῆρος)        → benign
    # else          → GENUINE different-root mismatch = the real defect class
    PRONART = {"PRON", "ART"}
    a1_pron_rows = a1_ortho_rows = a1_genuine_rows = a1_unkpos_rows = 0
    a1_genuine = []
    for sb, wlem, llem, n in a1:
        pos = modal_pos.get(sb)
        if pos in PRONART:
            a1_pron_rows += n
        elif share_root(wlem, llem) or edit_distance(wlem, llem) <= 2:
            a1_ortho_rows += n          # internal spelling/dialect/voice variant
        elif pos is None:
            a1_unkpos_rows += n
            a1_genuine.append((sb, wlem, llem, n, "?POS"))
        else:
            a1_genuine_rows += n
            a1_genuine.append((sb, wlem, llem, n, pos))

    a1_genuine.sort(key=lambda t: -t[3])
    a1_samples = []
    for sb, wlem, llem, n, pos in a1_genuine[:SAMPLES]:
        refs = sample_refs("w.strongs_base = ?", (sb,), n=1)
        ref = refs[0] if refs else "?"
        ed = edit_distance(wlem, llem, cap=9)
        a1_samples.append(f"{ref}  {sb} ({pos}, edit={ed}): words.lemma={wlem!r} vs lexicon={llem!r}  (×{n})")
    add(0, "A1 · GENUINE Strong's↔lemma mismatch (different root)", a1_genuine_rows + a1_unkpos_rows,
        "HIGH", f"raw A1={a1_rows} rows; after removing pron/art case-headwords "
                f"({a1_pron_rows}) + orthographic variants ({a1_ortho_rows}), residue "
                f"= {a1_genuine_rows} content-POS + {a1_unkpos_rows} no-morph. THIS is the αὐτός class",
        a1_samples or ["(none — no genuine different-root mismatches)"])
    partition.append(("A1-raw · pron/art lemma-vs-case-headword (σύ/ὑμῖν)", a1_pron_rows,
                      "dictionary lemma vs Strong's case-specific headword — by-design, not a defect"))
    partition.append(("A1-raw · orthographic/dialect/voice variant (shared root or edit≤2)", a1_ortho_rows,
                      "γῆρας/γῆρος, ἄρσην/ἄῤῥην, νοέω/νοιέω — same word, internal spelling variant"))

    # A3 — same G-base mapping to >1 distinct lemma in words
    a3 = {sb: lems for sb, lems in lemma_by_sb.items() if len(lems) > 1}
    a3_samples = []
    for sb in sorted(a3, key=lambda s: -len(a3[s]))[:SAMPLES]:
        a3_samples.append(f"{sb}: {sorted(a3[sb])}")
    add(0, "A3 · same Strong's, MULTIPLE distinct words.lemma", len(a3),
        "HIGH", "one G-number carrying inconsistent lemmas internally (distinct G-bases affected)",
        a3_samples)

    partition.append(("A2 · lemma diff is accent/form only (cosmetic)", a2_rows,
                      "ABP headword vs Strong's headword spelling; not a number error"))
    partition.append(("G-base has NO lexicon entry (no ground truth)", no_lex_rows,
                      "LXX-only / dotted-variant bases (e.g. G2321.1) — can't check, not a defect"))
    partition.append(("words.lemma unpopulated (NULL/'')", null_lem_rows,
                      f"morph+lemma ~78% populated by design; {null_lem_rows} G-rows have no lemma to check"))
else:
    add(0, "A · Strong's↔lemma", 0, "HIGH",
        "SKIPPED — words.lemma column missing (pre-rebuild-#6 DB?)", [])

# ──────────────────────────────────────────────────────────────────────────────
# CLASS B — Strong's ↔ morph POS consistency
# Per G-base, compute the MODAL coarse POS family. Flag rows whose POS differs
# from the mode ONLY when the mode is dominant (≥ DOMINANCE). A genuinely split
# G-base (homograph) is NOT flagged. A verb-number wearing a noun morph (or vice
# versa) in an otherwise-uniform G-base is the signal.
# ──────────────────────────────────────────────────────────────────────────────
if HAS_MORPH:
    unmappable = morph_unmappable           # reuse the hoisted aggregation
    b_flagged_bases = 0
    b_flagged_rows = 0
    b_detail = []   # (sb, mode_fam, mode_n, minority_fam, minority_n)
    for sb, fams in pos_counts.items():
        tot = sum(fams.values())
        if tot == 0 or len(fams) == 1:
            continue
        mode_fam, mode_n = max(fams.items(), key=lambda kv: kv[1])
        if mode_n / tot < DOMINANCE:
            continue   # genuinely split — homograph, not a defect
        for fam, nn in fams.items():
            if fam == mode_fam:
                continue
            b_flagged_bases += 1
            b_flagged_rows += nn
            b_detail.append((sb, mode_fam, mode_n, fam, nn))

    b_detail.sort(key=lambda t: -t[4])
    b_samples = []
    for sb, mfam, mn, ffam, nn in b_detail[:SAMPLES]:
        # find a sample morph string for the minority family
        ex = None
        for r in conn.execute(
                "SELECT morph FROM words WHERE strongs_base=? AND morph IS NOT NULL",
                (sb,)):
            if coarse_pos(r["morph"]) == ffam:
                ex = r["morph"]
                break
        refs = sample_refs("w.strongs_base=? AND w.morph=?", (sb, ex), n=1) if ex else []
        ref = refs[0] if refs else "?"
        b_samples.append(f"{ref}  {sb}: mostly {mfam}(×{mn}) but {nn}× {ffam} (morph {ex})")
    add(1, "B · Strong's↔morph POS disagreement", b_flagged_rows,
        "MED", f"rows whose morph-POS contradicts their G-base's dominant POS "
               f"(mode ≥{int(DOMINANCE*100)}%); {b_flagged_bases} G-bases affected",
        b_samples)
    if unmappable:
        partition.append(("morph strings that don't map to a POS family", unmappable,
                          "unrecognised/edge morph codes — decoder hides these too"))
else:
    add(1, "B · Strong's↔morph", 0, "MED",
        "SKIPPED — words.morph column missing (pre-rebuild-#6 DB?)", [])

# ──────────────────────────────────────────────────────────────────────────────
# CLASS C — slot integrity
# C1 real Strong's but EMPTY English, NON-bracket, non-italic → dropped gloss.
#    (bracketed empties = _split_compounds redistribution → PARTITIONED.)
#    High-confidence subset = those whose morph is a CONTENT POS (N/V/A).
# C2 English present but NO source word (strongs_base NULL/''), non-italic,
#    non-bracket, english contains a letter → orphan English.
# ──────────────────────────────────────────────────────────────────────────────
C1_BASE = ("(strongs_base LIKE 'G%' OR strongs_base LIKE 'H%') AND strongs_base != '*' "
           "AND (english IS NULL OR TRIM(english) = '') "
           "AND bracket_id IS NULL AND COALESCE(italic,0) = 0")
c1_total = scalar(f"SELECT count(*) FROM words WHERE {C1_BASE}") or 0
# refine to content-POS in Python (high-confidence). G1510 εἰμί (copula) is
# routinely left unglossed in ABP — partition it out so the genuine dropped-
# gloss residue (nouns/other verbs) is visible.
COPULA = "G1510"


def verse_render(verse_id, target_pos):
    """Full English of a verse (sibling words joined by position) + whether the
    target slot's lemma-gloss survives elsewhere. Tells render-blank from
    gloss-lives-in-head/sibling."""
    rows = conn.execute(
        "SELECT position, english, english_head FROM words WHERE verse_id=? ORDER BY position",
        (verse_id,)).fetchall()
    txt = " ".join((r["english"] or "·").strip() for r in rows if (r["english"] or "").strip())
    head = next((r["english_head"] for r in rows if r["position"] == target_pos), None)
    return txt[:90], head


c1_content_rows = 0           # content-POS, copula EXCLUDED = the real watch list
c1_copula_rows = 0           # content-POS but εἰμί = expected ellipsis
c1_has_head = 0              # of the residue, how many carry an english_head (renders!)
c1_by_sb = defaultdict(int)  # strongs_base -> count (top offenders)
c1_content_samples = []
if HAS_MORPH and c1_total:
    pulled = conn.execute(
        f"SELECT w.strongs_base AS sb, w.morph AS morph, w.english_head AS eh, "
        f"       w.verse_id AS vid, w.position AS pos, w.lemma AS lem, "
        f"       ({REF}) AS ref "
        f"FROM words w JOIN verses v ON v.id = w.verse_id "
        f"WHERE {C1_BASE} LIMIT 200000").fetchall()
    for r in pulled:
        if coarse_pos(r["morph"]) not in CONTENT:
            continue
        if r["sb"] == COPULA:
            c1_copula_rows += 1
            continue
        c1_content_rows += 1
        c1_by_sb[r["sb"]] += 1
        if (r["eh"] or "").strip():
            c1_has_head += 1
        if len(c1_content_samples) < SAMPLES:
            vtxt, head = verse_render(r["vid"], r["pos"])
            c1_content_samples.append(
                f"{r['ref']}  {r['sb']} ({r['lem'] or '?'}, head={head!r}): verse=\"{vtxt}\"")
top_c1 = sorted(c1_by_sb.items(), key=lambda kv: -kv[1])[:8]
top_str = ", ".join(f"{sb}×{n}" for sb, n in top_c1)
add(1, "C1 · real Strong's + EMPTY English, content-word, NON-copula (non-bracket)", c1_content_rows,
    "MED", f"empty `english` slot with a content morph. {c1_has_head} of {c1_content_rows} "
           f"carry an english_head (likely still render). Top G-bases: {top_str}. "
           f"(raw {c1_total} empty non-bracket slots; {c1_copula_rows} εἰμί copula excluded)",
    c1_content_samples)
partition.append(("C1 · εἰμί/G1510 copula, empty-gloss content slot", c1_copula_rows,
                  "Greek copula routinely unrendered in ABP — expected ellipsis, not a defect"))
partition.append(("C1 · residue that carries an english_head (renders anyway)", c1_has_head,
                  "empty `english` but english_head populated — word still displays; likely false positive"))

C2 = ("english GLOB '*[A-Za-z]*' "
      "AND (strongs_base IS NULL OR TRIM(strongs_base) = '') "
      "AND COALESCE(italic,0) = 0 AND bracket_id IS NULL")
c2_total = scalar(f"SELECT count(*) FROM words WHERE {C2}") or 0
add(1, "C2 · English with NO source word (non-italic, non-bracket)", c2_total,
    "MED", "alphabetic English token with no Strong's and not flagged italic/supplied → orphan gloss",
    sample_refs(C2, extra_cols="w.english, w.strongs_base"))

# ──────────────────────────────────────────────────────────────────────────────
# CLASS D — complex-bracket order garble (structural, lower confidence)
# greek_pos is an ABP reorder index meaningful ONLY within a bracket; within a
# bracket the non-null values should form a clean contiguous permutation. Flag
# brackets (≥3 words) where they are tangled: mixed null/non-null, duplicates,
# or gaps. Surfaces the Mat 25:37 / "it he" / "the and LORD" class.
# ──────────────────────────────────────────────────────────────────────────────
brk = conn.execute(
    """SELECT verse_id, bracket_id,
              COUNT(*)                       AS n,
              SUM(CASE WHEN greek_pos IS NULL THEN 1 ELSE 0 END) AS nulls,
              COUNT(DISTINCT greek_pos)      AS dnn,
              MIN(greek_pos) AS mn, MAX(greek_pos) AS mx
       FROM words
       WHERE bracket_id IS NOT NULL
       GROUP BY verse_id, bracket_id""").fetchall()

d_mixed = []      # some null, some not — tangled mapping
d_dupgap = []     # non-null values not a clean contiguous run
d_allnull = 0     # bracket with no ordering at all (≥3)
for r in brk:
    n, nulls, dnn, mn, mx = r["n"], r["nulls"], r["dnn"], r["mn"], r["mx"]
    if n < 3:
        continue
    nonnull = n - nulls
    if nulls == n:
        d_allnull += 1
        continue
    if 0 < nulls < n:
        d_mixed.append(r)
        continue
    # all non-null: clean iff distinct == count AND contiguous (offset-agnostic)
    if dnn != nonnull or (mx - mn + 1) != nonnull:
        d_dupgap.append(r)


def brk_sample(rowlist):
    out = []
    for r in rowlist[:SAMPLES]:
        ref = sample_refs("w.verse_id=? AND w.bracket_id=?",
                          (r["verse_id"], r["bracket_id"]), n=1)
        gp = conn.execute(
            "SELECT english, greek_pos FROM words WHERE verse_id=? AND bracket_id=? ORDER BY position",
            (r["verse_id"], r["bracket_id"])).fetchall()
        seq = " ".join(f"{(x['english'] or '∅')}:{x['greek_pos']}" for x in gp)
        out.append(f"{ref[0] if ref else '?'}  [{seq}]")
    return out


add(2, "D-mixed · bracket with MIXED null/non-null greek_pos (≥3 words)", len(d_mixed),
    "LOW", "some bracket words have a reorder index, siblings don't — tangled order mapping",
    brk_sample(d_mixed))
add(2, "D-dupgap · bracket greek_pos has DUPLICATES or GAPS (≥3 words)", len(d_dupgap),
    "LOW", "non-null reorder indices are not a clean contiguous permutation",
    brk_sample(d_dupgap))
partition.append(("bracket (≥3) with ALL greek_pos null", d_allnull,
                  "may be synthetic/redistribution brackets with no reorder — review only if D-mixed is high"))

# ── overlaps already covered by health_check.py (counts for completeness) ─────
hc_frag = scalar(
    """SELECT count(*) FROM (
         SELECT verse_id,bracket_id FROM words WHERE bracket_id IS NOT NULL
         GROUP BY verse_id,bracket_id
         HAVING (max(position)-min(position)+1)!=count(*))""")
hc_brk_nopos = scalar(
    """SELECT count(*) FROM words WHERE bracket_id IS NOT NULL
       AND greek_pos IS NULL AND english IS NOT NULL AND english!=''""")
partition.append(("[also in health_check] fragmented (non-contiguous) brackets", hc_frag,
                  "position-discontiguous bracket members"))
partition.append(("[also in health_check] bracketed words missing greek_pos (+gloss)", hc_brk_nopos,
                  "feeds D-mixed above"))

# ══════════════════════════════════════════════════════════════════════════════
# RANKED REPORT
# ══════════════════════════════════════════════════════════════════════════════
TIERNAME = {0: "HIGH-SIGNAL", 1: "MEDIUM", 2: "LOW / STRUCTURAL"}
findings.sort(key=lambda f: (f[0], -f[2]))

print(f"corpus: {total_all} word rows total, {total_g} Greek (G%) rows\n")
print("┌─ RANKED DEFECT CLASSES " + "─" * 50)
last_tier = None
for tier, name, count, like, rationale, samples in findings:
    if tier != last_tier:
        print(f"│\n│ ===== {TIERNAME[tier]} =====")
        last_tier = tier
    flag = "‼" if (tier == 0 and count > 0) else (" " if count == 0 else "•")
    print(f"│ {flag} [{like:>4}] {name}: {count}")
    print(f"│        ↳ {rationale}")
    for s in samples:
        print(f"│          · {s}")
    if count and not samples:
        print(f"│          · (no sample refs captured)")
print("└" + "─" * 72)

print("\n┌─ PARTITIONED / KNOWN-OK NOISE (counts only, NOT ranked as defects) " + "─" * 6)
for name, count, why in partition:
    print(f"│   {name}: {count}")
    print(f"│        ↳ {why}")
print("└" + "─" * 72)

high = sum(c for t, _, c, *_ in findings if t == 0)
med = sum(c for t, _, c, *_ in findings if t == 1)
low = sum(c for t, _, c, *_ in findings if t == 2)
print(f"\nSUMMARY  HIGH-signal rows/bases flagged: {high}   "
      f"MEDIUM: {med}   LOW/structural: {low}")
print("This is Tier 1 only (internal). Tier 2 = Rahlfs/TAGNT alignment; "
      "Tier 3 = LLM English pass. Triage before any fixes.\n")

conn.close()
