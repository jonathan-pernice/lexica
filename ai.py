#!/usr/bin/env python3
"""AI natural-language search (Phase 3 of REDESIGN_PLAN.md).

The two-pass Haiku pipeline behind /api/ai-search: pass 1 generates SQL (with an
LSJ lexical-context preamble), pass 2 curates the strongest verses. Owns the AI
system prompt, the proper-noun / divine-council / verse-ref helpers, the curation
prompt, and the persistent AI result cache (core._ai_cache + ai_search_cache rows
keyed by a version hash).

NOTE: the three `SUBSTR(w.strongs_base, 2)` examples inside _AI_SYSTEM_TMPL are
LEFT AS-IS — they're illustrative SQL for Haiku, and changing them alters AI
output + busts the prompt cache (the Phase-1 SUBSTR removal's separate follow-up).

Imports _lsj_concept_lookup/_format_lsj_context from views_lsj and
_XREF_SYNTHESIS_SYSTEM from views_crossref (their primary-consumer homes).
"""
import json
import re
import traceback

from flask import Blueprint, jsonify, request

from core import (
    log, db, db_ro, _anthropic, limiter, _FUNCTION_STRONGS,
    _serialize_word_core, _clean_gloss, _ai_cache, _KJV_BOOK_ID,
    ai_fingerprint, ai_cache_put, ai_cache_prune,
)
from views_lsj import _lsj_concept_lookup, _format_lsj_context
from views_crossref import _XREF_SYNTHESIS_SYSTEM

bp = Blueprint("ai", __name__)


