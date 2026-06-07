#!/usr/bin/env python3
"""
build_words_from_abp.py

Rebuilds the words table using ABP text files for word order and glosses,
with BH scrape as a metadata overlay (italic_words, smcap_words, greek_pos).

Bracket groups and word order within brackets are derived from ABP position
numbers ([1word 2word 3word]) — not from BH greek_pos, which is unreliable
for this purpose.

Run on PythonAnywhere:
    python scripts/build_words_from_abp.py [bible.db] [bh_scrape.db]
    python scripts/build_words_from_abp.py --test [--book Gen] [--chapter 1] [--verse 1]
"""

import re
import sys
import shutil
import sqlite3
import zipfile
from pathlib import Path

try:
    sys.path.insert(0, str(Path(__file__).parent))
    from parse_abp import _head_word
except ImportError:
    _ARTICLES = frozenset({"the", "a", "an"})

    def _head_word(text):
        if not text:
            return None
        words = re.sub(r"[^\w]", " ", text).split()
        for w in words:
            if w.lower() not in _ARTICLES:
                return w
        return words[0] if words else None


try:
    from lxx_align import RahlfsLXX, TAGNTSource, correct_verse
except ImportError:
    RahlfsLXX = TAGNTSource = None

BASE_DIR    = Path(__file__).parent.parent
ABP_OT_ZIP  = BASE_DIR / "abp_ot_texts.zip"
ABP_NT_ZIP  = BASE_DIR / "abp_nt_texts.zip"
ABP_OT_DIR  = BASE_DIR / "abp_texts" / "abp_ot_texts"
ABP_NT_DIR  = BASE_DIR / "abp_texts" / "abp_nt_texts"
RAHLFS_DIR  = Path.home() / "LXX-Rahlfs-1935"   # 4 data files fetched separately on PA; not in git
TAGNT_FILES = [Path.home() / "TAGNT_Mat-Jhn.txt",
               Path.home() / "TAGNT_Act-Rev.txt"]  # STEPBible TAGNT (CC-BY); fetched on PA, not in git

ABBREV_TO_SLUG = {
    "Gen": "genesis",        "Exo": "exodus",          "Lev": "leviticus",
    "Num": "numbers",        "Deu": "deuteronomy",      "Jos": "joshua",
    "Jdg": "judges",         "Rth": "ruth",             "1Sa": "1_samuel",
    "2Sa": "2_samuel",       "1Ki": "1_kings",          "2Ki": "2_kings",
    "1Ch": "1_chronicles",   "2Ch": "2_chronicles",     "Ezr": "ezra",
    "Neh": "nehemiah",       "Est": "esther",           "Job": "job",
    "Psa": "psalms",         "Pro": "proverbs",         "Ecc": "ecclesiastes",
    "Son": "songs",          "Isa": "isaiah",           "Jer": "jeremiah",
    "Lam": "lamentations",   "Eze": "ezekiel",          "Dan": "daniel",
    "Hos": "hosea",          "Joe": "joel",             "Amo": "amos",
    "Oba": "obadiah",        "Jon": "jonah",            "Mic": "micah",
    "Nah": "nahum",          "Hab": "habakkuk",         "Zep": "zephaniah",
    "Hag": "haggai",         "Zec": "zechariah",        "Mal": "malachi",
    "Mat": "matthew",        "Mar": "mark",             "Luk": "luke",
    "Joh": "john",           "Act": "acts",             "Rom": "romans",
    "1Co": "1_corinthians",  "2Co": "2_corinthians",    "Gal": "galatians",
    "Eph": "ephesians",      "Php": "philippians",      "Col": "colossians",
    "1Th": "1_thessalonians","2Th": "2_thessalonians",  "1Ti": "1_timothy",
    "2Ti": "2_timothy",      "Tit": "titus",            "Phm": "philemon",
    "Heb": "hebrews",        "Jas": "james",            "1Pe": "1_peter",
    "2Pe": "2_peter",        "1Jn": "1_john",           "2Jn": "2_john",
    "3Jn": "3_john",         "Jud": "jude",             "Rev": "revelation",
}

_STRONGS_RE  = re.compile(r"(G\*|G\d+(?:\.\d+)*)")
_VERSE_RE    = re.compile(r"^\((\w+)\s+(\d+):(\d+)\)\s+(.*)")
_STRIP_PUNCT = re.compile(r"[^\w\s]")
_WORD_NUM    = re.compile(r"(?<!\w)\d+")
_LEAD_NUM    = re.compile(r"^\d+")


# ── Parsing ───────────────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    return _STRIP_PUNCT.sub("", text or "").lower().strip()


def clean_english(text: str) -> str:
    """Strip ABP bracket chars and position numbers from a gloss token."""
    t = text.strip()
    t = t.replace("[", "").replace("]", "")
    t = _WORD_NUM.sub("", t)
    return t.strip()


def bracket_info(raw: str):
    """
    Extract bracket metadata from a raw (pre-clean) token text.
    Returns (abp_pos, opens_bracket, closes_bracket).

    '[2was not'  → (2, True,  False)
    '1That one]' → (1, False, True)
    ' 3light'    → (3, False, False)
    'God made'   → (None, False, False)
    ''           → (None, False, False)
    """
    opens  = "[" in raw
    closes = "]" in raw
    # Strip surrounding whitespace, brackets, and trailing punctuation so the
    # leading position number (e.g. "1 the second]." → "1") is always reachable.
    s = re.sub(r"[^\w\s]", "", raw.strip().lstrip("[")).strip()
    m = _LEAD_NUM.match(s)
    abp_pos = int(m.group()) if m else None
    return abp_pos, opens, closes


