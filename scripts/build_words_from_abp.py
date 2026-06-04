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

def _split_compounds(rows: list, lex: dict) -> None:
    """
    Redistribute words from compound ABP glosses to subsequent empty-english slots
    using lexicon evidence, then swap position numbers so redistributed words
    display before the verb/head word.

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

        own_def = lex.get(sbase, set())
        gloss_words = eng.split()

        ahead = []
        for j in range(i + 1, len(rows)):
            if rows[j][1]:
                break
            slot_base = rows[j][4]
            if slot_base and slot_base not in ("*", ""):
                # Never redistribute a gloss word INTO a FUNCTION-word slot. Their
                # short glosses ("the/this/he/of/and") spuriously match words inside
                # legitimate multi-word glosses, so the matcher pulls e.g. "this" out
                # of "of this possession" into the οὗτος(G3778) slot and fronts it →
                # "this of possession". Only CONTENT slots (verb/noun/adjective per
                # morph) legitimately receive a redistributed (object) word.
                #   - copula εἰμί (base 1510, morph V) is content-POS but must also be
                #     excluded — extracting "is" from "he is a prophet" and fronting it
                #     gives "is he a prophet" (facet a). Explicit, morph-independent.
                #   - when morph is absent (~22%) we fall back to the prior behavior
                #     (allow), guarding only the copula, to avoid over-suppressing
                #     genuine object redistribution.
                slot_morph = rows[j][11] or ""
                if slot_base == "1510":
                    continue
                if slot_morph and slot_morph[:1] not in ("V", "N", "A"):
                    continue
                ahead.append((j, slot_base, lex.get(slot_base, set())))

        if not ahead:
            continue

        taken: dict = {}
        own = []

        for word in gloss_words:
            norm = _NORM.sub("", word).lower()
            if not norm:
                own.append(word)
                continue
            if norm in own_def:
                own.append(word)
                continue
            for j, slot_base, slot_def in ahead:
                if j in taken:
                    continue
                if slot_def and norm in slot_def:
                    taken[j] = word
                    break
            else:
                own.append(word)

        if not taken:
            continue

        # Assign english + inherit bracket_id, abp_pos, and gpos from source.
        # gpos (the position number superscript) moves to the first chip of the
        # compound so it displays before the first visible word.
        src_gpos    = rows[i][5]
        src_bid     = rows[i][6]
        src_abp_pos = rows[i][10]
        for j, word in taken.items():
            r = rows[j]
            # slot j keeps its OWN morph/lemma (r[11]/r[12]) — only the english moved in
            rows[j] = (r[0], word, word, r[3], r[4], src_gpos, src_bid, r[7], r[8], r[9],
                       src_abp_pos, r[11], r[12])

        new_eng = " ".join(own) if own else None
        rows[i] = (pos_i, new_eng, _head_word(new_eng) if new_eng else None,
                   strongs, sbase, None, bid, italic, iw, sw, abp_pos_i, morph_i, lemma_i)

        for j in sorted(taken.keys()):
            p_i, p_j = rows[i][0], rows[j][0]
            rows[i] = (p_j,) + rows[i][1:]
            rows[j] = (p_i,) + rows[j][1:]

    rows.sort(key=lambda r: r[0])


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
            # at INSERT time (see _prefix_base in main). Do NOT prefix here or the
            # internal matching against lex/bh bare keys breaks.
            strongs = raw_strongs[1:]
            sbase   = strongs.split(".")[0]
            gpos, iw, sw = bh_lookup(bh_rows, used, sbase, normalize(english))

        # For bracketed words with no BH gpos (e.g. proper nouns), fall back to
        # the ABP position number so the number still displays on the chip.
        if gpos is None and abp_pos is not None:
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

    # Strip temporary abp_pos (idx 10); keep morph (11) + lemma (12) as the last two columns.
    return [r[:10] + (r[11], r[12]) for r in rows]


# ── Run / test ────────────────────────────────────────────────────────────────

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

    def _prefix_base(w):
        """Restore the 'G' on strongs_base, and drop orphan greek_pos, at INSERT.

        (1) The ABP source is Greek-only; the parser strips the 'G' so internal
        lex/BH matching can compare bare numbers. The DB invariant, however, is
        that words.strongs_base is fully G-prefixed (e.g. 'G2206') — the lexicon
        join does SUBSTR(strongs_base, 2), which shaves a *digit* off a bare
        number and resolves the wrong lemma. The bare `strongs` column (idx 3)
        is intentionally left as-is (frontend renders it as G{strongs}). '*'
        (proper-noun placeholder) and '' (no strongs) pass through untouched.

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