# @@CORPUS_LIST@@  — comma-separated full book names, e.g. "Genesis, Exodus, …"
# @@SCHEMA_BOOKS@@ — schema comment listing abbrev→name pairs
_AI_SYSTEM_TMPL = """\
You are a Berean textual analyst for a SQLite database of the Apostolic Bible Polyglot (ABP) — \
a Greek interlinear covering both the Septuagint (OT) and New Testament. \
The corpus spans @@CORPUS_LIST@@. Your role is to help \
users study what the Greek text actually says — before any later theological framework is applied.

─── APPROACH ────────────────────────────────────────────────────────────────
Report what the Greek and Hebrew words actually say. Give the full semantic range
of key terms. Every sentence must be grounded in the text.
Never assert what a passage "marks", "represents", "signals", or "shows" about \
historical development, liturgical change, or the shift from one practice to another. \
Those are theological interpretations imposed from outside the text. Report only what \
the cited words and phrases directly state.

─── DATABASE SCHEMA ─────────────────────────────────────────────────────────
  verses(id, book TEXT, chapter INTEGER, verse INTEGER)
        -- @@SCHEMA_BOOKS@@
  words(id, verse_id, position INTEGER,
        english TEXT,       -- full ABP gloss, e.g. "my spirit", "of God"
        english_head TEXT,  -- core word, e.g. "spirit", "God"
        strongs TEXT,       -- exact ABP number: "4151", "1510.7.3", or "*"
        strongs_base TEXT)  -- base without dots: "1510"
  lexicon(strongs TEXT PK,  -- matches words.strongs_base
          lemma, translit, strongs_def, kjv_def, derivation)

─── DOTTED STRONG'S VARIANTS ────────────────────────────────────────────────
The ABP assigns dotted sub-numbers to lexically distinct words that share a base:
  G1095   γίγας  giant (base form)
  G1095.1 γίγας  a specific giant variant (distinct lexical entry)
strongs_base always strips the decimal — both map to strongs_base='1095'.
To target a specific dotted variant, filter on w.strongs (the exact field):
  WHERE w.strongs = '1095.1'     -- only the dotted variant
  WHERE w.strongs_base = '1095'  -- all variants sharing the base
The LSJ LEXICAL CONTEXT block lists dotted variants present in the corpus.
Prefer the specific dotted variant when the query targets a distinct concept.
Never invent dotted numbers — only use ones listed in the LSJ context block.
IMPORTANT: strongs_base is stored inconsistently — some rows use the bare number
('4151'), others use the prefixed form ('G4151'). Always match both:
  WHERE (w.strongs_base = '4151' OR w.strongs_base = 'G4151')

─── LSJ LEXICAL CONTEXT ─────────────────────────────────────────────────────
Each query is prepended with an "LSJ LEXICAL CONTEXT" block listing relevant Greek
lemmas and Strong's numbers drawn live from the Liddell-Scott-Jones lexicon.
Use those G-numbers in SQL WHERE clauses against strongs_base (or w.strongs
for dotted variants). Never invent or guess Strong's numbers not provided in
the LSJ context block.

─── NEW TESTAMENT COVERAGE ──────────────────────────────────────────────────
NT books (Matthew through Revelation) are fully indexed with the same Strong's
numbering system. For any thematic query, generate SQL that covers BOTH OT and
NT — do NOT add WHERE v.book IN (...) filters unless the query is explicitly
book-specific. The LSJ LEXICAL CONTEXT block will provide G-numbers valid for
both testaments. Key NT equivalents the context block may include:
  G5207 huios   — son (divine sonship: OT + NT)
  G5043 teknon  — child/children of God (Pauline and Johannine letters)
  G4151 pneuma  — spirit/breath (OT ruach; NT holy spirit)
  G4102 pistis  — faith (throughout Pauline corpus)
  G26   agapē   — love (1 Cor 13, 1 Jn 4)
  G32   angelos — messenger/angel (both testaments)
  Divine council / bene elohim: ALWAYS include BOTH Hebrew AND Greek numbers —
    H1121 (ben/sons) + H430 (elohim/gods) for Hebrew; G5207 (huios) + G2316 (theos)
    for the LXX/ABP rendering. Also H5475 (sod/council), H5712 (edah/assembly),
    H4150 (moed/appointed assembly). The ABP primary verses use G-numbers so both
    must appear in key_strongs for highlighting to work.
Always UNION OT and NT patterns when a concept spans both corpora.

WORD-FORM / TESTAMENT SPLITS — some concepts use a different Strong's number in OT vs NT
because the ABP tags noun and verb/adjective forms separately:
  Anointed/Christ: G5547 (Christos, OT: 39 + NT: 565) covers the title "anointed one"
    in BOTH testaments (LXX kings/priests + NT Christ). G5548 (chrio, OT: 75) is the
    OT verb "to anoint". For thematic "anointed/messiah" searches, G5547 covers both;
    to find the anointing action in OT, add G5548.
  Inheritance/Heir: G2817 (kleronomia/inheritance, OT: 181) vs G2818 (kleronomos/heir,
    NT: 15). OT uses the noun "inheritance"; NT shifts to the relational "heir". Include
    both for cross-testament inheritance/heir searches.
  Darkness (Johannine): G4653 (skotia, NT: 16) is the noun John uses for "darkness";
    G4652 (skoteinos/dark adj, OT: 13) is OT-heavy. For John's "darkness vs light"
    theme, G4653 is the correct number.

─── OUTPUT FORMAT ───────────────────────────────────────────────────────────
This is a search interface, not a conversation. ALWAYS return the JSON below.
Never ask the user for clarification.
If a query is ambiguous, make reasonable assumptions and generate the broadest
relevant SQL that covers the likely intent.

If a query is completely unrelated to the Greek Bible (e.g. recipes, weather, math,
sports, general knowledge with no biblical angle), return this instead:
{
  "out_of_scope": true,
  "explanation": "one sentence saying this tool searches the Greek Bible corpus"
}
When in doubt, generate SQL — do not return out_of_scope. Broad or abstract biblical
queries ("how is God described", "what does the Bible say about love", "God's nature")
are valid: make reasonable assumptions, pick the most relevant Strong's numbers, and
generate the broadest useful SQL. Only return out_of_scope for queries with no
biblical angle whatsoever.

Otherwise return ONLY valid JSON, no markdown, no prose outside the JSON:
{
  "explanation": "...",
  "sql": "SELECT ...",
  "key_strongs": ["4102", "26"]
}

explanation — 2–3 sentences written as a scholar, not as a search engine.
Start immediately with the Greek or Hebrew term and what it means. Never begin
with "This query", "This search", "The results", "The passages", or any sentence
that describes what the system did. Pretend you are writing a lexicon note.
Be specific — cite key passages by reference, name the semantic range concretely,
and explain what the text actually says. Do not write vague generalities.

GOOD: "Pneuma (G4151) in Genesis spans breath, wind, and divine spirit — the LXX
rendering of ruach (H7307). At Gen 1:2 the spirit moves over the waters; at Gen
6:3 God's pneuma strives with humanity; at Gen 41:8 Pharaoh's pneuma is troubled.
The word unifies physical breath and divine agency under one term."
BAD:  "This query searches for pistis across Paul's letters..."
BAD:  "Pneuma appears in the creation account and descriptions of divine action." (too vague)

You MUST mention every term in key_strongs by its Greek or Hebrew lemma or
transliteration. Every Greek or Hebrew term you discuss MUST appear in key_strongs.
Focus on: lexical range of key terms, specific passages, interpretive translation
choices. For translation comparison queries, name translations directly
(KJV, ABP, LXX) and state differences concisely.
key_strongs — up to 10 Strong's numbers central to the query (up to 6 Greek, up to 4
Hebrew). For OT concepts, include both the Greek G-number (ABP) and the Hebrew H-number
(BDB) — e.g. a "spirit in Genesis" query should cite both G4151 (pneuma) and H7307
(ruach). Give Greek and Hebrew equal priority; do not omit one just because the
explanation focuses on the other. Use "H" prefix for Hebrew, "G" prefix or bare digits
for Greek. Omit particles, articles, prepositions, and other function words.

sql — SELECT only. Never INSERT, UPDATE, DELETE, DROP.
Proper nouns (people, places) are tagged strongs = '*' — no Strong's number exists.
Match them with english LIKE or english_head LIKE. Examples:
  WHERE w.english LIKE '%Paul%'
  WHERE w.english LIKE '%Corinth%' OR w.english LIKE '%Ephesus%'
  WHERE w.english LIKE '%Paul%' AND v.id IN (
      SELECT verse_id FROM words WHERE strongs_base = '4198')  -- travel + Paul
For purely proper-noun queries (e.g. "where did Paul travel"), the WHERE clause
MUST use english LIKE — a strongs_base filter alone will return nothing.
For geographical queries (e.g. "places in Acts", "cities Paul visited"), query
strongs_base = '*' to get all proper nouns, optionally filtered by book:
  WHERE v.book = 'Act' AND w.strongs_base = '*' AND w.english IS NOT NULL
This returns all named people, places, and groups in that book.
Function words (articles,
prepositions, conjunctions) are filtered from highlighting automatically by LSJ
part-of-speech data — include them freely in SQL without concern. Return exactly:
  w.strongs_base, w.strongs, w.english, w.english_head,
  v.book, v.chapter, v.verse,
  l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
JOIN: words w JOIN verses v ON w.verse_id = v.id
      LEFT JOIN lexicon l ON l.strongs = SUBSTR(w.strongs_base, 2)
End:  ORDER BY v.id, w.position   LIMIT 500

GENITIVE PHRASES ("sons of God", "son of man", "word of God") — the ABP stores
the genitive relationship inside a single word's english gloss (e.g. "sons of God"
appears as one entry). Use english LIKE on the exact phrase:
  WHERE w.english LIKE '%sons of God%' OR w.english LIKE '%son of God%'
  WHERE w.english LIKE '%word of God%'
  WHERE w.english LIKE '%son of man%'
This prevents false positives from Strong's co-occurrence (G5207 + G2316 matches
any verse with both "son" and "God" regardless of relationship, flooding results
with "sons of Israel", genealogies, etc.).

ADJECTIVE + NOUN PHRASES ("holy spirit", "living water", "eternal life") — each
word is a separate DB row, so english LIKE on the full phrase will match nothing.
Use Strong's numbers instead:
  G4151 (pneuma/spirit) + G39 or G40 (hagios) for holy spirit — the ABP tags
  "holy" in "holy spirit" as G39 in NT and G40 in OT; always check both:
    AND v.id IN (SELECT verse_id FROM words WHERE strongs_base IN ('39','40'))
  G2222 (zōē/life) + G166 (aiōnios/eternal) for eternal life
Never apply the LIKE approach to adjective+noun combinations.

When two NON-PHRASE concepts must appear TOGETHER in the same verse, enforce
co-occurrence with a subquery — do not rely on post-filtering:
  WHERE w.strongs_base = '5207'
    AND v.id IN (SELECT verse_id FROM words WHERE strongs_base = '2316')

When a concept has multiple lexical realizations, write a UNION ALL covering all
patterns. Each branch should enforce its own co-occurrence via subquery where
relevant. Every branch must select the same columns above; omit both ORDER BY and
LIMIT on UNION queries — the server wraps them in a subquery and handles ordering.

AND/OR PRECEDENCE — CRITICAL: AND binds before OR. Never write:
  WHERE clause_a OR clause_b AND v.book IN (...)  -- WRONG: filter only applies to clause_b
Always either wrap OR clauses in parentheses:
  WHERE (clause_a OR clause_b) AND v.book IN (...)  -- CORRECT
Or use UNION ALL with the book filter in each branch:
  SELECT ... WHERE clause_a AND v.book IN (...)
  UNION ALL
  SELECT ... WHERE clause_b AND v.book IN (...)

─── KJV + HEBREW TABLES ─────────────────────────────────────────────────────
You also have access to KJV verse text and word-level Strong's data:

  kjv_verses(verse_id, book_id, chapter, verse_num, verse_text)
      Full KJV verse text, 31,102 verses. book_id matches the books table.

  kjv_words(word_id, book_id, chapter, verse_num, verse_pos, word, italic)
      Every KJV word tokenized with position. italic=1 means the word was
      added by translators with no corresponding source word.

  kjv_strongs(word_id, strongs_id)
      Links each KJV word to its Strong's number. G-numbers for NT, H-numbers
      for OT.

  bdb(strongs_id, lemma, xlit, pronounce, description, part_of_speech)
      Brown-Driver-Briggs Hebrew lexicon, 8,674 entries, H-numbers only.

HEBREW WORD SEARCH — for queries about a specific Hebrew word (by name, transliteration,
or meaning), find its H-number via bdb then bridge to ABP verses using the books table
(books.id = kjv_words.book_id = kjv_verses.book_id):

  SELECT w.strongs_base, w.strongs, w.english, w.english_head,
         v.book, v.chapter, v.verse,
         l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
  FROM words w
  JOIN verses v ON w.verse_id = v.id
  LEFT JOIN lexicon l ON l.strongs = SUBSTR(w.strongs_base, 2)
  JOIN books bk ON bk.abbrev = v.book
  WHERE (bk.id, v.chapter, v.verse) IN (
      SELECT kw.book_id, kw.chapter, kw.verse_num
      FROM kjv_strongs ks
      JOIN kjv_words kw ON kw.word_id = ks.word_id
      WHERE ks.strongs_id = (
          SELECT strongs_id FROM bdb WHERE xlit LIKE '%hesed%' LIMIT 1
      )
  )
  ORDER BY v.id, w.position LIMIT 500

  Substitute the bdb subquery with the relevant transliteration or lemma pattern,
  or use a known H-number directly (e.g. ks.strongs_id = 'H2617').
  Use xlit for transliterations (chesed, ruach, shalom), lemma for Hebrew script.

  cross_references(id INTEGER, verse_id INTEGER, verse_ref_id INTEGER)
      Torrey's Treasury of Scripture Knowledge — thematic cross-references.
      Both columns reference kjv_verses.verse_id (not ABP verses.id).
      Use this table at your own judgment when a query would benefit from
      cross-testament thematic connections. Do not use it for focused
      single-word lexical queries where it would add noise.
      Example — passages cross-referenced to John 3:16 (book_id=43):
        SELECT kv.book_id, kv.chapter, kv.verse_num, kv.verse_text
        FROM cross_references cr
        JOIN kjv_verses kv ON kv.verse_id = cr.verse_ref_id
        WHERE cr.verse_id = (SELECT verse_id FROM kjv_verses
                             WHERE book_id=43 AND chapter=3 AND verse_num=16)

TRANSLATION COMPARISON queries:
  To compare KJV vs ABP renderings of a concept or word:
  1. Find the relevant Strong's number(s) from the lexicon table.
  2. Join kjv_strongs + kjv_words to filter to verses where the KJV rendering
     differs from ABP, using LOWER(w.english_head) != LOWER(kw.word).
  3. Always return the standard column set — the server requires these exact
     columns to display results. Use the KJV word as a JOIN filter, not a
     selected column.
  Put the comparison analysis in the explanation field, not the SQL shape.

  For open-ended comparison queries (e.g. "what stands out as differences
  in Acts KJV vs ABP"): find where the same Strong's numbers produced
  different English words, surface patterns, and flag anything theologically
  significant. Use this join pattern:

  SELECT w.strongs_base, w.strongs, w.english, w.english_head,
         v.book, v.chapter, v.verse,
         l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
  FROM words w
  JOIN verses v ON w.verse_id = v.id
  LEFT JOIN lexicon l ON l.strongs = SUBSTR(w.strongs_base, 2)
  JOIN kjv_strongs ks ON ks.strongs_id = 'G' || w.strongs_base
  JOIN kjv_words kw
    ON kw.word_id = ks.word_id
   AND kw.book_id = (SELECT id FROM books WHERE abbrev = v.book)
   AND kw.chapter = v.chapter
   AND kw.verse_num = v.verse
  WHERE v.book = 'Act'
    AND (w.strongs_base = '4151' OR w.strongs_base = 'G4151')
    AND LOWER(w.english_head) != LOWER(kw.word)
  ORDER BY v.id, w.position LIMIT 500

  For OT questions involving Hebrew: use kjv_strongs to get the H-number,
  then look it up in bdb for the Hebrew definition and lemma.\
"""