def parse_abp_line(line: str):
    """
    Returns (abbrev, chapter, verse, words) or None.
    words = [(english, strongs_raw, abp_pos, opens_bracket, closes_bracket), ...]
    """
    m = _VERSE_RE.match(line.strip())
    if not m:
        return None
    book    = m.group(1)
    chapter = int(m.group(2))
    verse   = int(m.group(3))
    text    = m.group(4)

    parts = _STRONGS_RE.split(text)
    words = []
    i = 0
    while i < len(parts) - 1:
        raw = parts[i]
        ap, ob, cb = bracket_info(raw)
        words.append((clean_english(raw), parts[i + 1], ap, ob, cb))
        i += 2
    if parts and parts[-1].strip():
        raw = parts[-1]
        ap, ob, cb = bracket_info(raw)
        words.append((clean_english(raw), None, ap, ob, cb))
    return book, chapter, verse, words


def _abp_sources():
    """Return directory paths if present, otherwise fall back to zip files."""
    ot = ABP_OT_DIR if ABP_OT_DIR.is_dir() else ABP_OT_ZIP
    nt = ABP_NT_DIR if ABP_NT_DIR.is_dir() else ABP_NT_ZIP
    return ot, nt


def iter_verses(*sources):
    """Accept zip file paths or directory paths interchangeably."""
    for src in sources:
        src = Path(src)
        if src.is_dir():
            for txt in sorted(src.glob("*.txt")):
                with txt.open(encoding="utf-8", errors="replace") as f:
                    for raw in f:
                        parsed = parse_abp_line(raw)
                        if parsed:
                            yield parsed
        else:
            with zipfile.ZipFile(src) as z:
                for name in sorted(z.namelist()):
                    if not name.endswith(".txt"):
                        continue
                    with z.open(name) as f:
                        for raw in f:
                            parsed = parse_abp_line(raw.decode("utf-8", errors="replace"))
                            if parsed:
                                yield parsed


# ── BH index ──────────────────────────────────────────────────────────────────

def load_bh_verse_index(scrape: sqlite3.Connection) -> dict:
    index: dict = {}
    cur_key = None
    cur_rows: list = []
    for slug, ch, vs, strongs, english, iw, sw, gpos in scrape.execute(
        "SELECT book, chapter, verse, strongs, english, italic_words, smcap_words, greek_pos"
        " FROM bh_words ORDER BY book, chapter, verse, position"
    ):
        key = (slug, ch, vs)
        if key != cur_key:
            if cur_key is not None:
                index[cur_key] = cur_rows
            cur_key = key
            cur_rows = []
        base = strongs.split("-")[0].split(".")[0] if strongs else "*"
        cur_rows.append((base, normalize(english or ""), gpos, iw or "", sw or ""))
    if cur_key is not None:
        index[cur_key] = cur_rows
    return index


def bh_lookup(bh_rows: list, used: set, abp_base: str, abp_norm: str):
    for i, (base, norm, gpos, iw, sw) in enumerate(bh_rows):
        if i not in used and base == abp_base and norm == abp_norm:
            used.add(i)
            return gpos, iw, sw
    for i, (base, norm, gpos, iw, sw) in enumerate(bh_rows):
        if i not in used and base == abp_base:
            used.add(i)
            return gpos, iw, sw
    return None, "", ""


# ── Lexicon helpers ───────────────────────────────────────────────────────────

def load_lexicon(conn: sqlite3.Connection) -> dict:
    lex: dict = {}
    for strongs, kjv_def, strongs_def in conn.execute(
        "SELECT strongs, kjv_def, strongs_def FROM lexicon"
    ):
        base = strongs.lstrip("GH").split(".")[0]
        text = " ".join(filter(None, [kjv_def, strongs_def]))
        lex[base] = set(re.sub(r"[^\w\s]", " ", text).lower().split())
    return lex


# ── Compound splitting ────────────────────────────────────────────────────────

# Leading subject pronouns / auxiliaries that never carry a lexical sense, so the
# def-match below can't place them. Used ONLY when carry=True (see _split_compounds).
_CARRY_FW = frozenset({
    "i", "you", "ye", "thou", "thee", "we", "they", "he", "she", "it", "who",
    "do", "did", "does", "shall", "will", "would", "should",
    "may", "might", "can", "could", "must", "let", "have", "has", "had",
})


