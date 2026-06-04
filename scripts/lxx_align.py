#!/usr/bin/env python3
"""
lxx_align.py — pronoun-aware alignment of ABP Strong's vs Rahlfs-1935 LXX.

WHY
  The BibleHub-ABP source mis-tags the personal/possessive pronouns
  σύ / σου / αὐτός / ὑμεῖς / ἡμεῖς all as Strong's G1473 (ἐγώ "I").
  This module fixes that by aligning each ABP word to the correctly-tagged
  Rahlfs-1935 LXX and reading the right Strong's number + morphology off it.

GUARANTEES (surgical — see project-pronoun-fix-path-c memory)
  * ONLY ABP words whose Strong's base == '1473' are ever changed.
  * A G1473 slot is corrected ONLY when it aligns to a Rahlfs token whose
    number is in the known pronoun set (αὐτός 846, σύ-, ὑμεῖς-, ἡμεῖς-, ἐγώ-
    family). ἡμεῖς is split for free because Rahlfs already distinguishes it.
  * Anything else (gap / non-pronoun / blank Rahlfs) is FLAGGED, never
    overwritten. The caller decides what to do with flags (review file).
  * Proper-noun '*' placeholders and all non-1473 numbers are left untouched.
  * Greek lemma is NOT consumed — Rahlfs carries the Strong's number directly,
    so no lemma→Strong's bridge is needed.

NO DATABASE ACCESS. Read-only over the Rahlfs data files.

Self-test (reproduces the Genesis measurement, ~94.7% resolved):
    python3 scripts/lxx_align.py --probe Gen \
        abp_texts/abp_ot_texts/abp_genesis.txt  /path/to/LXX-Rahlfs-1935
"""

import os
import re
import sys
from pathlib import Path

# ── pronoun identity sets (bare Strong's numbers) ──────────────────────────
EGO    = {"1473", "1700", "1698", "1691", "3165", "3427", "3450"}  # ἐγώ sing  (keep)
HEMEIS = {"2249", "2257", "2254", "2248"}                          # ἡμεῖς     (split)
SU     = {"4771", "4675", "4671", "4571", "4674"}                  # σύ family (fix)
HUMEIS = {"5210", "5216", "5213", "5209"}                          # ὑμεῖς fam (fix)
AUTOS  = {"846"}                                                   # αὐτός     (fix)
RESOLVE = EGO | HEMEIS | SU | HUMEIS | AUTOS   # G1473 may be corrected to one of these

# ── per-verse alignment-confidence guard ────────────────────────────────────
# A G1473 correction is trusted only if the verse's NON-pronoun anchor words
# matched Rahlfs — proof we sliced the RIGHT verse. Mis-versified chapters
# (LXX 1Ki 20<->21 swap, Jon 2 / Hos 2,12,14 / Exo 8,22 offsets…) align the
# WRONG Rahlfs verse → its pronoun slots are flagged 'low-confidence-verse'.
#
# OPERATING POINT (validated 2026-06-03, RATE=0.0/MIN=1): fire ONLY on positive
# evidence of a mis-slice — the verse HAD ≥1 content anchor and NONE matched.
# This catches truly-offset verses (≈0 anchors) without over-flagging clean
# books' short/divergent-but-correctly-sliced verses (RATE=0.50 reverted 7–12%
# of CORRECT live corrections back to a visible ἐγώ on Deu/2Sa/Ecc/Son/Mic).
# English-visible person errors are caught regardless by the gloss guard below,
# so MISMATCH stays 0. Residual: a morph-only (possessive) slot in an offset
# verse that shares one coincidental anchor — owned by the versification-bridge
# pass (Psa/Jer/Dan/Joe). Sweep via env: LXX_GUARD=0/1, LXX_GUARD_RATE/_MIN.
GUARD_ENABLED     = os.environ.get("LXX_GUARD", "1") != "0"
GUARD_MIN_RATE    = float(os.environ.get("LXX_GUARD_RATE", "0.0"))   # need >X·anchorable matched
GUARD_MIN_ANCHORS = int(os.environ.get("LXX_GUARD_MIN", "1"))        # need ≥N matched (else flag)

def _category(strong: str) -> str:
    if strong in AUTOS:  return "αὐτός"
    if strong in SU:     return "σύ"
    if strong in HUMEIS: return "ὑμεῖς"
    if strong in HEMEIS: return "ἡμεῖς"
    if strong in EGO:    return "ἐγώ"
    return "?"

_STRONGS_RE = re.compile(r"(G\*|G\d+(?:\.\d+)*)")

def base(s):
    """'G3077'->'3077'  'G654.1'->'654'  'G*'->'*'  ''/None->''  (strips CR/space)."""
    if not s:
        return ""
    s = re.sub(r"\s", "", s)
    s = s[1:] if s.startswith("G") else s
    s = s.split(".")[0]
    return s