_AI_SYSTEM_BUILT: str | None = None


def _get_ai_system() -> str:
    global _AI_SYSTEM_BUILT
    if _AI_SYSTEM_BUILT is not None:
        return _AI_SYSTEM_BUILT
    conn = db()
    try:
        rows = conn.execute(
            "SELECT abbrev, name FROM books ORDER BY id"
        ).fetchall()
    finally:
        conn.close()

    names   = [r[1] for r in rows]
    abbrevs = [r[0] for r in rows]

    if len(names) == 1:
        corpus_list = names[0]
    else:
        corpus_list = ", ".join(names[:-1]) + ", and " + names[-1]

    schema_books = ", ".join(f'"{a}" ({n})' for a, n in zip(abbrevs, names))

    _AI_SYSTEM_BUILT = (
        _AI_SYSTEM_TMPL
        .replace("@@CORPUS_LIST@@", corpus_list)
        .replace("@@SCHEMA_BOOKS@@", schema_books)
    )
    log.debug("Built AI system prompt for books: %s", abbrevs)
    return _AI_SYSTEM_BUILT

# Words that start with a capital but are NOT proper nouns for the english LIKE fallback.
# Theological terms with Strong's numbers (God, Lord, Jesus, Christ) are excluded because
# they appear in thousands of verses and are already handled by the AI's strongs_base SQL.
_PROPER_NOUN_STOP = frozenset({
    "The", "A", "An", "In", "Of", "To", "And", "Or", "But", "With",
    "For", "At", "By", "From", "Where", "When", "What", "Who", "How",
    "Why", "Did", "Does", "Do", "Is", "Are", "Was", "Were", "Has",
    "Have", "Had", "Will", "Would", "Could", "Should", "May", "Might",
    "Show", "Find", "Get", "Tell", "Give", "Let", "Make", "Take",
    "All", "His", "Her", "Its", "Our", "Their", "My", "Your",
    "This", "That", "These", "Those", "There", "Here", "Then",
    "He", "She", "It", "We", "They", "You", "Me", "Him", "Her",
    "God", "Lord", "Jesus", "Christ",
})


def _extract_proper_nouns(q: str) -> list[str]:
    """Return deduplicated capitalized words that look like proper nouns."""
    seen: set[str] = set()
    result: list[str] = []
    for w in re.findall(r'\b[A-Z][a-z]{2,}\b', q):
        if w not in _PROPER_NOUN_STOP and w not in seen:
            seen.add(w)
            result.append(w)
    return result


# Divine council corpus — injected as primary when query matches.
# Bypasses Haiku curation so results are deterministic regardless of SQL.
_DIVINE_COUNCIL_VERSES: frozenset = frozenset({
    ("Gen",  1, 26), ("Gen",  3, 22), ("Gen",  6,  2), ("Gen",  6,  4), ("Gen", 11,  7),
    ("Deu", 32,  8), ("Deu", 32, 43),
    ("1Ki", 22, 19), ("1Ki", 22, 20),
    ("Job",  1,  6), ("Job",  2,  1),
    ("Psa", 29,  1), ("Psa", 82,  1), ("Psa", 82,  6), ("Psa", 89,  5), ("Psa", 89,  7),
    ("Isa",  6,  1), ("Isa",  6,  8),
    ("Zec",  3,  1), ("Zec",  3,  2),
})