def _split_compounds(rows: list, lex: dict, carry: bool = False) -> None:
    """
    Redistribute words from compound ABP glosses to subsequent empty-english slots
    using lexicon evidence, then swap position numbers so redistributed words
    display before the verb/head word.

    carry=False (DEFAULT, used by the build): original behavior, unchanged — a
    rebuild produces exactly the same output it always has.

    carry=True (used ONLY by scripts/_gen_split_candidates.py): also lets a leading
    subject/aux word ("I", "do", "shall") ride to the verb it fronts, which fixes
    the reorder-merge garbles ("I see magistrates" -> "I see" | "magistrates"). This
    is NOT on by default because corpus-wide it also regresses ~85 verses
    (article/copula garbles the leaky lexicon match can't avoid); instead the
    PROVABLY-clean subset is frozen in split_merge_fixes.json and applied as a
    pinned data-patch by fix_split_merges.py. Leave carry=False here.

    Row tuple indices (11 elements while processing):
      0:pos  1:english  2:english_head  3:strongs  4:sbase  5:gpos
      6:bracket_id  7:italic  8:iw  9:sw  10:abp_pos
    """
    _NORM = re.compile(r"[^\w]")

    for i in range(len(rows)):
        pos_i, eng, head, strongs, sbase, gpos, bid, italic, iw, sw, abp_pos_i = rows[i][:11]
        morph_i, lemma_i = rows[i][11], rows[i][12]     # slot i's own morph/lemma (carried along)
        if not eng or " " not in eng:
            continue
        if not sbase or sbase in ("*", ""):
            continue
        # Bracketed slots are left exactly as the source orders them. ee84aa0 ("Keep
        # Greek word order within brackets") set bracket rendering to Greek/source order,
        # with the gpos superscripts conveying the English reading order. The
        # redistribution + front-swap below was only ever safe under the _sort_brackets
        # re-sort that ee84aa0 removed — so inside a bracket the swap silently garbled the
        # word order (audit_bracket_order.py: 374 cases, e.g. 1Ch 15:13 "the and LORD").
        # Splitting still runs for NON-bracketed glosses ("God made" → a separate
        # θεός/G2316 chip), where there are no source numbers to order by.
        if bid is not None:
            continue

        own_def = lex.get(sbase, set())
        gloss_words = eng.split()

        ahead = []
        for j in range(i + 1, len(rows)):
            if rows[j][1]:
                break
            slot_base = rows[j][4]
            if slot_base and slot_base not in ("*", ""):
                # facet (a): never redistribute a gloss word INTO the copula slot
                # (εἰμί, every conjugation → base 1510). Extracting e.g. "is" from
                # "he is a prophet" and fronting it (the swap below) renders
                # "is he a prophet"; leaving the copula slot empty keeps the
                # predicate gloss whole → "...for he is a prophet,".
                # (A broader morph-POS gate to also block this/that-into-demonstrative
                # over-reach was tried + REVERTED — it bundled "the LORD"/"their X"
                # corpus-wide, 11k verses. See TODO "_split_compounds demonstrative fix".)
                if slot_base == "1510":
                    continue
                ahead.append((j, slot_base, lex.get(slot_base, set())))

        if not ahead:
            continue

        # Leading-run rule (only non-bracketed slots reach here now): front a
        # redistributed gloss word only when no kept "own" word precedes it — so a
        # leading determiner ("the LORD", "their X") still splits, but a word sitting
        # after a kept word ("of this possession", "he is a prophet") stays put.
        apply_leading_run = True
        taken: dict = {}          # slot index -> [gloss words] in reading order
        own = []
        seen_own = False
        pending = []              # held leading subject/aux words awaiting a verb slot

        for word in gloss_words:
            norm = _NORM.sub("", word).lower()
            if not norm:
                if pending:
                    own.extend(pending); pending = []
                own.append(word)
                seen_own = True
                continue
            if norm in own_def:
                if pending:
                    own.extend(pending); pending = []
                own.append(word)
                seen_own = True
                continue
            # Once a kept "own" word has appeared, a non-bracketed slot stops
            # fronting (leading-run): a determiner at the head ("the LORD",
            # "their X") still fronts; one sitting AFTER a kept word ("of THIS
            # possession", "of THE LORD") stays put. Keys on gloss word-order,
            # not target POS (the POS gate of attempt 1 regressed every leading
            # determiner corpus-wide).
            if apply_leading_run and seen_own:
                own.append(word)
                continue
            placed = False
            for j, slot_base, slot_def in ahead:
                if j in taken:
                    continue
                if slot_def and norm in slot_def:
                    # held leading pronouns/aux ride to the verb's slot ("I see")
                    taken[j] = pending + [word]
                    pending = []
                    placed = True
                    break
            if placed:
                continue
            # Unmatched word. A leading subject/aux ("I", "do", "shall") matches no
            # definition; hold it so it travels with the verb it fronts instead of
            # poisoning the leading run and stranding the verb's gloss (1Sa 28:13).
            if carry and norm in _CARRY_FW and not seen_own:
                pending.append(word)
            else:
                if pending:
                    own.extend(pending); pending = []
                own.append(word)
                seen_own = True

        if pending:
            own.extend(pending); pending = []

        if not taken:
            continue

        # Assign english + inherit bracket_id, abp_pos, and gpos from source.
        # gpos (the position number superscript) moves to the first chip of the
        # compound so it displays before the first visible word.
        src_gpos    = rows[i][5]
        src_bid     = rows[i][6]
        src_abp_pos = rows[i][10]
        for j, words in taken.items():
            r = rows[j]
            eng = " ".join(words)
            # slot j keeps its OWN morph/lemma (r[11]/r[12]) — only the english moved in
            rows[j] = (r[0], eng, _head_word(eng), r[3], r[4], src_gpos, src_bid, r[7], r[8], r[9],
                       src_abp_pos, r[11], r[12])

        new_eng = " ".join(own) if own else None
        rows[i] = (pos_i, new_eng, _head_word(new_eng) if new_eng else None,
                   strongs, sbase, None, bid, italic, iw, sw, abp_pos_i, morph_i, lemma_i)

        for j in sorted(taken.keys()):
            p_i, p_j = rows[i][0], rows[j][0]
            rows[i] = (p_j,) + rows[i][1:]
            rows[j] = (p_i,) + rows[j][1:]

    rows.sort(key=lambda r: r[0])