# ── versification bridges: ABP book numbering → Rahlfs(LXX) numbering ───────
# Most OT books share Rahlfs's numbering. A few diverge and need a per-book map
# applied BEFORE the Rahlfs verse lookup. Psalms: ABP uses MT (Hebrew/English)
# numbering, Rahlfs uses LXX. Verified 2026-06-03 against Rahlfs psalm verse
# counts: LXX 9=39v=MT 9+10; LXX 113=26v=MT 114+115; LXX 114/115=MT 116;
# LXX 116=2v=MT 117; LXX 118=176v=MT 119; LXX 146/147=MT 147; +LXX 151.
# All boundaries EXACT except the MT 9/10 join inside LXX 9 (±1, absorbed by
# the NW aligner + per-verse guard). Add Jer/Dan/Joe maps here later.
def _psalm_mt_to_lxx(ch, vs):
    if ch <= 8:    return ch, vs                  # identical
    if ch == 9:    return 9, vs                   # LXX 9 = MT 9 (+ MT 10)
    if ch == 10:   return 9, 20 + vs              # MT 10 continues LXX 9 (after MT 9's 20v)
    if ch <= 113:  return ch - 1, vs              # MT 11..113 → LXX 10..112
    if ch == 114:  return 113, vs                 # LXX 113 = MT 114 (+ MT 115)
    if ch == 115:  return 113, 8 + vs             # MT 115 continues LXX 113 (after MT 114's 8v)
    if ch == 116:  return (114, vs) if vs <= 9 else (115, vs - 9)   # MT 116 → LXX 114+115
    if ch <= 146:  return ch - 1, vs              # MT 117..146 → LXX 116..145
    if ch == 147:  return (146, vs) if vs <= 11 else (147, vs - 11) # MT 147 → LXX 146+147
    return ch, vs                                 # MT 148..150 identical

def _joel_eng_to_lxx(ch, vs):
    # ABP Joel uses English/MT-English (3 ch, Joel 2 = 32v incl. the 2:28-32
    # "pour out my Spirit"); Rahlfs/LXX uses 4 ch. ABP 2:28-32 → LXX 3:1-5;
    # ABP 3 → LXX 4. ABP 1 and 2:1-27 unchanged. (Verified 2026-06-03: the
    # misaligned tail 2:28→3:21 ≈ 36% = the survey's 34% pre-bridge flag rate.)
    if ch == 2 and vs >= 28:  return 3, vs - 27    # ABP 2:28→LXX 3:1 … 2:32→3:5
    if ch == 3:               return 4, vs         # ABP 3 → LXX 4
    return ch, vs

_VERSIFICATION = {                                 # ABP booknum → (ch,vs) -> (ch,vs)
    19: _psalm_mt_to_lxx,                          # Psalms  MT → LXX
    29: _joel_eng_to_lxx,                          # Joel    Eng(3ch) → LXX(4ch)
}


# ── Rahlfs data (line-aligned parallel arrays, 623,693 words) ───────────────
class RahlfsLXX:
    """Loads Rahlfs-1935 once; serves per-verse (strong_base, morph, is_pron)."""

    # ABP book abbrev → Marvel-versification book number (the numbering used by
    # 12-Marvel.Bible/00-versification_original.csv: 1–39 protocanonical books in
    # standard English order, validated empirically by scripts/align_survey.pl —
    # NOT the deuterocanon-interleaved 001_verse_c_book.csv order).
    # SCOPE GATE: a book is corrected ONLY if it's listed here; any book NOT here
    # → booknum() None → its pronouns stay G1473 (no regression). ALL 39 OT books
    # now enabled (validated 2026-06-03 with both guards → MISMATCH 0 on every
    # book). Two needed versification bridges (see _VERSIFICATION): Psa 19 (MT→LXX)
    # and Joe 29 (Eng 3ch→LXX 4ch). Jer 24 and Dan 27 align DIRECTLY — their
    # survey flag% was LXX-vs-MT divergence (safe gaps), not misalignment, proven
    # by low/zero per-verse guard-flags (Jer 67, Dan 0). No NT here (separate pass).
    ABP_BOOKNUM = {
        "Gen": 1,  "Exo": 2,  "Lev": 3,  "Num": 4,  "Deu": 5,  "Jos": 6,
        "Jdg": 7,  "Rth": 8,  "1Sa": 9,  "2Sa": 10, "1Ki": 11, "2Ki": 12,
        "1Ch": 13, "2Ch": 14, "Ezr": 15, "Neh": 16, "Est": 17, "Job": 18,
        "Psa": 19, "Pro": 20, "Ecc": 21, "Son": 22, "Isa": 23, "Jer": 24,
        "Lam": 25, "Eze": 26, "Dan": 27, "Hos": 28, "Joe": 29, "Amo": 30,
        "Oba": 31, "Jon": 32, "Mic": 33, "Nah": 34, "Hab": 35, "Zep": 36,
        "Hag": 37, "Zec": 38, "Mal": 39,
    }

    def __init__(self, rahlfs_dir):
        self.dir = Path(rahlfs_dir)
        self._strong = self._load_col("07_StrongNumber/final_Strongs.csv", 1)
        self._morph  = self._load_col("03a_morphology_with_JTauber_patches/patched_623693.csv", 1)
        self._ranges = self._load_verse_ranges()   # (booknum,ch,vs) -> (start,end) inclusive

    def _open(self, rel):
        return open(self.dir / rel, encoding="utf-8-sig", errors="replace")

    def _load_col(self, rel, col):
        arr = {}
        with self._open(rel) as f:
            for line in f:
                p = line.rstrip("\n").rstrip("\r").split("\t")
                if p and p[0].isdigit():
                    v = p[col] if len(p) > col else ""
                    arr[int(p[0])] = v.replace("\r", "")
        return arr

    def _load_verse_ranges(self):
        ents = []  # (wordidx, booknum, ch, vs) in file order
        with self._open("12-Marvel.Bible/00-versification_original.csv") as f:
            for line in f:
                p = line.rstrip("\n").rstrip("\r").split("\t")
                if len(p) < 2:
                    continue
                ref = p[1].lstrip("†")  # strip leading dagger †
                m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", ref)
                if not m or not p[0].isdigit():
                    continue
                ents.append((int(p[0]), int(m.group(1)), int(m.group(2)), int(m.group(3))))
        ranges = {}
        for i, (idx, b, c, v) in enumerate(ents):
            end = ents[i + 1][0] - 1 if i + 1 < len(ents) else idx
            ranges[(b, c, v)] = (idx, end)
        return ranges

    def booknum(self, abp_abbrev):
        return self.ABP_BOOKNUM.get(abp_abbrev)

    def verse(self, booknum, chapter, vs):
        """Return list of (strong_base, morph, is_pron) for the verse, or []."""
        remap = _VERSIFICATION.get(booknum)        # versification bridge (e.g. Psalms MT→LXX)
        if remap:
            chapter, vs = remap(chapter, vs)
        rng = self._ranges.get((booknum, chapter, vs))
        if not rng:
            return []
        out = []
        for i in range(rng[0], rng[1] + 1):
            mo = self._morph.get(i, "")
            is_pron = bool(re.match(r"^R(?!A)", mo))     # RP/RD/RR/RI  (exclude RA article)
            out.append((base(self._strong.get(i, "")), mo, is_pron))
        return out