# Triggers the hardcoded divine council corpus injection.
# Deliberately narrow — only phrases that unambiguously signal a divine council
# query. Broad terms like "sons of God", "holy ones", "divine being" are excluded
# because they appear in NT adoption theology, Pauline letters, etc. and should
# be answered by the normal SQL path, not overridden by the OT corpus.
_DIVINE_COUNCIL_RE = re.compile(
    r'\b(?:divine\s+council|heavenly\s+(?:assembly|court)|divine\s+assembly|'
    r'bene\s+[ae]lohim|elohim\s+council|council\s+of\s+(?:god|the\s+holy)|'
    r'gods?\s+of\s+the\s+nations?|host\s+of\s+heaven|huioi?\s+tou\s+theou)\b',
    re.IGNORECASE,
)

# Normalise raw book strings (from AI output or regex captures) to DB abbreviations.
_BOOK_NORM: dict[str, str] = {
    "gen": "Gen", "genesis": "Gen",
    "exo": "Exo", "exod": "Exo", "exodus": "Exo",
    "lev": "Lev", "leviticus": "Lev",
    "num": "Num", "numbers": "Num",
    "deu": "Deu", "dtn": "Deu", "deut": "Deu", "deuteronomy": "Deu",
    # DB abbreviation doesn't match title()[:3] for these two books
    "jud": "Jdg", "judg": "Jdg", "judges": "Jdg",
    "rut": "Rth", "ruth": "Rth",
}

_VERSE_REF_RE: re.Pattern | None = None

# Parses "Book Ch:V" refs from AI-generated text (explanation, primary_verses, etc.)
_VERSE_REF_PARSE_RE = re.compile(r'(\w+)\s+(\d+):(\d+)')


def _norm_book(raw: str) -> str:
    key = raw.lower().rstrip(".")
    return _BOOK_NORM.get(key) or _BOOK_NORM.get(key[:3]) or raw.title()[:3]


def _get_verse_ref_re() -> re.Pattern:
    global _VERSE_REF_RE
    if _VERSE_REF_RE is not None:
        return _VERSE_REF_RE
    conn = db()
    try:
        rows = conn.execute("SELECT re_alt FROM books ORDER BY id").fetchall()
    finally:
        conn.close()
    alts = [r[0] for r in rows]
    _VERSE_REF_RE = re.compile(
        r'\b(' + '|'.join(alts) + r')\s+(\d+):(\d+)\b',
        re.IGNORECASE,
    )
    log.debug("Built _VERSE_REF_RE from books table: %s", alts)
    return _VERSE_REF_RE


def _fetch_verse_words(conn, verse_id: int) -> list[dict]:
    """Return the full word list for a verse, used when fetching cited/primary verses."""
    wrows = conn.execute(
        """SELECT w.strongs_base, w.strongs, w.english, w.english_head, w.greek_pos,
                  w.bracket_id, w.italic, w.is_pn,
                  COALESCE(w.italic_words, '') AS italic_words,
                  l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
           FROM words w
           LEFT JOIN lexicon l ON l.strongs_g = w.strongs_base
           WHERE w.verse_id = ?
             AND w.english IS NOT NULL AND w.english != ''
             AND w.strongs_base != '*'
           ORDER BY w.position""",
        (verse_id,),
    ).fetchall()
    return [
        {
            **_serialize_word_core(wr),
            "italic":       bool(wr["italic"]),
            "is_function":  wr["strongs_base"] in _FUNCTION_STRONGS,
            "gloss":        _clean_gloss(wr["english"]),
            "strongs_def":  (wr["strongs_def"] or "").strip(),
            "derivation":   (wr["derivation"] or "").strip(),
        }
        for wr in wrows
    ]


_CURATION_SYSTEM = """\
You are selecting primary evidence verses for a word study of the Greek Bible (OT + NT).
Return ONLY valid JSON — no prose, no markdown:
{
  "primary_verses": ["Book Ch:V", ...],
  "additional_verses": ["Book Ch:V", ...]
}

─── STEP 1: IDENTIFY THE REFERENT ──────────────────────────────────────────
Before selecting any verses, determine exactly which referent the query targets.
The same Greek words can denote completely different concepts; conflating them
produces misleading results. Apply these rules:

SINGULAR vs PLURAL sonship
  "Son of God" (singular, title-case, or clearly Christological context)
      → Jesus specifically: baptism voice, transfiguration, trial confession,
        Johannine "I am" discourse, messianic declarations.
      → EXCLUDE verses where huios/teknon refers to believers or heavenly beings.
  "sons of God" / "children of God" (plural, or adoptionist context)
      → Believers (NT adoption: Rom 8:14–17, Gal 3:26, 1 Jn 3:1–2) AND/OR
        divine/heavenly beings (Gen 6:2–4, Job 1:6, 2:1, Psa 82:6, Deu 32:8).
      → EXCLUDE Christological title verses (Jesus declared Son of God at baptism
        or trial) unless the query explicitly asks about Jesus.
      → EXCLUDE verses where the referent is "sons of Israel", "son of man",
        "sons of Aaron", "sons of Levi", "sons of men", or any other "sons of X"
        construct where X is not God. These share the same Strong's numbers but
        are entirely different concepts — discard them regardless of how many
        matching words appear in the verse.

DIVINE COUNCIL vs GENERAL SONSHIP
  "divine council" / "heavenly assembly" / "bene ha-elohim"
      → OT supernatural assembly (Job 1–2, Psa 82, Deu 32, 1 Ki 22:19–22).
      → EXCLUDE NT adoption theology and Christological passages entirely.
  General "sons of God" without divine-council framing
      → Draw from both OT (divine beings) and NT (adoption) unless the query
        limits scope (e.g. "in the NT" → NT only; "in Genesis" → OT only).

HOLY SPIRIT / SPIRIT OF GOD
  "Holy Spirit" or "Spirit of God" as divine person/presence
      → Prioritise programmatic passages: Acts 2 (Pentecost), John 14–16
        (Paraclete/G3875), Rom 8 (adoption + intercession), Gen 1:2 (hovering).
      → EXCLUDE verses where pneuma refers merely to human breath or disposition.

Apply this referent identification first; then select primary verses only from
the matching pool, discarding verses that belong to a different referent class.

FALLBACK: If the referent filter leaves fewer than 5 qualifying verses, discard
the filter entirely and select from the full verse pool. The goal is to narrow
and prioritize, not to eliminate results. Never return an empty primary_verses
list when the verse pool is non-empty.

─── STEP 2: SELECT PRIMARY VERSES ──────────────────────────────────────────
Select from the verse list provided. The user message specifies the target count.
Rank candidates in this priority order:

1. FOUNDATIONAL / PROGRAMMATIC — verses that introduce, define, or establish the
   concept in canonical theology. Include these even if vocabulary density is low.
   e.g. Acts 2 for the Holy Spirit at Pentecost; John 14–16 for the Paraclete;
   Rom 8 for Spirit and adoption; Deu 32:8 for divine allotment; Gen 1:26 for
   the divine plural. These belong in primary regardless of how many matching
   Strong's numbers appear in the verse.

2. THEOLOGICALLY CENTRAL — verses scholars and students invariably cite for this
   topic. For NT themes prefer John, Acts, Romans, Galatians, Hebrews anchor
   texts over incidental mentions in shorter letters, unless the shorter letter
   passage is itself definitional (e.g. Gal 4:6 for divine sonship).

3. GRAMMATICALLY PROMINENT — the concept is the grammatical subject, object, or
   predicate; it acts, is described, named, qualified, or placed in a
   theologically significant relationship.

4. FUNCTIONALLY SIGNIFICANT — the concept performs a key role (intercession,
   governance, identity-marking) even if not the main subject.

CRITICAL: Do NOT preference verses on lexical density alone. A foundational verse
with one occurrence of the key term outranks a verbose passage where the term
appears incidentally three times. Frequency of matching words within a single
verse is not a proxy for theological importance.

Exclude ONLY when the word has zero bearing on the topic: a personal name in an
unrelated genealogy, a bare preposition or particle, a place name, or a pure
counting formula where the word is grammatical filler.

─── additional_verses ───────────────────────────────────────────────────────
List verse refs (Book Ch:V) that are standard scholarly citations for this topic
but were NOT in the verse list provided. Use ONLY when:
  • Scholarly consensus is strong that the verse belongs in this study, AND
  • The connection is inferred from context or implicit language rather than
    explicit vocabulary.
If the verse list already covers the topic well, return additional_verses as [].
Prefer empty over speculative.\
"""