# ── Backwards-pairing correction (number-reversal repair) ──────────────────────
# ABP writes a multi-word gloss with its Greek numbers tacked on the end
# ("of God  G3588 G2316"). _split_compounds hands the words to the empty slots by
# lexicon evidence, and for a [connector + content-noun] lump on a FUNCTION word
# (article ὁ/G3588 or a preposition) it can pair them BACKWARDS — the noun's tag
# landing on the function word and the connector's on the real noun (1Sa 5:2,
# Rom 8:34, the "a <noun>" prep cases). The English reads fine; only the
# clickable Strong's tag under each word ends up on the wrong slot.
#
# This pass corrects exactly that fingerprint — the same one scan_strongs_cross.py
# detects — by swapping the two slots' Greek identity (strongs, strongs_base,
# morph, lemma). It REPLACES the per-verse fix_article_noun_swaps.py band-aid:
# evidence-driven, no hardcoded verse list, re-applies on every rebuild. English
# text and word positions are untouched, so the verse reads identically.
_ARTICLE_FW   = "3588"
_PREP_FW = frozenset({
    "1722", "1519", "1537", "575", "4314", "1909", "2596", "3326", "1223",
    "5259", "5228", "3844", "4012", "1799", "1715", "3694", "561", "1726",
    "630", "3936",
})
_FUNCTION_FW  = frozenset({_ARTICLE_FW}) | _PREP_FW
_CONNECTOR_FW = frozenset({
    "of", "the", "a", "an", "to", "in", "by", "with", "for", "from", "at", "on",
    "into", "unto", "upon", "over", "under", "through", "s",
})
_SKIP_HEAD_FW = frozenset({
    "the", "a", "an", "this", "that", "these", "those", "of", "in", "by", "to",
    "with", "for", "from", "at", "on", "into", "unto", "and", "or", "not",
    "he", "she", "it", "they", "we", "i", "you", "me", "him", "her", "them",
    "us", "one", "ones", "thing", "things", "who", "which", "what", "both",
    "all", "any", "some", "each", "every", "other", "same", "is", "are", "was",
    "were", "be", "been", "being", "because", "therefore", "so", "then", "lest",
    "though", "while", "when", "where", "why", "how", "as", "than", "if",
})
_DET_FW = frozenset({
    "the", "a", "an", "this", "that", "these", "those", "my", "your", "his",
    "her", "our", "their", "its", "all", "of", "some", "any", "each", "every",
    "no", "which", "what", "one", "ones",
})


def _bare_fw(s):
    return re.sub(r"[^\w]", "", s or "").lower()


def _singular_fw(w):
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def _fix_backwards_pairing(rows: list, lex: dict) -> None:
    """Swap the Greek tag on the two slots of a backwards number-pairing (see note
    above). Acts only on the high-precision fingerprint: a function-word slot
    (article/prep) carrying a real content noun whose meaning is found in an
    ADJACENT content slot that itself shows only a connector. Touches strongs,
    strongs_base, morph, lemma — never english/position — so the verse reads the
    same; only the tag under each word is corrected."""
    by_pos = {r[0]: i for i, r in enumerate(rows)}
    for idx, r in enumerate(rows):
        pos, eng, head, sbase = r[0], r[1], r[2], r[4]
        if sbase not in _FUNCTION_FW or not head:
            continue
        h = _bare_fw(head)
        if not h or h in _SKIP_HEAD_FW:
            continue
        toks = (eng or "").split()
        if toks and _bare_fw(toks[0]) in _DET_FW:        # substantival "the X" = legit
            continue
        for delta in (1, -1):
            nidx = by_pos.get(pos + delta)
            if nidx is None:
                continue
            nb  = rows[nidx]
            nsb = nb[4]
            if not nsb or nsb in _FUNCTION_FW or nsb in ("*", ""):
                continue
            neng = (nb[1] or "").strip().lower().strip(".,;:")
            d    = lex.get(nsb, set())
            if neng in _CONNECTOR_FW and (h in d or _singular_fw(h) in d):
                a, b = rows[idx], rows[nidx]
                # swap Greek identity (strongs=3, sbase=4, morph=11, lemma=12)
                rows[idx]  = (a[0], a[1], a[2], b[3], b[4], a[5], a[6], a[7],
                              a[8], a[9], a[10], b[11], b[12])
                rows[nidx] = (b[0], b[1], b[2], a[3], a[4], b[5], b[6], b[7],
                              b[8], b[9], b[10], a[11], a[12])
                break


# ── Lumped proper-noun + article split (Problem 2) ─────────────────────────────
_TRAIL_ARTICLE = frozenset({"the", "a", "an"})
_LEAD_SKIP = _DET_FW | _SKIP_HEAD_FW | frozenset({
    "for", "but", "yet", "nor", "indeed", "now", "also", "therefore",
    "moreover", "wherefore", "thus", "even",
})


