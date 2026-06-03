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


# ── Rahlfs data (line-aligned parallel arrays, 623,693 words) ───────────────
class RahlfsLXX:
    """Loads Rahlfs-1935 once; serves per-verse (strong_base, morph, is_pron)."""

    # ABP book abbrev → Rahlfs book NAME (as in 08_versification/001_verse_c_book.csv).
    # Protocanonical books that map cleanly. NOTE: the LXX interleaves
    # deuterocanonical books, so post-Chronicles Hebrew-canon books are offset
    # in Rahlfs numbering — that reconciliation is a TODO for full-OT scope.
    # Genesis (the proof book) and the Pentateuch map 1:1.
    ABP_TO_RAHLFS_NAME = {
        "Gen": "Gen", "Exo": "Exod", "Lev": "Lev", "Num": "Num", "Deu": "Deut",
        "Jos": "Josh", "Jdg": "Judg", "Rth": "Ruth",
        # (extend + verify against 001_verse_c_book.csv before full-OT scope)
    }

    def __init__(self, rahlfs_dir):
        self.dir = Path(rahlfs_dir)
        self._name_to_num = self._load_book_numbers()
        self._strong = self._load_col("07_StrongNumber/final_Strongs.csv", 1)
        self._morph  = self._load_col("03a_morphology_with_JTauber_patches/patched_623693.csv", 1)
        self._ranges = self._load_verse_ranges()   # (booknum,ch,vs) -> (start,end) inclusive

    def _open(self, rel):
        return open(self.dir / rel, encoding="utf-8-sig", errors="replace")

    def _load_book_numbers(self):
        names = {}
        with self._open("08_versification/001_verse_c_book.csv") as f:
            for i, line in enumerate(f, start=1):
                nm = line.strip()
                if nm:
                    names[nm] = i
        return names

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
        name = self.ABP_TO_RAHLFS_NAME.get(abp_abbrev)
        return self._name_to_num.get(name) if name else None

    def verse(self, booknum, chapter, vs):
        """Return list of (strong_base, morph, is_pron) for the verse, or []."""
        rng = self._ranges.get((booknum, chapter, vs))
        if not rng:
            return []
        out = []
        for i in range(rng[0], rng[1] + 1):
            mo = self._morph.get(i, "")
            is_pron = bool(re.match(r"^R(?!A)", mo))     # RP/RD/RR/RI  (exclude RA article)
            out.append((base(self._strong.get(i, "")), mo, is_pron))
        return out


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

def correct_verse(abp_strongs_raw, rahlfs_verse):
    """
    abp_strongs_raw : list of ABP raw Strong's per word, in ABP source order
                      (e.g. 'G1473', 'G3077', 'G*', None).
    rahlfs_verse    : output of RahlfsLXX.verse() — [(strong, morph, is_pron), ...]
    Returns a list of Correction objects, one per ABP word, same order.

      action 'fix'  : was G1473, aligned to a known Rahlfs pronoun → new_strong+morph
      action 'keep' : was G1473, genuinely ἐγώ (Rahlfs also 1473) → new_strong=1473
      action 'flag' : was G1473 but no confident pronoun match → review (unchanged)
      action 'none' : not a G1473 slot (morph attached if Strong's anchor-matched)
    """
    a_bases = [base(s) for s in abp_strongs_raw]
    b_bases = [t[0] for t in rahlfs_verse]
    b_pron  = [t[2] for t in rahlfs_verse]

    # No Rahlfs data → flag every pronoun slot, leave everything else.
    if not rahlfs_verse:
        return [Correction("flag", reason="no-rahlfs-verse") if b == "1473"
                else Correction("none") for b in a_bases]

    pairs = align(a_bases, b_bases, b_pron)
    amap = {}
    for ai, bj in pairs:
        if ai >= 0:
            amap[ai] = bj

    out = []
    for i, ab in enumerate(a_bases):
        bj = amap.get(i, -1)
        rt = rahlfs_verse[bj] if bj is not None and bj >= 0 else None
        if ab == "1473":
            if rt and rt[0] in RESOLVE:
                act = "keep" if rt[0] in EGO else "fix"
                out.append(Correction(act, new_strong=rt[0], morph=rt[1],
                                       reason=_category(rt[0])))
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
        corrs = correct_verse(abp_raw, rx.verse(bnum, ch, vs))
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


if __name__ == "__main__":
    if len(sys.argv) >= 5 and sys.argv[1] == "--probe":
        _probe(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(__doc__)
        print("Usage: python3 scripts/lxx_align.py --probe <ABP_ABBREV> <abp_book.txt> <rahlfs_dir>")