def _curate_primary_verses(
    query: str, results: list[dict]
) -> tuple[list[str], list[str]]:
    """Pass 2: send actual verse texts to Haiku.

    Returns (primary_refs, additional_refs). primary_refs are curated from the
    SQL results; additional_refs are scholarly additions from Haiku's training
    knowledge that the SQL query missed (capped at 12, caller validates against DB).
    """
    if not results or not _anthropic:
        return [], []

    # Scale input window and primary target with result pool size.
    n = len(results)
    if n >= 200:
        input_cap, primary_cap = 60, 15
    elif n >= 100:
        input_cap, primary_cap = 50, 12
    elif n >= 50:
        input_cap, primary_cap = 40, 10
    else:
        input_cap, primary_cap = max(n, 1), 8

    capped = results[:input_cap]
    if capped:
        or_parts = " OR ".join(
            "(v.book=? AND v.chapter=? AND v.verse=?)" for _ in capped
        )
        params = [x for v in capped for x in (v["book"], v["chapter"], v["verse"])]
        conn = db_ro()
        try:
            wrows = conn.execute(
                f"""SELECT v.book, v.chapter, v.verse, w.english
                    FROM words w JOIN verses v ON w.verse_id = v.id
                    WHERE ({or_parts})
                      AND w.english IS NOT NULL AND w.english != ''
                    ORDER BY v.id, w.position""",
                params,
            ).fetchall()
        finally:
            conn.close()

        texts: dict[str, list[str]] = {}
        for r in wrows:
            ref = f"{r['book']} {r['chapter']}:{r['verse']}"
            texts.setdefault(ref, []).append(r["english"])
        verse_list = "\n".join(
            f"{ref}: {' '.join(words)[:300]}" for ref, words in texts.items()
        )
    else:
        verse_list = ""

    try:
        msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            temperature=0,
            system=_CURATION_SYSTEM,
            messages=[{
                "role": "user",
                "content": f"Query: {query}\nSelect up to {primary_cap} primary verses.\n\nVerses:\n{verse_list}",
            }],
        )
        raw = msg.content[0].text.strip()
        s, e = raw.find("{"), raw.rfind("}")
        parsed = json.loads(raw[s:e + 1]) if s != -1 and e > s else {}
        primary    = [str(r) for r in parsed.get("primary_verses", [])][:primary_cap]
        additional = [str(r) for r in parsed.get("additional_verses", [])][:12]
        return primary, additional
    except Exception as exc:
        log.warning("Pass-2 curation failed: %s", exc)
        return [], []


def _enrich_explanation_with_cross_refs(
    query: str, results: list[dict], explanation: str
) -> str:
    """Generate a cross-ref-enriched explanation. Only called when result count ≤ 10."""
    if not _anthropic:
        return explanation
    conn = db_ro()
    try:
        verse_ids: list[int] = []
        verse_texts: list[str] = []
        for v in results[:10]:
            book_id = _KJV_BOOK_ID.get(v["book"])
            if book_id is None:
                continue
            row = conn.execute(
                "SELECT verse_id, verse_text FROM kjv_verses"
                " WHERE book_id=? AND chapter=? AND verse_num=?",
                (book_id, v["chapter"], v["verse"]),
            ).fetchone()
            if row:
                verse_ids.append(row["verse_id"])
                verse_texts.append(
                    f"{v['book']} {v['chapter']}:{v['verse']}: {row['verse_text'][:200]}"
                )
        if not verse_ids:
            return explanation
        ph = ",".join("?" * len(verse_ids))
        xrefs = conn.execute(
            f"""SELECT kv.verse_text, COUNT(*) AS freq
                FROM cross_references cr
                JOIN kjv_verses kv ON kv.verse_id = cr.verse_ref_id
                WHERE cr.verse_id IN ({ph})
                  AND cr.verse_ref_id NOT IN ({ph})
                GROUP BY cr.verse_ref_id
                ORDER BY freq DESC
                LIMIT 5""",
            verse_ids + verse_ids,
        ).fetchall()
    finally:
        conn.close()

    if not xrefs:
        return explanation

    verse_block = "\n".join(verse_texts)
    xref_block  = "\n".join(f"- {r['verse_text'][:200]}" for r in xrefs)
    try:
        msg = _anthropic.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=250,
            temperature=0,
            system=_XREF_SYNTHESIS_SYSTEM,
            messages=[{"role": "user", "content": (
                f"Query: {query}\n\n"
                f"Result verses:\n{verse_block}\n\n"
                f"Related passages from cross-references:\n{xref_block}\n\n"
                "Write a 2-3 sentence synthesis."
            )}],
        )
        return msg.content[0].text.strip()
    except Exception as exc:
        log.warning("Cross-ref enrichment failed: %s", exc)
        return explanation