def _split_pn_article_lump(rows: list) -> None:
    """ABP lumps a proper noun and a trailing article into ONE chip on the article
    slot ("Jesus the" on ὁ/G3588) and leaves the proper-noun slot (G* → '*') empty.
    Split into two plain, separately-clickable chips that read in English order
    "Jesus the" — NO bracket, NO reorder superscripts (matches eSword: "Jesus the
    Christ"). The EARLIER position takes the proper noun ("Jesus", '*' tag for
    import_tipnr to fill); the later position takes the article ("the", G3588). Only
    the pair's english/head/strongs/strongs_base/morph/lemma move; greek_pos and
    bracket_id are cleared so it renders inline with no [ ] markers. Rare (Act 19:4
    is the only corpus case) but built-in, not a per-verse patch. Runs last."""
    by_pos = {r[0]: i for i, r in enumerate(rows)}

    for idx, r in enumerate(rows):
        if r[4] != _ARTICLE_FW or r[6] is not None:        # article slot, unbracketed
            continue
        toks = (r[1] or "").split()
        if len(toks) < 2 or _bare_fw(toks[-1]) not in _TRAIL_ARTICLE:
            continue
        if _bare_fw(toks[0]) in _LEAD_SKIP:
            continue
        nidx = by_pos.get(r[0] + 1)
        if nidx is None:
            nidx = by_pos.get(r[0] - 1)
        if nidx is None:
            continue
        nb = rows[nidx]
        if (nb[1] and nb[1].strip()) or nb[4] != "*" or nb[6] is not None:
            continue
        art_eng = toks[-1]                  # "the"
        pn_eng  = " ".join(toks[:-1])       # "Jesus"
        art, pn = rows[idx], rows[nidx]     # article identity vs '*' identity
        early, late = (idx, nidx) if art[0] <= pn[0] else (nidx, idx)
        e, l = rows[early], rows[late]
        # earlier position -> proper noun ("Jesus"): '*' tag + its morph/lemma
        rows[early] = (e[0], pn_eng, _head_word(pn_eng), pn[3], pn[4], None, None,
                       e[7], e[8], e[9], e[10], pn[11], pn[12])
        # later position -> article ("the"): G3588 tag + its morph/lemma
        rows[late]  = (l[0], art_eng, _head_word(art_eng), art[3], art[4], None, None,
                       l[7], l[8], l[9], l[10], art[11], art[12])


# ── Bracket sorting ───────────────────────────────────────────────────────────

def _sort_brackets(rows: list) -> None:
    """
    Within each bracket group (same non-None bracket_id), sort words by
    abp_pos (element 10) so they display in ABP English reading order.
    Words with no abp_pos (ghost slots) sort last within their group.
    Reassigns sequential position numbers after sorting.
    """
    i = 0
    while i < len(rows):
        bid = rows[i][6]
        if bid is None:
            i += 1
            continue
        # Find extent of this bracket group
        j = i
        while j + 1 < len(rows) and rows[j + 1][6] == bid:
            j += 1
        # Sort by (abp_pos or ∞, original_pos)
        group = rows[i:j + 1]
        group.sort(key=lambda r: (r[10] if r[10] is not None else 9999, r[0]))
        # Reassign positions sequentially from base
        base = rows[i][0]
        for k, r in enumerate(group):
            rows[i + k] = (base + k,) + r[1:]
        i = j + 1


# ── Verse builder ─────────────────────────────────────────────────────────────

def apply_pronoun_corrections(abp_words: list, corrections: list,
                              flag_log: list, ref: str) -> list:
    """Pre-pass: rewrite raw_strongs for G1473 slots that confidently align to a
    Rahlfs pronoun (correct_verse → action 'fix'/'keep'). SURGICAL — only those
    slots change; everything else (incl. '*' proper-noun placeholders) passes
    through untouched. Flagged slots are logged and left as G1473. Returns a NEW
    list so the downstream reorder logic in build_verse_words is unaffected.

    Each output tuple is widened to 7 elements — (eng, raw, abp_pos, opens, closes,
    morph, lemma) — carrying the per-word morph + lemma the alignment found
    (None where it didn't anchor-match) on into build_verse_words."""
    out = []
    for (eng, raw, ap, ob, cb), c in zip(abp_words, corrections):
        if c.action in ("fix", "keep") and c.new_strong:
            out.append((eng, "G" + c.new_strong, ap, ob, cb, c.morph, c.lemma))
        else:
            if c.action == "flag":
                flag_log.append(f"{ref}\t{eng}\t{c.reason}")
            out.append((eng, raw, ap, ob, cb, c.morph, c.lemma))
    return out


# ── Pronoun-compound redistribution (symptom #2) ───────────────────────────────

_PRONOUN_BASES = frozenset({
    "846", "4675", "4771", "4571", "4674", "4671",
    "5210", "5216", "5213", "5209", "2249", "2257", "2254", "2248",
})
_ARTICLE_BASE = "3588"

# English pronoun words ABP uses — so we can tell the pronoun's OWN word from the
# verb phrase bundled onto it. (The lexicon def is KJV-style "thee/thy" and won't
# match ABP's "you/your", so an explicit set is used instead.)
_ENGLISH_PRONOUN_WORDS = frozenset({
    "i", "me", "my", "mine", "myself",
    "you", "your", "yours", "yourself", "yourselves", "thou", "thee", "thy", "thine", "ye",
    "he", "him", "his", "himself",
    "she", "her", "hers", "herself",
    "it", "its", "itself",
    "we", "us", "our", "ours", "ourselves",
    "they", "them", "their", "theirs", "themselves", "same",
})