# ── TAGNT (STEPBible) New-Testament source ──────────────────────────────────
# STEPBible "Translators Amalgamated Greek NT" (CC-BY 4.0). Tab-separated; the
# two fields we use are:
#   field 1: 'Jhn.1.1#01=NKO'              → book.ch.vs # word = editions
#   field 4: '<dStrong>=<RobinsonMorph>'   e.g. 'G0846=P-GSM', 'G3056=N-NSM'
#
# CRITICAL difference from Rahlfs: TAGNT's dStrong is LEMMA-collapsed for the
# personal pronouns — σύ AND ὑμεῖς both = G4771, and ALL 1st-person obliques +
# 1st PLURAL = G3165 — with the case/person/number living in the morph. Reading
# the raw number would tag σου as G4771 (not G4675) and ἡμεῖς as G3165 (a 1st-
# SINGULAR number → "me"), contradicting the OT fix + the app's lexicon (both
# use the case-split Strong's: σου=G4675, ὑμῶν=G5216, ἡμεῖς=G2249…). So verse()
# CONVERTS (lemma#, morph) → the same case-split numbers the OT produced; αὐτός
# is G846 across cases in BOTH schemes and passes straight through. After the
# conversion, correct_verse + both guards + the identity sets work UNCHANGED —
# this class fully absorbs the TAGNT quirk.

# ABP NT abbrev → TAGNT (OSIS) abbrev. Identical for 25 of 27 books; only Mark
# (Mar→Mrk) and John (Joh→Jhn) differ (verified vs the ABP NT txt prefixes).
_ABP_TO_TAGNT = {
    "Mat":"Mat", "Mar":"Mrk", "Luk":"Luk", "Joh":"Jhn", "Act":"Act", "Rom":"Rom",
    "1Co":"1Co", "2Co":"2Co", "Gal":"Gal", "Eph":"Eph", "Php":"Php", "Col":"Col",
    "1Th":"1Th", "2Th":"2Th", "1Ti":"1Ti", "2Ti":"2Ti", "Tit":"Tit", "Phm":"Phm",
    "Heb":"Heb", "Jas":"Jas", "1Pe":"1Pe", "2Pe":"2Pe", "1Jn":"1Jn", "2Jn":"2Jn",
    "3Jn":"3Jn", "Jud":"Jud", "Rev":"Rev",
}

# (person, case, number) → case-split Strong's (the OT-fix convention). αὐτός is
# handled separately (G846, never case-split). Vocative is folded into nominative.
_PRON_CASESPLIT = {
    ("2","N","S"):"4771", ("2","G","S"):"4675", ("2","D","S"):"4671", ("2","A","S"):"4571",  # σύ
    ("2","N","P"):"5210", ("2","G","P"):"5216", ("2","D","P"):"5213", ("2","A","P"):"5209",  # ὑμεῖς
    ("1","N","S"):"1473", ("1","G","S"):"3450", ("1","D","S"):"3427", ("1","A","S"):"3165",  # ἐγώ  (keep)
    ("1","N","P"):"2249", ("1","G","P"):"2257", ("1","D","P"):"2254", ("1","A","P"):"2248",  # ἡμεῖς (split)
}
# Person-augmented PERSONAL pronoun morph only: P-1GS, P-2NP… Reflexive (F-) and
# possessive (S-) are NOT converted — they own distinct Strong's (σεαυτοῦ G4572,
# ἑαυτοῦ G1438, ἐμός G1699…) and must not be remapped onto the personal numbers;
# they pass through on their own dStrong (→ flagged, never mis-fixed). 3rd-person
# αὐτός is 'P-GSM' (no person digit) and is handled by the G846 short-circuit.
_TAGNT_PRON_RE = re.compile(r"^P-([12])([NVGDA])([SP])")