def _normalize_union_sql(sql: str) -> str:
    """Wrap UNION ALL queries in a subquery so ORDER BY works in SQLite.

    In a SQLite compound select (UNION ALL), ORDER BY cannot reference
    table-qualified names like v.id or w.position because the aliases are out
    of scope. Wrapping in a subquery lets the outer SELECT * pick up all columns
    by their unqualified names and apply a clean ORDER BY.

    No LIMIT is applied to UNION queries: each branch is already scoped to a
    specific concept, so total row count is manageable, and pass-2 curation caps
    the verses it processes at 50. Single-pattern queries keep their own LIMIT.
    """
    if not re.search(r'\bUNION\b', sql, re.IGNORECASE):
        return sql
    # Strip the trailing ORDER BY … LIMIT … that Haiku appends (table-qualified
    # names are invalid in a compound-select context; LIMIT removed deliberately).
    inner = re.sub(
        r'\s+ORDER\s+BY\s+\S.*',
        '',
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    ).rstrip()
    return (
        "SELECT * FROM (\n"
        + inner
        + "\n) ORDER BY book, chapter, verse"
    )


_ai_cache_ver: str | None = None  # computed once from prompt template + book list

# Bump this integer whenever server-side search logic changes in a way that
# affects results but doesn't change _AI_SYSTEM_TMPL (e.g. new fallback steps).
_CACHE_CODE_VER = 25


def _get_ai_cache_ver() -> str:
    """'search:<hash>' over (system prompt template + book list + code version).

    Automatically invalidates the DB cache when books are added, the system
    prompt changes, or _CACHE_CODE_VER is bumped. The 'search:' prefix is the
    unified scheme (core.ai_fingerprint) so each category prunes only its own rows.
    """
    global _ai_cache_ver
    if _ai_cache_ver is not None:
        return _ai_cache_ver
    conn = db()
    try:
        abbrevs = ",".join(
            r[0] for r in conn.execute("SELECT abbrev FROM books ORDER BY id").fetchall()
        )
    finally:
        conn.close()
    _ai_cache_ver = ai_fingerprint(
        "search", _AI_SYSTEM_TMPL, f"books={abbrevs}", f"cv={_CACHE_CODE_VER}"
    )
    return _ai_cache_ver


def _load_ai_cache_from_db() -> None:
    """Populate in-memory cache from DB; delete entries from a different version."""
    ver = _get_ai_cache_ver()
    try:
        conn = db()
        rows = conn.execute(
            "SELECT query, result_json FROM ai_search_cache WHERE ver_key = ?", (ver,)
        ).fetchall()
        for r in rows:
            try:
                _ai_cache[r["query"]] = json.loads(r["result_json"])
            except Exception:
                pass
        conn.close()
        # Prune ONLY this category's stale rows. Each other synthesis (summary, xref,
        # pn) prunes its own at startup, so we no longer carve them out by name here —
        # that old NOT-LIKE list is exactly what would wipe them under the new tags.
        deleted = ai_cache_prune("search", ver)
        log.info(
            "AI cache: loaded %d entries (ver=%s), pruned %d stale",
            len(rows), ver, deleted,
        )
    except Exception as exc:
        log.warning("Could not load AI cache from DB: %s", exc)


def _persist_ai_cache(query: str, payload: dict) -> None:
    """Write a single cache entry to the DB (fire-and-forget; errors are logged only)."""
    ai_cache_put(query, payload, _get_ai_cache_ver())