def _redistribute_pronoun_compounds(rows: list) -> None:
    """Symptom #2: ABP bundles a verb's English onto a PRONOUN slot, leaving the
    verb's own slot glossless — e.g. Gen 3:15 "will give heed to your" sits on
    σου/G4675 while τηρέω/G5083 is empty. Keep the pronoun's own word ("your") on
    the pronoun; move the rest ("will give heed to") to the adjacent empty slot;
    put the two into a NEW 2-word bracket so PROSE reads verb-then-pronoun
    (greek_pos order) while CHIP keeps Greek/source order (position order).

    SURGICAL: fires only for a known-pronoun slot with a multi-word gloss whose
    very next slot is empty, real-Strong's, non-article, and (like the pronoun)
    currently bracket-free. Touches english/english_head/greek_pos/bracket_id
    ONLY — never strongs/strongs_base/is_pn. Runs BEFORE _split_compounds so it
    sees the original bundled gloss (split's one-word-per-slot pass mangles it).

    Row tuple (11 elts): 0:pos 1:eng 2:head 3:strongs 4:sbase 5:gpos 6:bid
                         7:italic 8:iw 9:sw 10:abp_pos
    """
    _NORM = re.compile(r"[^\w]")
    existing = [r[6] for r in rows if r[6] is not None]
    next_bid = (max(existing) + 1) if existing else 1

    for i in range(len(rows) - 1):
        eng, sbase = rows[i][1], rows[i][4]
        if sbase not in _PRONOUN_BASES or not eng or " " not in eng:
            continue
        if rows[i][6] is not None:                 # pronoun already bracketed → defer
            continue
        j = i + 1
        if rows[j][1]:                             # next slot must be empty
            continue
        sbj = rows[j][4]
        if not sbj or sbj in ("*", "") or sbj == _ARTICLE_BASE or rows[j][6] is not None:
            continue

        keep, move = [], []
        for word in eng.split():
            norm = _NORM.sub("", word).lower()
            (keep if norm in _ENGLISH_PRONOUN_WORDS else move).append(word)
        if not keep or not move:
            continue

        keep_eng, move_eng = " ".join(keep), " ".join(move)
        bid = next_bid
        next_bid += 1

        ri, rj = rows[i], rows[j]
        # pronoun keeps its word, English-SECOND (greek_pos 2); joins the bracket
        rows[i] = (ri[0], keep_eng, _head_word(keep_eng), ri[3], ri[4],
                   2, bid, ri[7], ri[8], ri[9], ri[10], ri[11], ri[12])
        # verb gets the moved phrase, English-FIRST (greek_pos 1); joins the bracket
        rows[j] = (rj[0], move_eng, _head_word(move_eng), rj[3], rj[4],
                   1, bid, rj[7], rj[8], rj[9], rj[10], rj[11], rj[12])


def build_verse_words(abp_words: list, bh_rows: list, lex: dict = None) -> list:
    """
    Combine ABP word list with BH metadata.
    Bracket groups and reading order within brackets come from ABP position
    numbers ([1...2...3...]) — opens/closes bracket flags drive bracket_id.

    Row tuple (13 elements during processing, 12 returned):
      pos, english, english_head, strongs, strongs_base, greek_pos,
      bracket_id, italic, italic_words, smcap_words  [+ abp_pos (idx 10) stripped on
      return; morph (idx 11) + lemma (idx 12) kept as the final two columns].
      morph/lemma pin to the slot's OWN Greek word — they ride along by index
      through the reorder passes (which redistribute ENGLISH, never the Greek slot).

    abp_words tuples may be 5-wide (eng, raw, abp_pos, opens, closes) or 7-wide
    (… + morph, lemma) when apply_pronoun_corrections ran first; both are accepted.
    """
    used: set = set()
    rows: list = []
    pos = 0
    bid = 0
    in_bracket = False

    for w in abp_words:
        english, raw_strongs, abp_pos, opens_bracket, closes_bracket = w[:5]
        w_morph = w[5] if len(w) > 5 else None     # aligned morph (None if not anchor-matched)
        w_lemma = w[6] if len(w) > 6 else None     # aligned Greek lemma (None likewise)
        if raw_strongs is None:
            strongs = ""
            sbase   = ""
            gpos, iw, sw = None, "", ""
        elif raw_strongs == "G*":
            strongs = "*"
            sbase   = "*"
            gpos, iw, sw = None, "", ""
        else:
            # Keep strongs/sbase BARE here — bh_lookup() and the lexicon index
            # match on bare numbers. The 'G' prefix is re-applied to strongs_base
            # at INSERT time (see module-level _prefix_base). Do NOT prefix here or the
            # internal matching against lex/bh bare keys breaks.
            strongs = raw_strongs[1:]
            sbase   = strongs.split(".")[0]
            gpos, iw, sw = bh_lookup(bh_rows, used, sbase, normalize(english))

        # The bracket chip's superscript IS the source's ABP position number (ee84aa0:
        # "gpos superscripts show English reading order"). abp_pos is non-None only for
        # bracketed source tokens, so this makes the source number authoritative there
        # (fixing the cases where the BibleHub gpos disagreed with the source) while
        # non-bracketed words keep their BH gpos.
        if abp_pos is not None:
            gpos = abp_pos

        # Bracket state machine driven by ABP [/] markers
        if opens_bracket and not in_bracket:
            bid += 1
            in_bracket = True

        if in_bracket:
            bracket_id = bid
        else:
            bracket_id = None

        if closes_bracket:
            in_bracket = False

        english_head = _head_word(english) if english else None
        display      = english_head or (english if english and " " not in english else None)
        italic_set   = set(iw.split(",")) if iw else set()
        italic       = 1 if (display and display.lower() in italic_set) else 0

        # 11th element (abp_pos) is temporary — stripped before return
        rows.append((
            pos, english or None, english_head,
            strongs, sbase, gpos, bracket_id, italic,
            iw if iw else "", sw if sw else "",
            abp_pos, w_morph, w_lemma,
        ))
        pos += 1

    _redistribute_pronoun_compounds(rows)
    if lex:
        _split_compounds(rows, lex)
        _fix_backwards_pairing(rows, lex)
    _split_pn_article_lump(rows)

    # Strip temporary abp_pos (idx 10); keep morph (11) + lemma (12) as the last two columns.
    return [r[:10] + (r[11], r[12]) for r in rows]