def _tagnt_casesplit(dbase, morph):
    """TAGNT lemma-collapsed dStrong + morph → case-split Strong's (bare).
    αὐτός→846; a person-augmented personal pronoun → looked up by (person, case,
    number); anything else passes through on its own number so NW anchoring still
    works and non-target pronouns flag rather than mis-fix."""
    if dbase == "846":
        return "846"
    m = _TAGNT_PRON_RE.match(morph or "")
    if not m:
        return dbase
    person, case, num = m.group(1), m.group(2), m.group(3)
    if case == "V":
        case = "N"
    return _PRON_CASESPLIT.get((person, case, num), dbase)

def _tagnt_is_pron(morph):
    """Personal/reflexive/possessive pronoun — the classes ABP's mis-tagged
    G1473 can legitimately align to (for the NW pronoun-aware scoring). Excludes
    the article (T-), demonstratives (D-), relatives (R-), and PREP (the '-'
    check rejects 'PREP' despite its leading P)."""
    return bool(morph) and morph[0] in "PFS" and morph[1:2] == "-"


class TAGNTSource:
    """STEPBible TAGNT NT — mirrors RahlfsLXX's interface for correct_verse.
    booknum(abp_abbrev) returns the TAGNT book abbrev (str) or None (scope gate);
    verse() returns [(strong_base_casesplit, morph, is_pron), …] in text order."""

    _REF_RE = re.compile(r"^([0-9A-Za-z]+)\.(\d+)\.(\d+)#")
    _F4_RE  = re.compile(r"^(G\d+)=([A-Za-z0-9-]+)")   # first 'G####=MORPH' (ignores '+ G..' crasis tail)

    # SCOPE GATE (correction): only books here are corrected at build time.
    # All 27 NT books enabled 2026-06-04 after the full-NT --dump-nt survey:
    # MISMATCH 0 and guard-flagged 0 on every book, ~11,066 corrections.
    # (--dump-nt bypasses this via _ABP_TO_TAGNT so any book can be inspected.)
    SCOPE = {"Mat", "Mar", "Luk", "Joh", "Act", "Rom", "1Co", "2Co", "Gal",
             "Eph", "Php", "Col", "1Th", "2Th", "1Ti", "2Ti", "Tit", "Phm",
             "Heb", "Jas", "1Pe", "2Pe", "1Jn", "2Jn", "3Jn", "Jud", "Rev"}

    def __init__(self, tagnt_paths):
        self._verses = {}        # (tagnt_book, ch, vs) -> [(strong, morph, is_pron)]
        for p in tagnt_paths:
            self._load(p)

    def _load(self, path):
        with open(path, encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                if not line or line[0] in "#\r\n":          # legend + verse-comment headers
                    continue
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 4:
                    continue
                mref = self._REF_RE.match(parts[0])
                if not mref:
                    continue
                mf4 = self._F4_RE.match(parts[3].strip())
                if not mf4:
                    continue
                dbase = base(mf4.group(1)).lstrip("0") or "0"   # 'G0846' -> '846'
                morph = mf4.group(2)
                self._verses.setdefault(
                    (mref.group(1), int(mref.group(2)), int(mref.group(3))), []
                ).append((_tagnt_casesplit(dbase, morph), morph, _tagnt_is_pron(morph)))

    def booknum(self, abp_abbrev):
        if abp_abbrev not in self.SCOPE:
            return None
        return _ABP_TO_TAGNT.get(abp_abbrev)

    def verse(self, tagnt_book, chapter, vs):
        return self._verses.get((tagnt_book, chapter, vs), [])


# ── pronoun-aware Needleman–Wunsch global alignment ─────────────────────────
def align(a_bases, b_bases, b_pron, MATCH=3, MIS=-1, GAP=-2):
    """
    Align two Strong's-base sequences. Returns list of (ai, bj) pairs with -1
    sentinels for gaps. Pronoun-aware: an ABP '1473' token scores as a MATCH
    against any Rahlfs pronoun (b_pron[j] True) so the alignment doesn't drift
    around the deliberately-different pronoun numbers.
    """
    n, m = len(a_bases), len(b_bases)
    D = [[0] * (m + 1) for _ in range(n + 1)]
    T = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        D[i][0] = i * GAP; T[i][0] = 1          # 1 = up (gap in B)
    for j in range(1, m + 1):
        D[0][j] = j * GAP; T[0][j] = 2          # 2 = left (gap in A)
    for i in range(1, n + 1):
        ai = a_bases[i - 1]
        for j in range(1, m + 1):
            bj = b_bases[j - 1]
            eq = (ai not in ("", "*") and ai == bj) or (ai == "1473" and b_pron[j - 1])
            diag = D[i - 1][j - 1] + (MATCH if eq else MIS)
            up   = D[i - 1][j] + GAP
            lf   = D[i][j - 1] + GAP
            if diag >= up and diag >= lf:
                D[i][j] = diag; T[i][j] = 0      # 0 = diagonal
            elif up >= lf:
                D[i][j] = up; T[i][j] = 1
            else:
                D[i][j] = lf; T[i][j] = 2
    pairs = []
    i, j = n, m
    while i > 0 or j > 0:
        t = T[i][j]
        if t == 0:
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif t == 1:
            pairs.append((i - 1, -1)); i -= 1
        else:
            pairs.append((-1, j - 1)); j -= 1
    pairs.reverse()
    return pairs


# ── per-verse correction ────────────────────────────────────────────────────
class Correction:
    __slots__ = ("action", "new_strong", "morph", "reason")
    def __init__(self, action, new_strong=None, morph=None, reason=""):
        self.action = action          # 'fix' | 'keep' | 'flag' | 'none'
        self.new_strong = new_strong  # bare, e.g. '846' (caller re-applies 'G')
        self.morph = morph
        self.reason = reason

def correct_verse(abp_strongs_raw, rahlfs_verse, glosses=None):
    """
    abp_strongs_raw : list of ABP raw Strong's per word, in ABP source order
                      (e.g. 'G1473', 'G3077', 'G*', None).
    rahlfs_verse    : output of RahlfsLXX.verse() — [(strong, morph, is_pron), ...]
    glosses         : optional ABP English gloss per word (same order). When
                      given (and the guard is on), a correction is REFUSED and
                      flagged if its person contradicts ABP's own gloss — ABP is
                      the primary text, so we never write a number ABP disagrees
                      with (kills the η/υ and local-shift mistags). None → skip.
    Returns a list of Correction objects, one per ABP word, same order.

      action 'fix'  : was G1473, aligned to a known Rahlfs pronoun → new_strong+morph
      action 'keep' : was G1473, genuinely ἐγώ (Rahlfs also 1473) → new_strong=1473
      action 'flag' : was G1473 but no confident pronoun match → review (unchanged)
      action 'none' : not a G1473 slot (morph attached if Strong's anchor-matched)
    """
    a_bases = [base(s) for s in abp_strongs_raw]
    b_bases = [t[0] for t in rahlfs_verse]
    b_pron  = [t[2] for t in rahlfs_verse]

    # ABP's OWN English gloss → person bucket per slot (None = no clear cue).
    # Used below to refuse any correction that contradicts ABP's reading.
    # (_gloss_buckets / _EN_BUCKET / _CAT_BUCKET are module-level, defined below;
    # resolved at call time.) Disabled wholesale when the guard is off.
    gloss_buckets = (_gloss_buckets(glosses)
                     if (glosses is not None and GUARD_ENABLED) else None)

    # No Rahlfs data → flag every pronoun slot, leave everything else.
    if not rahlfs_verse:
        return [Correction("flag", reason="no-rahlfs-verse") if b == "1473"
                else Correction("none") for b in a_bases]

    pairs = align(a_bases, b_bases, b_pron)
    amap = {}
    for ai, bj in pairs:
        if ai >= 0:
            amap[ai] = bj

    # ── per-verse confidence: did we slice the RIGHT Rahlfs verse? ──────────
    # Count non-pronoun ABP anchors that match Rahlfs in their aligned slot.
    # Low match-rate ⇒ wrong verse sliced (versification offset) ⇒ don't trust
    # ANY pronoun correction here. anchorable==0 (pure-pronoun verse) → no
    # evidence either way → keep prior behavior (rare; a guard can't help).
    anchorable = matched = 0
    for i, ab in enumerate(a_bases):
        if ab in ("", "*", "1473"):
            continue
        bj = amap.get(i, -1)
        if bj is None or bj < 0:
            continue
        anchorable += 1
        if rahlfs_verse[bj][0] == ab:
            matched += 1
    confident = (not GUARD_ENABLED) or (anchorable == 0) or (
        matched >= GUARD_MIN_ANCHORS and matched >= GUARD_MIN_RATE * anchorable
    )

    out = []
    for i, ab in enumerate(a_bases):
        bj = amap.get(i, -1)
        rt = rahlfs_verse[bj] if bj is not None and bj >= 0 else None
        if ab == "1473":
            if not confident:
                # Mis-sliced verse: leave as G1473, log for the versification pass.
                out.append(Correction("flag", reason="low-confidence-verse"))
            elif rt and rt[0] in RESOLVE:
                cat = _category(rt[0])
                gb = gloss_buckets[i] if gloss_buckets is not None else None
                if gb is not None and gb != _CAT_BUCKET.get(cat):
                    # ABP's gloss is a clear pronoun of a DIFFERENT person than
                    # the aligned number (gloss 'me'/1S vs αὐτός/3P; η/υ ἡμεῖς↔
                    # ὑμεῖς plural variants; local person-shifts). Defer to ABP:
                    # leave G1473, log for review — never write a contested number.
                    out.append(Correction("flag",
                                          reason=f"gloss-mismatch:{gb}!={_CAT_BUCKET.get(cat)}"))
                else:
                    act = "keep" if rt[0] in EGO else "fix"
                    out.append(Correction(act, new_strong=rt[0], morph=rt[1], reason=cat))
            else:
                why = "gap" if rt is None else ("blank" if rt[0] == "" else f"non-pron:{rt[0]}")
                out.append(Correction("flag", reason=why))
        else:
            # bonus: attach morph only where the Strong's anchor-matches (safe)
            morph = rt[1] if (rt and ab not in ("", "*") and rt[0] == ab) else None
            out.append(Correction("none", morph=morph))
    return out


# ── self-test / probe (no DB) ───────────────────────────────────────────────
def _probe(abp_abbrev, abp_txt, rahlfs_dir):
    rx = RahlfsLXX(rahlfs_dir)
    bnum = rx.booknum(abp_abbrev)
    if not bnum:
        print(f"No Rahlfs book mapping for {abp_abbrev}"); return

    verse_re = re.compile(r"^\((\w+)\s+(\d+):(\d+)\)\s+(.*)")
    cats = {"αὐτός": 0, "σύ": 0, "ὑμεῖς": 0, "ἡμεῖς": 0, "ἐγώ": 0}
    n1473 = flag = 0
    flag_reasons = {}
    for line in open(abp_txt, encoding="utf-8", errors="replace"):
        m = verse_re.match(line.strip())
        if not m or m.group(1) != abp_abbrev:
            continue
        ch, vs = int(m.group(2)), int(m.group(3))
        abp_raw = _STRONGS_RE.findall(m.group(4))
        corrs = correct_verse(abp_raw, rx.verse(bnum, ch, vs), _verse_glosses(m.group(4)))
        for c in corrs:
            if c.action in ("fix", "keep"):
                n1473 += 1; cats[c.reason] = cats.get(c.reason, 0) + 1
            elif c.action == "flag":
                n1473 += 1; flag += 1
                flag_reasons[c.reason.split(":")[0]] = flag_reasons.get(c.reason.split(":")[0], 0) + 1
    resolved = n1473 - flag
    print(f"\n══ lxx_align self-probe: {abp_abbrev} ══")
    print(f"  total ABP G1473 slots : {n1473}")
    for k in ("αὐτός", "σύ", "ὑμεῖς", "ἡμεῖς", "ἐγώ"):
        print(f"    → {k:<6} : {cats.get(k,0)}")
    print(f"    → FLAG  : {flag}  {dict(sorted(flag_reasons.items(), key=lambda x:-x[1]))}")
    print(f"  RESOLVED : {resolved}/{n1473} = {100*resolved/(n1473 or 1):.1f}%")
    print("  (expect ~94.7% on Genesis — matches the validated Perl probe)")


# ── per-verse correction dump (no DB) — borderline-book spot-check ──────────
# INSPECTION-ONLY book map: ALL 39 protocanonical ABP books → Marvel booknum.
# This is deliberately NOT the correction scope gate (ABP_BOOKNUM, smaller).
# --dump uses it so we can eyeball a book's corrections BEFORE deciding whether
# to add it to ABP_BOOKNUM. Adding a book here changes NOTHING about the build.
_FULL_BOOKNUM = {
    "Gen": 1,  "Exo": 2,  "Lev": 3,  "Num": 4,  "Deu": 5,  "Jos": 6,
    "Jdg": 7,  "Rth": 8,  "1Sa": 9,  "2Sa": 10, "1Ki": 11, "2Ki": 12,
    "1Ch": 13, "2Ch": 14, "Ezr": 15, "Neh": 16, "Est": 17, "Job": 18,
    "Psa": 19, "Pro": 20, "Ecc": 21, "Son": 22, "Isa": 23, "Jer": 24,
    "Lam": 25, "Eze": 26, "Dan": 27, "Hos": 28, "Joe": 29, "Amo": 30,
    "Oba": 31, "Jon": 32, "Mic": 33, "Nah": 34, "Hab": 35, "Zep": 36,
    "Hag": 37, "Zec": 38, "Mal": 39,
}

# English pronoun → person/number bucket, used to cross-check the alignment.
# σύ (sing) + ὑμεῖς (plur) both surface as English "you/your" → same 2P bucket
# (the aligner picks sing-vs-plur from Rahlfs morph, which English can't show);
# a 2P-vs-2P sing/plur slip is harmless, only cross-PERSON slips are dangerous.
_EN_BUCKET = {}
for _w in "i me my mine".split():                              _EN_BUCKET[_w] = "1S"
for _w in "we us our ours".split():                            _EN_BUCKET[_w] = "1P"
for _w in "you your yours thee thy thine thou ye".split():     _EN_BUCKET[_w] = "2P"
for _w in "him his he it its them their theirs they she her hers".split(): _EN_BUCKET[_w] = "3P"
_CAT_BUCKET = {"ἐγώ": "1S", "ἡμεῖς": "1P", "σύ": "2P", "ὑμεῖς": "2P", "αὐτός": "3P"}

def _last_en_word(chunk):
    """Last alphabetic word of a gloss chunk, lowercased ('' if none). ABP
    bracket digits/markers are ignored, e.g. '1his servants]' → 'servants'.
    (A possessive often rides on the NOUN's gloss, leaving the G1473 slot blank
    → no cue here → the caller falls back to morph.)"""
    words = re.findall(r"[A-Za-z]+", chunk or "")
    return words[-1].lower() if words else ""

def _verse_glosses(text):
    """English-gloss chunks parallel to _STRONGS_RE.findall(text): chunk[i]
    is the text immediately preceding gnum[i]."""
    return _STRONGS_RE.split(text)[0::2]

def _gloss_buckets(glosses):
    """Per-slot ABP-English person bucket (1S/1P/2P/3P) or None for no clear
    cue. '-self'/'-selves' → None: αὐτός used intensively ('you yourself') is
    valid with any person, so reflexive forms must not constrain the number."""
    out = []
    for g in glosses:
        w = _last_en_word(g)
        out.append(None if (w.endswith("self") or w.endswith("selves"))
                   else _EN_BUCKET.get(w))
    return out

def _dump(abp_abbrev, abp_txt, rahlfs_dir, sample=12):
    bnum = _FULL_BOOKNUM.get(abp_abbrev)
    if not bnum:
        print(f"No booknum for {abp_abbrev}"); return
    rx = RahlfsLXX(rahlfs_dir)
    verse_re = re.compile(r"^\((\w+)\s+(\d+):(\d+)\)\s+(.*)")
    mism = []           # (ref, gloss_word, cat, morph, en_bucket, cat_bucket)
    okeng = {}          # cat -> [(ref, gloss_word, morph)]
    morph_only = fixes = guard_flags = gloss_flags = 0
    for line in open(abp_txt, encoding="utf-8", errors="replace"):
        m = verse_re.match(line.strip())
        if not m or m.group(1) != abp_abbrev:
            continue
        ch, vs = int(m.group(2)), int(m.group(3))
        text = m.group(4)
        abp_raw = _STRONGS_RE.findall(text)
        glosses = _verse_glosses(text)
        corrs = correct_verse(abp_raw, rx.verse(bnum, ch, vs), glosses)
        ref = f"{abp_abbrev} {ch}:{vs}"
        for i, c in enumerate(corrs):
            if c.action == "flag" and c.reason == "low-confidence-verse":
                guard_flags += 1
                continue
            if c.action == "flag" and c.reason.startswith("gloss-mismatch"):
                gloss_flags += 1
                continue
            if c.action not in ("fix", "keep"):
                continue
            fixes += 1
            cat = c.reason                       # αὐτός / σύ / ὑμεῖς / ἡμεῖς / ἐγώ
            gword = _last_en_word(glosses[i] if i < len(glosses) else "")
            ebkt = _EN_BUCKET.get(gword)
            cbkt = _CAT_BUCKET.get(cat)
            if gword.endswith("self") or gword.endswith("selves"):
                ebkt = cbkt                      # intensive/reflexive: never flag
            if ebkt is None:
                morph_only += 1                  # blank/non-pronoun gloss → rely on morph
            elif ebkt == cbkt:
                okeng.setdefault(cat, []).append((ref, gword, c.morph))
            else:
                mism.append((ref, gword, cat, c.morph, ebkt, cbkt))
    print(f"\n══ lxx_align --dump: {abp_abbrev} (book {bnum})  guard={'on' if GUARD_ENABLED else 'OFF'} ══")
    print(f"  corrected (fix+keep) slots : {fixes}")
    print(f"  guard-flagged (low-conf)   : {guard_flags}")
    print(f"  gloss-flagged (person≠ABP) : {gloss_flags}")
    print(f"  English gloss CONFIRMS     : {sum(len(v) for v in okeng.values())}")
    print(f"  no English cue (morph only): {morph_only}")
    print(f"  *** MISMATCH (should be 0) : {len(mism)} ***")
    if mism:
        print("\n  ── MISMATCHES (english gloss contradicts assigned number) ──")
        for ref, gw, cat, mo, eb, cb in mism[:80]:
            print(f"    {ref:<12} gloss '{gw}' ({eb}) → assigned {cat} ({cb})  morph={mo}")
    print("\n  ── sample CONFIRMED corrections (english agrees with number) ──")
    for cat in ("αὐτός", "σύ", "ὑμεῖς", "ἡμεῖς", "ἐγώ"):
        rows = okeng.get(cat, [])
        if not rows:
            continue
        print(f"   {cat} ({len(rows)}):")
        for ref, gw, mo in rows[:sample]:
            print(f"     {ref:<12} '{gw}'  morph={mo}")


# ── NT (TAGNT) probe / dump — same logic as the OT ones, TAGNT source ────────
def _probe_nt(abp_abbrev, abp_txt, tagnt_paths):
    src  = TAGNTSource(tagnt_paths)
    bnum = _ABP_TO_TAGNT.get(abp_abbrev)        # inspection: bypass SCOPE gate
    if not bnum:
        print(f"No TAGNT book mapping for {abp_abbrev}"); return

    verse_re = re.compile(r"^\((\w+)\s+(\d+):(\d+)\)\s+(.*)")
    cats = {"αὐτός": 0, "σύ": 0, "ὑμεῖς": 0, "ἡμεῖς": 0, "ἐγώ": 0}
    n1473 = flag = 0
    flag_reasons = {}
    for line in open(abp_txt, encoding="utf-8", errors="replace"):
        m = verse_re.match(line.strip())
        if not m or m.group(1) != abp_abbrev:
            continue
        ch, vs = int(m.group(2)), int(m.group(3))
        abp_raw = _STRONGS_RE.findall(m.group(4))
        corrs = correct_verse(abp_raw, src.verse(bnum, ch, vs), _verse_glosses(m.group(4)))
        for c in corrs:
            if c.action in ("fix", "keep"):
                n1473 += 1; cats[c.reason] = cats.get(c.reason, 0) + 1
            elif c.action == "flag":
                n1473 += 1; flag += 1
                flag_reasons[c.reason.split(":")[0]] = flag_reasons.get(c.reason.split(":")[0], 0) + 1
    resolved = n1473 - flag
    print(f"\n══ lxx_align NT self-probe: {abp_abbrev} → {bnum} ══")
    print(f"  total ABP G1473 slots : {n1473}")
    for k in ("αὐτός", "σύ", "ὑμεῖς", "ἡμεῖς", "ἐγώ"):
        print(f"    → {k:<6} : {cats.get(k,0)}")
    print(f"    → FLAG  : {flag}  {dict(sorted(flag_reasons.items(), key=lambda x:-x[1]))}")
    print(f"  RESOLVED : {resolved}/{n1473} = {100*resolved/(n1473 or 1):.1f}%")


def _dump_nt(abp_abbrev, abp_txt, tagnt_paths, sample=12):
    bnum = _ABP_TO_TAGNT.get(abp_abbrev)        # inspection: bypass SCOPE gate
    if not bnum:
        print(f"No TAGNT mapping for {abp_abbrev}"); return
    src = TAGNTSource(tagnt_paths)
    verse_re = re.compile(r"^\((\w+)\s+(\d+):(\d+)\)\s+(.*)")
    mism = []           # (ref, gloss_word, cat, morph, en_bucket, cat_bucket)
    okeng = {}          # cat -> [(ref, gloss_word, morph)]
    morph_only = fixes = guard_flags = gloss_flags = 0
    for line in open(abp_txt, encoding="utf-8", errors="replace"):
        m = verse_re.match(line.strip())
        if not m or m.group(1) != abp_abbrev:
            continue
        ch, vs = int(m.group(2)), int(m.group(3))
        text = m.group(4)
        abp_raw = _STRONGS_RE.findall(text)
        glosses = _verse_glosses(text)
        corrs = correct_verse(abp_raw, src.verse(bnum, ch, vs), glosses)
        ref = f"{abp_abbrev} {ch}:{vs}"
        for i, c in enumerate(corrs):
            if c.action == "flag" and c.reason == "low-confidence-verse":
                guard_flags += 1
                continue
            if c.action == "flag" and c.reason.startswith("gloss-mismatch"):
                gloss_flags += 1
                continue
            if c.action not in ("fix", "keep"):
                continue
            fixes += 1
            cat = c.reason                       # αὐτός / σύ / ὑμεῖς / ἡμεῖς / ἐγώ
            gword = _last_en_word(glosses[i] if i < len(glosses) else "")
            ebkt = _EN_BUCKET.get(gword)
            cbkt = _CAT_BUCKET.get(cat)
            if gword.endswith("self") or gword.endswith("selves"):
                ebkt = cbkt                      # intensive/reflexive: never flag
            if ebkt is None:
                morph_only += 1                  # blank/non-pronoun gloss → rely on morph
            elif ebkt == cbkt:
                okeng.setdefault(cat, []).append((ref, gword, c.morph))
            else:
                mism.append((ref, gword, cat, c.morph, ebkt, cbkt))
    print(f"\n══ lxx_align --dump-nt: {abp_abbrev} → {bnum} ══")
    print(f"  corrected (fix+keep) slots : {fixes}")
    print(f"  guard-flagged (low-conf)   : {guard_flags}")
    print(f"  gloss-flagged (person≠ABP) : {gloss_flags}")
    print(f"  English gloss CONFIRMS     : {sum(len(v) for v in okeng.values())}")
    print(f"  no English cue (morph only): {morph_only}")
    print(f"  *** MISMATCH (should be 0) : {len(mism)} ***")
    if mism:
        print("\n  ── MISMATCHES (english gloss contradicts assigned number) ──")
        for ref, gw, cat, mo, eb, cb in mism[:80]:
            print(f"    {ref:<12} gloss '{gw}' ({eb}) → assigned {cat} ({cb})  morph={mo}")
    print("\n  ── sample CONFIRMED corrections (english agrees with number) ──")
    for cat in ("αὐτός", "σύ", "ὑμεῖς", "ἡμεῖς", "ἐγώ"):
        rows = okeng.get(cat, [])
        if not rows:
            continue
        print(f"   {cat} ({len(rows)}):")
        for ref, gw, mo in rows[:sample]:
            print(f"     {ref:<12} '{gw}'  morph={mo}")


if __name__ == "__main__":
    if len(sys.argv) >= 5 and sys.argv[1] == "--probe":
        _probe(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) >= 5 and sys.argv[1] == "--dump":
        _dump(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) >= 5 and sys.argv[1] == "--probe-nt":
        _probe_nt(sys.argv[2], sys.argv[3], sys.argv[4:])
    elif len(sys.argv) >= 5 and sys.argv[1] == "--dump-nt":
        _dump_nt(sys.argv[2], sys.argv[3], sys.argv[4:])
    else:
        print(__doc__)
        print("Usage: python3 scripts/lxx_align.py --probe   <ABP_ABBREV> <abp_book.txt> <rahlfs_dir>")
        print("       python3 scripts/lxx_align.py --dump    <ABP_ABBREV> <abp_book.txt> <rahlfs_dir>")
        print("       python3 scripts/lxx_align.py --probe-nt <ABP_ABBREV> <abp_book.txt> <tagnt_file...>")
        print("       python3 scripts/lxx_align.py --dump-nt  <ABP_ABBREV> <abp_book.txt> <tagnt_file...>")