@bp.route("/api/ai-search")
@limiter.limit("200 per hour")
def ai_search():
    try:
        q = request.args.get("q", "").strip()
        log.debug("ai_search called: q=%r", q)
        if not q:
            return jsonify({"error": "no query"}), 400

        if len(q) > 500:
            return jsonify({"error": "query too long (max 500 chars)"}), 400

        if q in _ai_cache:
            log.debug("ai_search cache hit: q=%r", q)
            return jsonify(_ai_cache[q])

        if not _anthropic:
            return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 500

        # ── Step 1: extract key terms for LSJ lookup ──────────────────────
        log.debug("Step 1: extracting key terms…")
        terms_msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            temperature=0,
            messages=[{"role": "user", "content": (
                "Extract 3–6 key Greek lexical concepts (as simple English words) "
                "to look up in the Liddell-Scott-Jones Greek lexicon for this query. "
                "Include the primary term AND related vocabulary from all major "
                "manifestations of the concept — e.g. for divine beings include both "
                "titles (angel, holy one) and membership/kinship terms (son, child, assembly). "
                "Return ONLY a JSON array of lowercase English strings, "
                "e.g. [\"spirit\",\"breath\"]. No explanation.\n\nQuery: " + q
            )}],
        )
        try:
            terms = json.loads(terms_msg.content[0].text.strip())
            if not isinstance(terms, list):
                terms = []
        except Exception:
            terms = []
        log.debug("Extracted terms: %r", terms)

        # ── Step 2: LSJ concept lookup ────────────────────────────────────
        lsj_entries = _lsj_concept_lookup(terms)
        lsj_context = _format_lsj_context(lsj_entries)
        log.debug("LSJ context (%d entries): %.200s", len(lsj_entries), lsj_context)

        # ── Step 3: SQL generation with LSJ context ───────────────────────
        user_content = f"{lsj_context}\n\nQuery: {q}" if lsj_context else q
        log.debug("Calling Haiku for SQL generation…")
        msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            temperature=0,
            system=[{"type": "text", "text": _get_ai_system(), "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_content}],
        )
        raw = msg.content[0].text.strip() if msg.content else ""
        log.debug("Haiku raw response (stop=%s): %r", msg.stop_reason, raw[:300])

        if not raw:
            log.error("AI returned empty response (stop_reason=%s)", msg.stop_reason)
            return jsonify({"error": "AI returned an empty response — please try again."}), 500

        # Extract the JSON object even if surrounded by prose or fences
        start = raw.find("{")
        end   = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidate = raw[start:end + 1]
        else:
            candidate = raw

        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError as e:
            log.error("AI response not valid JSON: %s\nraw=%r", e, raw)
            return jsonify({"error": "AI response not valid JSON — please try again."}), 500

        if parsed.get("out_of_scope"):
            return jsonify({"out_of_scope": True, "explanation": parsed.get("explanation", "")}), 200

        sql         = _normalize_union_sql((parsed.get("sql") or "").strip())
        explanation = parsed.get("explanation", "")
        log.info("SQL from AI: %s", sql)

        # Extract key_strongs from AI response; fall back to LSJ lookup entries
        # Preserve original H/G prefix from AI before stripping digits
        _ks_raw = parsed.get("key_strongs") or []
        if not isinstance(_ks_raw, list):
            _ks_raw = []
        _ks_pairs_all: list[tuple[str, str | None]] = []
        for s in _ks_raw[:12]:
            s = str(s).strip()
            m = re.match(r'^([GgHh]?)(\d+(?:\.\d+)?)$', s)
            if m:
                orig = m.group(1).upper() if m.group(1) else None
                _ks_pairs_all.append((m.group(2), orig))
        def _is_heb(pair):
            sn, orig = pair
            if orig == "H": return True
            if orig == "G": return False
            return int(sn.split(".")[0]) > 5624
        greek_pairs = [p for p in _ks_pairs_all if not _is_heb(p)][:6]
        hebrew_pairs = [p for p in _ks_pairs_all if _is_heb(p)][:4]
        _ks_pairs = greek_pairs + hebrew_pairs
        if not _ks_pairs:
            _ks_pairs = [(e["strongs"], None) for e in lsj_entries[:6]]
        key_strongs_data: list[dict] = []
        if _ks_pairs:
            ks_conn = db_ro()
            try:
                for sn, orig_prefix in _ks_pairs:
                    # Use AI-provided prefix when present; fall back to range heuristic
                    if orig_prefix:
                        prefix = orig_prefix
                    else:
                        prefix = "H" if int(sn.split(".")[0]) > 5624 else "G"
                    if prefix == "H":
                        row = ks_conn.execute(
                            "SELECT lemma, xlit AS translit FROM bdb WHERE strongs_id = ?",
                            (f"H{sn}",)
                        ).fetchone()
                    else:
                        row = ks_conn.execute(
                            "SELECT lemma, translit, strongs_def, derivation FROM lexicon WHERE strongs = ?", (sn,)
                        ).fetchone()
                        # Fallback: bare number without prefix may be Hebrew — try BDB
                        if not row and not orig_prefix:
                            bdb_row = ks_conn.execute(
                                "SELECT lemma, xlit AS translit FROM bdb WHERE strongs_id = ?",
                                (f"H{sn}",)
                            ).fetchone()
                            if bdb_row:
                                row = bdb_row
                                prefix = "H"
                    if not row:
                        log.debug("key_strongs %s%s not found in DB — dropping", prefix, sn)
                        continue
                    key_strongs_data.append({
                        "strongs_base": sn,
                        "strongs": f"{prefix}{sn}",
                        "lemma":      row["lemma"] or "",
                        "translit":   row["translit"] or "",
                        "definition": (row["strongs_def"] if prefix == "G" else "") or "",
                        "derivation": (row["derivation"]  if prefix == "G" else "") or "",
                    })
            finally:
                ks_conn.close()

        if not re.match(r"^\s*SELECT\b", sql, re.IGNORECASE):
            log.error("AI returned non-SELECT query: %r", sql)
            # Don't echo the generated SQL back to the client (info disclosure).
            return jsonify({"error": "The generated query was invalid — please rephrase and try again."}), 400

        conn = db_ro()
        try:
            rows = conn.execute(sql).fetchall()
        except Exception as e:
            # Log the SQL + DB error server-side only; never return them to the client.
            log.error("SQL execution error: %s\nSQL: %s", e, sql)
            return jsonify({"error": "The search query could not be run — please rephrase and try again."}), 400
        finally:
            conn.close()
        log.debug("SQL returned %d rows", len(rows))

        # ── Retry with broader query if first SQL returned nothing ────────────
        if not rows:
            try:
                retry_msg = _anthropic.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=1200,
                    temperature=0,
                    system=[{"type": "text", "text": _get_ai_system(), "cache_control": {"type": "ephemeral"}}],
                    messages=[
                        {"role": "user", "content": user_content},
                        {"role": "assistant", "content": raw},
                        {"role": "user", "content": (
                            "That SQL returned 0 results. Broaden the approach: "
                            "remove strict co-occurrence subqueries, expand to more "
                            "Strong's numbers via UNION ALL, or fall back to "
                            "english LIKE matching. Return the same JSON format."
                        )},
                    ],
                )
                retry_raw = retry_msg.content[0].text.strip()
                r_start = retry_raw.find("{")
                r_end   = retry_raw.rfind("}")
                if r_start != -1 and r_end > r_start:
                    retry_parsed = json.loads(retry_raw[r_start:r_end + 1])
                    retry_sql = _normalize_union_sql(
                        retry_parsed.get("sql", "").strip()
                    )
                    if re.match(r"^\s*SELECT\b", retry_sql, re.IGNORECASE):
                        retry_conn = db_ro()
                        try:
                            retry_rows = retry_conn.execute(retry_sql).fetchall()
                        except Exception:
                            retry_rows = []
                        finally:
                            retry_conn.close()
                        if retry_rows:
                            rows = retry_rows
                            sql  = retry_sql
                            explanation = retry_parsed.get("explanation", explanation)
                            log.debug("Retry SQL returned %d rows", len(rows))
            except Exception as exc:
                log.warning("AI search retry failed: %s", exc)

        # ── Group word-level rows into one entry per verse ───────────────────
        verse_index = {}
        verse_order = []
        row_keys = rows[0].keys() if rows else []
        has_word_cols = all(c in row_keys for c in ("english", "strongs_base", "strongs"))
        for r in rows:
            try:
                key = (r["book"], r["chapter"], r["verse"])
            except IndexError:
                continue
            if key not in verse_index:
                verse_index[key] = {
                    "ref":     f"{r['book']} {r['chapter']}:{r['verse']}",
                    "book":    r["book"],
                    "chapter": r["chapter"],
                    "verse":   r["verse"],
                    "words":   [],
                }
                verse_order.append(key)
            if not has_word_cols or not r["english"] or r["strongs_base"] == "*":
                continue
            verse_index[key]["words"].append({
                "strongs":      r["strongs"],
                "strongs_base": r["strongs_base"],
                "is_function":  r["strongs_base"] in _FUNCTION_STRONGS,
                "gloss":        _clean_gloss(r["english"]),
                "lemma":        r["lemma"],
                "translit":     r["translit"],
                "strongs_def":  (r["strongs_def"] or "").strip(),
                "kjv_def":      r["kjv_def"],
                "derivation":   (r["derivation"] or "").strip(),
            })

        results = [verse_index[k] for k in verse_order if verse_index[k]["words"]]
        log.debug("Grouped into %d verses", len(results))

        # ── Fetch verses cited in the explanation that SQL missed ─────────────
        cited_keys: set = set()
        for book_raw, chap_str, verse_str in _get_verse_ref_re().findall(explanation):
            cited_keys.add((_norm_book(book_raw), int(chap_str), int(verse_str)))

        if cited_keys:
            cited_conn = db_ro()
            new_cited = []
            try:
                for key in cited_keys:
                    if key in verse_index:
                        continue
                    book, chapter, verse_num = key
                    vrow = cited_conn.execute(
                        "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                        (book, chapter, verse_num),
                    ).fetchone()
                    if not vrow:
                        continue
                    words = _fetch_verse_words(cited_conn, vrow["id"])
                    if words:
                        verse_index[key] = {
                            "ref": f"{book} {chapter}:{verse_num}",
                            "book": book, "chapter": chapter, "verse": verse_num,
                            "words": words,
                        }
                        new_cited.append(key)
                        log.debug("Cited verse fetched: %s %d:%d", book, chapter, verse_num)
            finally:
                cited_conn.close()
            if new_cited:
                results = [verse_index[k] for k in new_cited] + results

        # ── Step 3.5: Proper noun supplement (english LIKE fallback) ─────────
        # Proper nouns in ABP are tagged strongs='*' and invisible to Strong's-based SQL.
        # Extract capitalized words from the query and query the english field directly,
        # adding any new verses to the result pool before pass-2 curation.
        proper_nouns = _extract_proper_nouns(q)
        if proper_nouns:
            like_clauses = " OR ".join("w.english LIKE ?" for _ in proper_nouns)
            pn_sql = f"""
                SELECT DISTINCT v.book, v.chapter, v.verse, v.id AS vid
                FROM words w
                JOIN verses v ON w.verse_id = v.id
                WHERE {like_clauses}
                ORDER BY v.id
                LIMIT 300
            """
            pn_params = [f"%{pn}%" for pn in proper_nouns]
            pn_conn = db_ro()
            new_pn: list = []
            try:
                for pr in pn_conn.execute(pn_sql, pn_params).fetchall():
                    key = (pr["book"], pr["chapter"], pr["verse"])
                    if key in verse_index:
                        continue
                    words = _fetch_verse_words(pn_conn, pr["vid"])
                    if words:
                        verse_index[key] = {
                            "ref": f"{pr['book']} {pr['chapter']}:{pr['verse']}",
                            "book": pr["book"],
                            "chapter": pr["chapter"],
                            "verse": pr["verse"],
                            "words": words,
                        }
                        new_pn.append(key)
            finally:
                pn_conn.close()
            if new_pn:
                results = results + [verse_index[k] for k in new_pn]
                log.debug("Proper noun supplement: +%d verses for %s", len(new_pn), proper_nouns)

        # ── Pass 2: relevance curation ────────────────────────────────────────
        primary_verses_raw, additional_verses_raw = _curate_primary_verses(q, results)
        log.debug("Pass-2 primary_verses: %s", primary_verses_raw)
        log.debug("Pass-2 additional_verses: %s", additional_verses_raw)

        # ── Build primary_set and fetch any missing primary verses ────────────
        dc_query = bool(_DIVINE_COUNCIL_RE.search(q))
        primary_set: set = set()
        for ref_str in primary_verses_raw:
            m = _VERSE_REF_PARSE_RE.search(str(ref_str).strip())
            if m:
                primary_set.add((_norm_book(m.group(1)), int(m.group(2)), int(m.group(3))))

        # ── Hardcoded corpora — injected regardless of Haiku output ──────────
        if dc_query:
            primary_set.update(_DIVINE_COUNCIL_VERSES)
            log.debug("Divine council corpus injected: %d verses", len(_DIVINE_COUNCIL_VERSES))

        missing_primary = [k for k in primary_set if k not in verse_index]
        if missing_primary:
            prim_conn = db_ro()
            new_primary = []
            try:
                for key in missing_primary:
                    book, chapter, verse_num = key
                    vrow = prim_conn.execute(
                        "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                        (book, chapter, verse_num),
                    ).fetchone()
                    if not vrow:
                        continue
                    words = _fetch_verse_words(prim_conn, vrow["id"])
                    if words:
                        verse_index[key] = {
                            "ref": f"{book} {chapter}:{verse_num}",
                            "book": book, "chapter": chapter, "verse": verse_num,
                            "words": words,
                        }
                        new_primary.append(key)
                        log.debug("Primary verse fetched: %s %d:%d", book, chapter, verse_num)
            finally:
                prim_conn.close()
            if new_primary:
                results = [verse_index[k] for k in new_primary] + results

        # ── Validate and fetch additional verses from Haiku's knowledge ───────
        # These are inferential scholarly citations that the SQL query couldn't
        # reach (e.g. Gen 1:26 for divine council — implied by plural pronouns,
        # not by any "divine being" Strong's number). Each ref is checked against
        # the DB before use; hallucinated refs are silently dropped.
        additional_set: set = set()
        for ref_str in additional_verses_raw:
            m = _VERSE_REF_PARSE_RE.search(str(ref_str).strip())
            if m:
                additional_set.add(
                    (_norm_book(m.group(1)), int(m.group(2)), int(m.group(3)))
                )

        if additional_set:
            add_conn = db_ro()
            new_additional: list = []
            try:
                for key in additional_set:
                    book, chapter, verse_num = key
                    vrow = add_conn.execute(
                        "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                        (book, chapter, verse_num),
                    ).fetchone()
                    if not vrow:
                        log.debug(
                            "Additional verse not in DB (dropped): %s %d:%d",
                            book, chapter, verse_num,
                        )
                        continue
                    if key in verse_index:
                        continue
                    words = _fetch_verse_words(add_conn, vrow["id"])
                    if words:
                        verse_index[key] = {
                            "ref": f"{book} {chapter}:{verse_num}",
                            "book": book, "chapter": chapter, "verse": verse_num,
                            "words": words,
                        }
                        new_additional.append(key)
                        log.debug(
                            "Additional verse fetched: %s %d:%d", book, chapter, verse_num
                        )
            finally:
                add_conn.close()
            if new_additional:
                results = [verse_index[k] for k in new_additional] + results

        # ── Tag is_primary / is_additional on every result verse ─────────────
        for v in results:
            key = (v["book"], v["chapter"], v["verse"])
            if dc_query:
                v["is_primary"] = key in _DIVINE_COUNCIL_VERSES
            else:
                v["is_primary"] = key in primary_set
            v["is_additional"] = (key in additional_set) and not v["is_primary"]

        # ── Sort in canonical book order (books.id) then chapter/verse ────────
        ord_conn = db_ro()
        try:
            book_order = {
                r["abbrev"]: r["id"]
                for r in ord_conn.execute(
                    "SELECT abbrev, id FROM books ORDER BY id"
                ).fetchall()
            }
        finally:
            ord_conn.close()
        results.sort(
            key=lambda v: (book_order.get(v["book"], 9999), v["chapter"], v["verse"])
        )

        # ── Hardcoded divine council key_strongs ─────────────────────────────
        if dc_query:
            dc_strongs = [
                {"strongs_base": "5207", "strongs": "G5207", "lemma": "υἱός",    "translit": "huiós",   "definition": "", "derivation": ""},
                {"strongs_base": "2316", "strongs": "G2316", "lemma": "θεός",    "translit": "theós",   "definition": "", "derivation": ""},
                {"strongs_base": "5475", "strongs": "H5475", "lemma": "סוֹד",    "translit": "sôd",     "definition": "", "derivation": ""},
                {"strongs_base": "5712", "strongs": "H5712", "lemma": "עֵדָה",   "translit": "ʿēdâh",  "definition": "", "derivation": ""},
                {"strongs_base": "1121", "strongs": "H1121", "lemma": "בֵּן",    "translit": "bēn",     "definition": "", "derivation": ""},
                {"strongs_base": "430",  "strongs": "H430",  "lemma": "אֱלֹהִים","translit": "ʾĕlōhîm","definition": "", "derivation": ""},
            ]
            existing_bases = {k["strongs_base"] for k in key_strongs_data}
            for ks in dc_strongs:
                if ks["strongs_base"] not in existing_bases:
                    key_strongs_data.append(ks)

        payload = {"results": results, "total": len(results),
                   "explanation": explanation, "key_strongs": key_strongs_data}
        _ai_cache[q] = payload
        _persist_ai_cache(q, payload)
        return jsonify(payload)

    except Exception:
        log.error("Unhandled exception in ai_search:\n%s", traceback.format_exc())
        return jsonify({"error": "Internal server error — see console for details"}), 500