# ── Run / test ────────────────────────────────────────────────────────────────

def _prefix_base(w):
    """Restore the 'G' on strongs_base, and drop orphan greek_pos, at INSERT.

    Module-level + pure so it can be unit-tested (tests/test_build_invariants.py):
    these are the two guards that historically broke a rebuild.

    (1) The ABP source is Greek-only; the parser strips the 'G' so internal
    lex/BH matching can compare bare numbers. The DB invariant, however, is
    that words.strongs_base is fully G-prefixed (e.g. 'G2206') — a BARE base
    makes the lexicon join shave a *digit* and resolve the wrong lemma (the
    592k regression). The bare `strongs` column (idx 3) is intentionally left
    as-is (frontend renders it as G{strongs}). '*' (proper-noun placeholder)
    and '' (no strongs) pass through untouched.

    (2) greek_pos (idx 5) is an ABP reorder number meaningful only WITHIN a
    bracket. bh_lookup can hand one to a NON-bracket word (bracket_id, idx 6,
    is None); that orphan number renders as a stray superscript in the corpus
    view. Null it for non-bracket words.
    """
    w = list(w)
    if len(w) > 4 and w[4] and w[4][0].isdigit():
        w[4] = "G" + w[4]
    if len(w) > 6 and w[6] is None:
        w[5] = None
    return tuple(w)


def run(bible_db: str, scrape_db: str) -> None:
    scrape = sqlite3.connect(scrape_db)

    cols = {r[1] for r in scrape.execute("PRAGMA table_info(bh_words)")}
    if "greek_pos" not in cols:
        print("ERROR: bh_words missing greek_pos — re-scrape first.")
        scrape.close()
        sys.exit(1)

    bh_wc = scrape.execute("SELECT COUNT(*) FROM bh_words").fetchone()[0]
    print(f"BH words: {bh_wc:,}")

    ans = input(
        "\nThis will DELETE all rows from words and rebuild from ABP text + BH metadata.\n"
        "Type 'rebuild' to confirm: "
    ).strip()
    if ans != "rebuild":
        print("Aborted.")
        scrape.close()
        return

    main = sqlite3.connect(bible_db)
    bak  = Path(bible_db).with_suffix(".db.bak")
    print(f"Backing up → {bak} …")
    shutil.copy2(bible_db, bak)
    print("Backup done.")

    main_cols = {r[1] for r in main.execute("PRAGMA table_info(words)")}
    for col in ("italic_words", "smcap_words", "morph", "lemma"):
        if col not in main_cols:
            main.execute(f"ALTER TABLE words ADD COLUMN {col} TEXT")
            main.commit()

    verse_map = {(b, c, v): vid for vid, b, c, v in main.execute(
        "SELECT id, book, chapter, verse FROM verses"
    )}
    print(f"ABP verse map: {len(verse_map):,}")

    print("Loading lexicon …")
    lex = load_lexicon(main)
    print(f"Lexicon entries: {len(lex):,}")

    print("Loading BH index …")
    bh_index = load_bh_verse_index(scrape)
    print(f"BH verse keys: {len(bh_index):,}\n")

    rahlfs = None
    if RahlfsLXX and RAHLFS_DIR.is_dir():
        print("Loading Rahlfs-1935 for pronoun correction …")
        rahlfs = RahlfsLXX(RAHLFS_DIR)
        print("  Rahlfs loaded.\n")
    else:
        print("⚠️  Rahlfs dir not found — OT pronoun correction SKIPPED.\n")
    tagnt = None
    if TAGNTSource and all(p.is_file() for p in TAGNT_FILES):
        print("Loading TAGNT for NT pronoun correction …")
        tagnt = TAGNTSource([str(p) for p in TAGNT_FILES])
        print("  TAGNT loaded.\n")
    else:
        print("⚠️  TAGNT files not found — NT pronoun correction SKIPPED.\n")
    flag_log = []

    print("Clearing words table …")
    main.execute("DELETE FROM words")
    main.commit()

    inserted = skipped = 0

    for abbrev, chapter, verse, abp_words in iter_verses(*_abp_sources()):
        verse_id = verse_map.get((abbrev, chapter, verse))
        if not verse_id:
            skipped += 1
            continue

        slug      = ABBREV_TO_SLUG.get(abbrev)
        bh_rows   = bh_index.get((slug, chapter, verse), []) if slug else []

        src = bnum = None
        if rahlfs and rahlfs.booknum(abbrev):           # OT → Rahlfs
            src, bnum = rahlfs, rahlfs.booknum(abbrev)
        elif tagnt and tagnt.booknum(abbrev):           # NT → TAGNT
            src, bnum = tagnt, tagnt.booknum(abbrev)
        if src:
            corrs = correct_verse([w[1] for w in abp_words],
                                  src.verse(bnum, chapter, verse),
                                  [w[0] for w in abp_words])
            abp_words = apply_pronoun_corrections(
                abp_words, corrs, flag_log, f"{abbrev} {chapter}:{verse}")

        word_rows = build_verse_words(abp_words, bh_rows, lex)

        main.executemany(
            "INSERT INTO words"
            " (verse_id, position, english, english_head, strongs, strongs_base,"
            "  greek_pos, bracket_id, italic, italic_words, smcap_words, morph, lemma)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(verse_id, *_prefix_base(w)) for w in word_rows],
        )
        inserted += len(word_rows)

        if inserted % 50_000 == 0:
            main.commit()
            print(f"  {inserted:,} words inserted …", flush=True)

    main.commit()
    main.close()
    scrape.close()

    if flag_log:
        Path("pronoun_review.tsv").write_text("\n".join(flag_log), encoding="utf-8")
        print(f"\n  Flagged {len(flag_log):,} pronoun slots for review → pronoun_review.tsv")

    print(f"\n── Results ─────────────────────────────────────────────")
    print(f"  Words inserted: {inserted:,}")
    print(f"  Verses skipped: {skipped:,}")
    print(f"\n⚠️  This rebuild CLEARED words.is_pn and proper-noun Strong's.")
    print(f"    You MUST re-run the proper-noun import next:")
    print(f"      python3 scripts/import_tipnr.py bible.db")


def run_test(scrape_db: str, book_abbrev: str = "Gen", chapter: int = 1,
             verse: int = None, bible_db: str = None) -> None:
    scrape   = sqlite3.connect(scrape_db)
    bh_index = load_bh_verse_index(scrape)
    scrape.close()

    lex = None
    if bible_db and Path(bible_db).exists():
        conn = sqlite3.connect(bible_db)
        lex  = load_lexicon(conn)
        conn.close()
        print(f"Lexicon: {len(lex):,} entries\n")

    rahlfs = None
    if RahlfsLXX and RAHLFS_DIR.is_dir():
        rahlfs = RahlfsLXX(RAHLFS_DIR)
        print("Rahlfs: loaded for OT pronoun correction\n")
    tagnt = None
    if TAGNTSource and all(p.is_file() for p in TAGNT_FILES):
        tagnt = TAGNTSource([str(p) for p in TAGNT_FILES])
        print("TAGNT: loaded for NT pronoun correction\n")
    flag_log = []

    slug   = ABBREV_TO_SLUG.get(book_abbrev, book_abbrev.lower())
    verses = {}
    for abbrev, ch, vs, words in iter_verses(*_abp_sources()):
        if abbrev == book_abbrev and ch == chapter:
            verses[vs] = words

    if not verses:
        print(f"No ABP data for {book_abbrev} {chapter}.")
        return

    print(f"=== {book_abbrev} {chapter} ===\n")
    for vs in sorted(verses):
        if verse is not None and vs != verse:
            continue
        abp_words = verses[vs]
        bh_rows   = bh_index.get((slug, chapter, vs), [])
        src = bnum = None
        if rahlfs and rahlfs.booknum(book_abbrev):       # OT → Rahlfs
            src, bnum = rahlfs, rahlfs.booknum(book_abbrev)
        elif tagnt and tagnt.booknum(book_abbrev):       # NT → TAGNT
            src, bnum = tagnt, tagnt.booknum(book_abbrev)
        if src:
            corrs = correct_verse([w[1] for w in abp_words],
                                  src.verse(bnum, chapter, vs),
                                  [w[0] for w in abp_words])
            abp_words = apply_pronoun_corrections(
                abp_words, corrs, flag_log, f"{book_abbrev} {chapter}:{vs}")
        word_rows = build_verse_words(abp_words, bh_rows, lex)

        print(f"{book_abbrev} {chapter}:{vs}")
        for (p, eng, head, sn, sb, gpos, bid, italic, iw, sw, morph, lemma) in word_rows:
            flags = ""
            if bid  is not None: flags += f"  bid={bid}"
            if gpos is not None: flags += f"  gpos={gpos}"
            if iw:               flags += f"  iw={iw!r}"
            if morph:            flags += f"  m={morph}"
            if lemma:            flags += f"  lem={lemma}"
            print(
                f"  [{p:2}] {str(sn or '-'):12}  "
                f"eng={str(eng):22}  head={str(head):15}  italic={italic}{flags}"
            )
        print()


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Rebuild words table from ABP text files + BH scrape metadata"
    )
    parser.add_argument("bible_db",  nargs="?", default="bible.db")
    parser.add_argument("scrape_db", nargs="?", default="bh_scrape.db")
    parser.add_argument("--test",    action="store_true")
    parser.add_argument("--book",    default="Gen")
    parser.add_argument("--chapter", type=int, default=1)
    parser.add_argument("--verse",   type=int, default=None)
    args = parser.parse_args()

    if args.test:
        if not Path(args.scrape_db).exists():
            print(f"ERROR: {args.scrape_db} not found.")
            sys.exit(1)
        bible_db = args.bible_db if Path(args.bible_db).exists() else None
        run_test(args.scrape_db, args.book, args.chapter, args.verse, bible_db)
    else:
        for path in (args.bible_db, args.scrape_db):
            if not Path(path).exists():
                print(f"ERROR: {path} not found.")
                sys.exit(1)
        print(f"bible.db:  {args.bible_db}")
        print(f"scrape db: {args.scrape_db}\n")
        run(args.bible_db, args.scrape_db)


if __name__ == "__main__":
    main()
