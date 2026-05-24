#!/usr/bin/env python3
import hashlib
import json
import logging
import os
import re
import sqlite3
import time
import traceback
from html.parser import HTMLParser

import anthropic
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

load_dotenv()

_log_level = getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
logging.basicConfig(level=_log_level, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bible")

# @@CORPUS_LIST@@  — comma-separated full book names, e.g. "Genesis, Exodus, …"
# @@SCHEMA_BOOKS@@ — schema comment listing abbrev→name pairs
_AI_SYSTEM_TMPL = """\
You are a Berean textual analyst for a SQLite database of the Greek Septuagint (LXX) \
covering @@CORPUS_LIST@@ \
(Apostolic Bible Polyglot interlinear). Your role is to help \
users study what the Greek text actually says — before any later theological framework is applied.

─── BEREAN METHODOLOGY ─────────────────────────────────────────────────────
These principles govern everything you write, especially the explanation field.

TEXT FIRST, NO IMPORTED THEOLOGY
  Start from what the Greek words mean in their literary and historical context.
  Do not assume Nicene, Trinitarian, or any later systematic-theological framework.
  Do not read Second Temple, patristic, or modern doctrinal categories back into the
  text as if they were the natural or obvious reading.

NO METAPHYSICAL OR SUBSTANCE LANGUAGE UNLESS THE TEXT INTRODUCES IT
  Prefer relational and functional description over ontological or essence language.
  "theos acts as creator," "kyrios relates to Israel as covenant lord" — not "the
  divine essence." Reserve terms like substance, hypostasis, or ontology for cases
  where the Greek text itself raises them.

SHOW THE FULL SEMANTIC RANGE — DO NOT COLLAPSE TO ONE MEANING
  When a Greek word carries multiple senses, report all of them.
  Example: pneuma (G4151) means breath, wind, and spirit — note which sense fits
  the context and why, rather than defaulting silently to the theological gloss.
  Example: psychē (G5590) means throat, breath, living being, and self — "soul"
  in the Platonic sense is an interpretation, not a translation.

FLAG WHERE ENGLISH TRANSLATIONS MADE INTERPRETIVE CHOICES
  When a rendering forecloses a valid alternative, name the choice.
  Example: huios tou theou rendered "Son of God" (ontological) vs. "son of a god /
  divine being" (functional/categorical) — the Greek supports both; the translator
  chose. Note which English renderings in the ABP carry this kind of weight.

HONEST ABOUT SCHOLARLY DISAGREEMENT
  Where there is genuine debate among scholars (e.g., whether bene ha-elohim in
  Gen 6 refers to angels, divine beings, or nobility; whether eikōn in Gen 1:26
  is functional or ontological), present the range of positions. Do not present
  one reading as obvious when it is contested.

GREEK FIRST
  Your explanation MUST open with what the Greek says — the lexical range of the
  key term(s), how the LXX uses them in this corpus, and any translation choices
  worth flagging. Never open with "The query targets…" or any description of the
  search strategy.

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

─── LSJ LEXICAL CONTEXT ─────────────────────────────────────────────────────
Each query is prepended with an "LSJ LEXICAL CONTEXT" block listing relevant Greek
lemmas and Strong's numbers drawn live from the Liddell-Scott-Jones lexicon.
Use those G-numbers in SQL WHERE clauses against strongs_base (or w.strongs
for dotted variants). Never invent or guess Strong's numbers not provided in
the LSJ context block.

─── OUTPUT FORMAT ───────────────────────────────────────────────────────────
This is a search interface, not a conversation. ALWAYS return the JSON below.
Never ask the user for clarification. Never explain why you can't answer.
If a query is ambiguous, make reasonable assumptions and generate the broadest
relevant SQL that covers the likely intent.

Return ONLY valid JSON, no markdown, no prose outside the JSON:
{
  "explanation": "...",
  "sql": "SELECT ..."
}

explanation — 1–3 sentences. What does the Greek text reveal: the lexical range
of key terms, interpretive translation choices, scholarly disagreement. Never
describe the query, the SQL, or which passages were targeted.

sql — SELECT only. Never INSERT, UPDATE, DELETE, DROP. Proper nouns use
strongs = '*'; match them with english_head LIKE. Function words (articles,
prepositions, conjunctions) are filtered from highlighting automatically by LSJ
part-of-speech data — include them freely in SQL without concern. Return exactly:
  w.strongs_base, w.strongs, w.english, w.english_head,
  v.book, v.chapter, v.verse,
  l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
JOIN: words w JOIN verses v ON w.verse_id = v.id
      LEFT JOIN lexicon l ON l.strongs = w.strongs_base
End:  ORDER BY v.id, w.position   LIMIT 500

When two concepts must appear TOGETHER in the same verse (e.g. "sons of God"
needs both G5207 and G2316), enforce co-occurrence inside the WHERE clause with
a subquery — do not rely on post-filtering:
  WHERE w.strongs_base = '5207'
    AND v.id IN (SELECT verse_id FROM words WHERE strongs_base = '2316')

When a concept has multiple lexical realizations, write a UNION ALL covering all
patterns. Each branch should enforce its own co-occurrence via subquery where
relevant. Every branch must select the same columns above; omit both ORDER BY and
LIMIT on UNION queries — the server wraps them in a subquery and handles ordering.\
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

_STRONGS_RE = re.compile(r'^G?(\d+(?:\.\d+)*)$', re.IGNORECASE)

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


_DIVINE_COUNCIL_RE = re.compile(
    r'\b(?:divine\s+council|sons?\s+of\s+(?:god|the\s+gods?|the\s+most\s+high)|'
    r'divine\s+being|heavenly\s+assembly|bene\s+[ae]lohim|holy\s+ones?|'
    r'heavenly\s+court|host\s+of\s+heaven|divine\s+assembly|'
    r'council\s+of\s+(?:god|the\s+holy)|gods?\s+of\s+the\s+nations?|'
    r'elohim\s+council|seraphim?|huioi?\s+tou\s+theou)\b',
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


def _strip_accents(s: str | None) -> str | None:
    """Remove combining diacritical marks so 'pneuma' matches 'pneûma'."""
    if not s:
        return s
    import unicodedata
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


_WORD_BOUNDARY_RE_CACHE: dict[str, re.Pattern] = {}


def _word_boundary_match(haystack: str | None, needle: str | None) -> bool:
    """SQLite custom function: True if needle appears as a complete word in haystack."""
    if not haystack or not needle:
        return False
    pat = _WORD_BOUNDARY_RE_CACHE.get(needle)
    if pat is None:
        pat = re.compile(r'(?<!\w)' + re.escape(needle) + r'(?!\w)', re.IGNORECASE)
        _WORD_BOUNDARY_RE_CACHE[needle] = pat
    return bool(pat.search(haystack))


def _fetch_verse_words(conn, verse_id: int) -> list[dict]:
    """Return the full word list for a verse, used when fetching cited/primary verses."""
    wrows = conn.execute(
        """SELECT w.strongs_base, w.strongs, w.english,
                  l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
           FROM words w
           LEFT JOIN lexicon l ON l.strongs = w.strongs_base
           WHERE w.verse_id = ?
             AND w.english IS NOT NULL AND w.english != ''
             AND w.strongs_base != '*'
           ORDER BY w.position""",
        (verse_id,),
    ).fetchall()
    return [
        {
            "strongs":      wr["strongs"],
            "strongs_base": wr["strongs_base"],
            "is_function":  wr["strongs_base"] in _FUNCTION_STRONGS,
            "gloss":        _clean_gloss(wr["english"]),
            "lemma":        wr["lemma"],
            "translit":     wr["translit"],
            "strongs_def":  (wr["strongs_def"] or "").strip(),
            "kjv_def":      wr["kjv_def"],
            "derivation":   (wr["derivation"] or "").strip(),
        }
        for wr in wrows
    ]


_CURATION_SYSTEM = """\
You are selecting primary evidence verses for a word study of the Greek Septuagint.
Return ONLY valid JSON — no prose, no markdown:
{
  "primary_verses": ["Book Ch:V", ...],
  "additional_verses": ["Book Ch:V", ...]
}

─── primary_verses ──────────────────────────────────────────────────────────
Select from the verse list provided by the user. A verse is PRIMARY EVIDENCE if
a scholar or student studying this topic would cite it in their analysis:

  • Makes the concept the grammatical subject, object, or predicate
  • Shows the concept acting, being described, named, or qualified
  • Establishes the existence, identity, or role of the concept
  • Places the concept in a theologically significant relationship
  • Performs a cosmic or governance function (setting borders, dividing nations,
    interceding, ruling, or acting on behalf of the divine) — these are primary
    even when the concept appears instrumentally rather than as the main subject
  • Provides evidence (even indirect) that a careful reader would cite

Exclude a verse ONLY when the word appears with zero bearing on the study topic:
a personal name in an unrelated genealogy, a bare preposition or particle, a
place name, or a counting formula where the word is purely grammatical filler.

For divine council and related queries, apply the participant test: the verse
must feature non-human supernatural beings — angels (angeloi), sons of God
(huioi tou theou), gods (theoi), spirits (pneumata), or holy ones (hagioi) —
as active participants. Human assemblies do not qualify regardless of what
assembly language is used. If the only beings named or implied in the verse are
humans (Israelites, elders, tribal chiefs, warriors, priests), it is not a
divine council passage.
  Fail: Israel assembles at Horeb — participants are humans
  Fail: Moses assembles tribal elders — participants are humans
  Fail: Israel gathers for war — participants are humans
  Pass: sons of God present themselves before the LORD (Job 1:6) — supernatural participants
  Pass: God stands in the divine assembly judging among gods (Psa 82:1) — supernatural participants
Theological statements about God's counsel, wisdom, or plan also do not qualify —
a verse describing what God decided is not the same as a verse showing the
assembly where it happened.

When in doubt, include. Select 4–10 primary verses.

─── additional_verses ───────────────────────────────────────────────────────
List up to 12 verse refs (Book Ch:V) that are standard scholarly citations for
this topic but were NOT returned by the SQL query (i.e. not in the verse list
below). Use this field ONLY when:

  • Scholarly consensus is strong that the verse belongs in this study, AND
  • The connection is inferred from context or implicit language rather than
    explicit vocabulary — e.g. Gen 1:26 for the divine council (plural "let us /
    our image" implies a heavenly assembly even though no council/being word
    appears explicitly).

If the verse list already covers the topic well, return additional_verses as [].
Do not pad with loosely related verses. Prefer empty over speculative.\
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

    capped = results[:50]
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
            max_tokens=400,
            temperature=0,
            system=_CURATION_SYSTEM,
            messages=[{
                "role": "user",
                "content": f"Query: {query}\n\nVerses:\n{verse_list}",
            }],
        )
        raw = msg.content[0].text.strip()
        s, e = raw.find("{"), raw.rfind("}")
        parsed = json.loads(raw[s:e + 1]) if s != -1 and e > s else {}
        primary    = [str(r) for r in parsed.get("primary_verses", [])][:25]
        additional = [str(r) for r in parsed.get("additional_verses", [])][:12]
        return primary, additional
    except Exception as exc:
        log.warning("Pass-2 curation failed: %s", exc)
        return [], []


def _clean_gloss(s: str | None) -> str | None:
    """Strip trailing punctuation that ABP interlinear leaves on phrase-boundary words."""
    if not s:
        return s
    return s.rstrip(" ,;:.!?")


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


_ai_cache: dict = {}            # in-memory L1 cache (query → payload)
_lsj_summary_cache: dict = {}  # keyed on LSJ key; persists for server lifetime
_ai_cache_ver: str | None = None  # computed once from prompt template + book list


def _get_ai_cache_ver() -> str:
    """SHA1 of (system prompt template + sorted book abbreviations).

    Automatically invalidates DB cache when books are added or the system
    prompt template changes — no manual version bump required.
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
    raw = _AI_SYSTEM_TMPL + "|books=" + abbrevs
    _ai_cache_ver = hashlib.sha1(raw.encode()).hexdigest()[:16]
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
        # Prune stale entries from previous prompt/book versions.
        deleted = conn.execute(
            "DELETE FROM ai_search_cache WHERE ver_key != ?", (ver,)
        ).rowcount
        conn.commit()
        conn.close()
        log.info(
            "AI cache: loaded %d entries (ver=%s), pruned %d stale",
            len(rows), ver, deleted,
        )
    except Exception as exc:
        log.warning("Could not load AI cache from DB: %s", exc)


def _persist_ai_cache(query: str, payload: dict) -> None:
    """Write a single cache entry to the DB (fire-and-forget; errors are logged only)."""
    ver = _get_ai_cache_ver()
    try:
        conn = db()
        conn.execute(
            """INSERT OR REPLACE INTO ai_search_cache
               (query, result_json, ver_key, created_at)
               VALUES (?, ?, ?, ?)""",
            (query, json.dumps(payload), ver, time.time()),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        log.warning("Could not persist AI cache entry: %s", exc)

# LSJ part-of-speech detection for function words.
# LSJ def_html has two POS patterns:
#   Short entries: <b>WORD</b>, Conj., …
#   Long entries:  <b>WORD</b>, (many variant forms) … <b>PREP.</b> WITH DAT. …
# We check both: plain-text POS near the headword AND bold POS section headers.
_LSJ_FUNC_WORD_RE = re.compile(
    r'\b(?:'
    r'Prep(?:osition)?[.,\s]|Conj(?:unction)?[.,\s]|Part(?:icle)?[.,\s]|'
    r'Art(?:icle)?[.,\s]|definite\s+article\b|'
    r'preposition\b|conjunction\b|particle\b|article\b'
    r')',
    re.IGNORECASE,
)
_LSJ_FUNC_BOLD_RE = re.compile(
    r'<b>(?:PREP(?:OSITION)?|CONJ(?:UNCTION)?|PART(?:ICLE)?|ART(?:ICLE)?)[.,\s<]',
    re.IGNORECASE,
)


def _is_lsj_function_word(def_html: str) -> bool:
    """Return True if the LSJ entry is a grammatical function word (not a content word)."""
    html = def_html or ''
    # Fast path: bold POS section header anywhere in the entry (e.g. <b>PREP.</b>)
    if _LSJ_FUNC_BOLD_RE.search(html[:3000]):
        return True
    # Slow path: strip the opening headword, then look for POS in plain text
    tail = re.sub(r'^\s*<b>[^<]*</b>', '', html.strip())
    text = re.sub(r'<[^>]+>', ' ', tail[:300]).strip()
    return bool(_LSJ_FUNC_WORD_RE.search(text[:200]))


_FUNCTION_STRONGS: set[str] = set()  # strongs_base values that are function words

# Known function words not caught by the LSJ POS detector (manual overrides).
_FUNCTION_STRONGS_OVERRIDE: frozenset[str] = frozenset({
    "3361",  # μή — negative particle
})


def _build_function_strongs_cache() -> None:
    """Classify lexicon entries as content/function using LSJ def_html; runs once at startup."""
    global _FUNCTION_STRONGS
    try:
        conn = db()
        rows = conn.execute(
            """SELECT l.strongs, lsj.def_html
               FROM lexicon l
               JOIN lsj ON lsj.plain = lower(strip_accents(l.lemma))"""
        ).fetchall()
        conn.close()
        func: set[str] = set()
        for row in rows:
            if _is_lsj_function_word(row["def_html"]):
                func.add(row["strongs"])
        func |= _FUNCTION_STRONGS_OVERRIDE
        _FUNCTION_STRONGS = func
        log.info("Function word cache: %d function words identified via LSJ", len(func))
    except Exception as e:
        log.warning("Could not build function word cache (LSJ table may not exist yet): %s", e)


_LSJ_TERM_LIMIT = 4  # max LSJ entries per extracted search term


def _lsj_concept_lookup(terms: list[str]) -> list[dict]:
    """Search LSJ + lexicon for English terms; return matched Strong's + semantic snippets."""
    if not terms:
        return []
    conn = db()
    seen: set[str] = set()
    results: list[dict] = []
    try:
        for term in terms[:5]:
            pattern = f"%{term.lower()}%"
            rows = conn.execute(
                """SELECT l.strongs, l.lemma, l.translit, lsj.summary_json, lsj.def_html
                   FROM lexicon l
                   JOIN lsj ON lsj.plain = lower(strip_accents(l.lemma))
                   WHERE lower(lsj.def_html) LIKE ?
                   ORDER BY length(lsj.def_html)
                   LIMIT ?""",
                (pattern, _LSJ_TERM_LIMIT),
            ).fetchall()
            for row in rows:
                if row["strongs"] in seen:
                    continue
                seen.add(row["strongs"])
                semantic = ""
                if row["summary_json"]:
                    try:
                        sj = json.loads(row["summary_json"])
                        semantic = " ".join(
                            s["text"] for s in sj.get("sections", [])
                        )[:300]
                    except Exception:
                        pass
                if not semantic:
                    semantic = re.sub(r"<[^>]+>", " ", row["def_html"] or "")[:300].strip()
                # Fetch dotted variants present in the corpus for this base
                variants = [
                    v["strongs"] for v in conn.execute(
                        "SELECT DISTINCT strongs FROM words WHERE strongs LIKE ? AND strongs != ?",
                        (f"{row['strongs']}.%", row["strongs"]),
                    ).fetchall()
                ]
                results.append({
                    "strongs":         row["strongs"],
                    "lemma":           row["lemma"],
                    "translit":        row["translit"],
                    "semantic":        semantic,
                    "dotted_variants": variants,
                })
    except Exception as e:
        log.warning("LSJ concept lookup failed: %s", e)
    finally:
        conn.close()
    return results


def _format_lsj_context(entries: list[dict]) -> str:
    if not entries:
        return ""
    lines = ["LSJ LEXICAL CONTEXT — use these Strong's numbers in SQL WHERE clauses:"]
    for e in entries:
        line = f"  G{e['strongs']} {e['lemma']} ({e['translit']}): {e['semantic']}"
        variants = e.get("dotted_variants", [])
        if variants:
            vlist = ", ".join(f"G{v}" for v in sorted(variants))
            line += f" [corpus dotted variants: {vlist} — use w.strongs='...' to target specifically]"
        lines.append(line)
    return "\n".join(lines)

_SENSE_MARKER_RE = re.compile(r'^([IVX]+\.|[A-E]\.|[1-9][0-9]*\.|[a-e]\.)$')


class _SectionParser(HTMLParser):
    """Split LSJ def_html into major sense sections by bold markers."""
    def __init__(self):
        super().__init__()
        self._bold = False
        self._bold_buf: list[str] = []
        self._cur_marker: str | None = None
        self._cur_text: list[str] = []
        self._sections: list[tuple[str | None, str]] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("b", "strong"):
            self._bold = True
            self._bold_buf = []

    def handle_endtag(self, tag):
        if tag in ("b", "strong") and self._bold:
            self._bold = False
            marker = "".join(self._bold_buf).strip()
            if _SENSE_MARKER_RE.match(marker):
                text = "".join(self._cur_text).strip()
                if text:
                    self._sections.append((self._cur_marker, text))
                self._cur_marker = marker
                self._cur_text = []
            else:
                self._cur_text.append(marker)

    def handle_data(self, data):
        if self._bold:
            self._bold_buf.append(data)
        else:
            self._cur_text.append(data)

    def get_sections(self) -> list[tuple[str | None, str]]:
        text = "".join(self._cur_text).strip()
        if text:
            self._sections.append((self._cur_marker, text))
        return self._sections

_anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
if not _anthropic_key:
    log.warning("ANTHROPIC_API_KEY not set — AI search will be unavailable")
_anthropic = anthropic.Anthropic(api_key=_anthropic_key) if _anthropic_key else None


def _strongs_num(q: str):
    """Return the numeric portion if q looks like a Strong's ref, else None."""
    m = _STRONGS_RE.match(q.strip())
    return m.group(1) if m else None

app = Flask(__name__)
limiter = Limiter(get_remote_address, app=app, default_limits=[], storage_uri="memory://")


def _migrate_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    try:
        try:
            conn.execute("ALTER TABLE lsj ADD COLUMN summary_json TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists
        # One-time: clear v1 summaries that contained markdown artifacts.
        # The presence of summary_v column marks this migration as done.
        try:
            conn.execute("ALTER TABLE lsj ADD COLUMN summary_v INTEGER DEFAULT 0")
            conn.execute("UPDATE lsj SET summary_json = NULL WHERE summary_json IS NOT NULL")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # already migrated
        try:
            conn.execute("ALTER TABLE abp_ext ADD COLUMN summary_json TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists
        # Persistent AI search result cache (survives restarts).
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS ai_search_cache (
                query      TEXT PRIMARY KEY,
                result_json TEXT NOT NULL,
                ver_key    TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_cache_ver ON ai_search_cache(ver_key);
        """)
        conn.commit()
    finally:
        conn.close()

@app.errorhandler(429)
def rate_limit_handler(e):
    return jsonify({"error": f"Rate limit exceeded — {e.description}"}), 429
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bible.db")


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.create_function("strip_accents", 1, _strip_accents)
    conn.create_function("word_boundary", 2, _word_boundary_match)
    return conn


def db_ro():
    """Read-only connection for executing AI-generated SQL."""
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


_migrate_db()
_build_function_strongs_cache()
_load_ai_cache_from_db()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/search")
def search():
    q = request.args.get("q", "").strip()
    phrase_mode = request.args.get("phrase", "0") == "1"

    if not q:
        return jsonify({"results": [], "total": 0})

    conn = db()
    groupings: dict = {}
    try:
        snum = _strongs_num(q)
        if snum:
            col = "w.strongs" if "." in snum else "w.strongs_base"
            rows = conn.execute(
                f"""
                SELECT w.strongs_base, w.strongs, w.english, w.english_head,
                       v.id AS verse_id, v.book, v.chapter, v.verse,
                       l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
                FROM words w
                JOIN verses v ON w.verse_id = v.id
                LEFT JOIN lexicon l ON l.strongs = w.strongs_base
                WHERE {col} = ?
                  AND w.english IS NOT NULL AND w.english != ''
                  AND w.strongs_base != '*'
                ORDER BY v.id, w.position
                """,
                (snum,),
            ).fetchall()
        else:
            q_plain = _strip_accents(q)
            if phrase_mode:
                # Phrase mode: word-boundary match within the full multi-word gloss.
                rows = conn.execute(
                    """
                    SELECT w.strongs_base, w.strongs, w.english, w.english_head,
                           v.id AS verse_id, v.book, v.chapter, v.verse,
                           l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
                    FROM words w
                    JOIN verses v ON w.verse_id = v.id
                    LEFT JOIN lexicon l ON l.strongs = w.strongs_base
                    WHERE (word_boundary(w.english, ?)
                           OR word_boundary(strip_accents(l.translit), ?))
                      AND w.english IS NOT NULL AND w.english != ''
                      AND w.strongs_base != '*'
                    ORDER BY v.id, w.position
                    """,
                    (q, q_plain),
                ).fetchall()
            else:
                # Default mode: exact head-word match (english_head is a single token),
                # or transliteration prefix/substring for Greek lookup flexibility.
                rows = conn.execute(
                    """
                    SELECT w.strongs_base, w.strongs, w.english, w.english_head,
                           v.id AS verse_id, v.book, v.chapter, v.verse,
                           l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
                    FROM words w
                    JOIN verses v ON w.verse_id = v.id
                    LEFT JOIN lexicon l ON l.strongs = w.strongs_base
                    WHERE (w.english_head = ? COLLATE NOCASE
                           OR strip_accents(l.translit) LIKE ? COLLATE NOCASE)
                      AND w.english IS NOT NULL AND w.english != ''
                      AND w.strongs_base != '*'
                    ORDER BY v.id, w.position
                    """,
                    (q, f"%{q_plain}%"),
                ).fetchall()
        # Gloss groupings: keyed by exact dotted strongs number.
        if snum:
            unique_strongs = list({r["strongs"] for r in rows
                                   if r["strongs"] and r["strongs"] != "*"})
        else:
            # Dotted strongs values where english_head = q exists anywhere in corpus
            corpus_match = {
                r["strongs"] for r in conn.execute(
                    """SELECT DISTINCT strongs FROM words
                       WHERE english_head = ? COLLATE NOCASE
                         AND strongs IS NOT NULL AND strongs != '*'""",
                    (q,),
                ).fetchall()
            }
            # Cross-reference: only include strongs that also appear in the search results
            result_strongs = {r["strongs"] for r in rows
                              if r["strongs"] and r["strongs"] != "*"}
            unique_strongs = list(corpus_match & result_strongs)
        if unique_strongs:
            placeholders = ",".join("?" * len(unique_strongs))
            for gr in conn.execute(
                f"""SELECT strongs, english_head, COUNT(*) AS cnt
                    FROM words
                    WHERE strongs IN ({placeholders})
                      AND english_head IS NOT NULL AND english_head != ''
                    GROUP BY strongs, english_head
                    ORDER BY strongs, cnt DESC""",
                unique_strongs,
            ).fetchall():
                s = gr["strongs"]
                groupings.setdefault(s, []).append({"gloss": gr["english_head"], "count": gr["cnt"]})
    finally:
        conn.close()

    results = [
        {
            "ref":        f"{r['book']} {r['chapter']}:{r['verse']}",
            "book":       r["book"],
            "chapter":    r["chapter"],
            "verse":      r["verse"],
            "strongs":    r["strongs"],
            "strongs_base": r["strongs_base"],
            "gloss":      _clean_gloss(r["english"]),
            "lemma":      r["lemma"],
            "translit":   r["translit"],
            "strongs_def": (r["strongs_def"] or "").strip(),
            "kjv_def":    r["kjv_def"],
            "derivation": (r["derivation"] or "").strip(),
        }
        for r in rows
    ]

    return jsonify({"results": results, "total": len(results), "groupings": groupings})


@app.route("/api/verse/<book>/<int:chapter>/<int:verse>")
def verse_text(book, chapter, verse):
    conn = db()
    try:
        row = conn.execute(
            "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
            (book, chapter, verse),
        ).fetchone()

        if not row:
            return jsonify({"error": "verse not found"}), 404

        words = conn.execute(
            "SELECT english FROM words WHERE verse_id=? AND english IS NOT NULL ORDER BY position",
            (row["id"],),
        ).fetchall()
    finally:
        conn.close()

    return jsonify({"text": " ".join(w["english"] for w in words)})


@app.route("/api/verse-words/<book>/<int:chapter>/<int:verse>")
def verse_words(book, chapter, verse):
    conn = db()
    try:
        row = conn.execute(
            "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
            (book, chapter, verse),
        ).fetchone()
        if not row:
            return jsonify({"error": "verse not found"}), 404
        wrows = conn.execute(
            """SELECT w.position, w.english, w.strongs_base, w.strongs,
                      l.lemma, l.translit, l.strongs_def, l.derivation
               FROM words w
               LEFT JOIN lexicon l ON l.strongs = w.strongs_base
               WHERE w.verse_id = ? AND w.english IS NOT NULL
               ORDER BY w.position""",
            (row["id"],),
        ).fetchall()
    finally:
        conn.close()
    return jsonify({
        "words": [
            {
                "position":   w["position"],
                "english":    w["english"],
                "strongs_base": w["strongs_base"],
                "strongs":    w["strongs"],
                "lemma":      w["lemma"],
                "translit":   w["translit"],
                "strongs_def": (w["strongs_def"] or "").strip(),
                "derivation": (w["derivation"] or "").strip(),
                "is_content": w["strongs_base"] not in _FUNCTION_STRONGS,
            }
            for w in wrows
        ]
    })


@app.route("/api/lsj/<path:lemma>")
def lsj_lookup(lemma):
    strongs_param = request.args.get("strongs", "")
    conn = db()
    try:
        if "." in strongs_param:
            snum = strongs_param.lstrip("Gg")
            try:
                abp_row = conn.execute(
                    "SELECT def_html FROM abp_ext WHERE strongs = ? OR strongs = ?",
                    (snum, "G" + snum),
                ).fetchone()
            except Exception as e:
                log.warning("abp_ext lookup failed: %s", e)
                abp_row = None
        else:
            snum = strongs_param
            abp_row = None
        plain = _strip_accents(lemma).lower()
        row = conn.execute(
            "SELECT key, translit, def_html FROM lsj WHERE key = ?", (lemma,)
        ).fetchone()
        if not row and plain:
            row = conn.execute(
                "SELECT key, translit, def_html FROM lsj WHERE plain = ?", (plain,)
            ).fetchone()
    finally:
        conn.close()
    if abp_row:
        return jsonify({
            "key":      snum,
            "translit": "",
            "def_html": abp_row["def_html"],
            "source":   "abp_ext",
        })
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify({
        "key":      row["key"],
        "translit": row["translit"],
        "def_html": row["def_html"],
    })


@app.route("/api/lsj-summary/<path:lemma>")
@limiter.limit("60 per hour")
def lsj_summary(lemma):
    strongs_param = request.args.get("strongs", "")
    cache_key = f"abp:{strongs_param}" if ("." in strongs_param) else lemma

    if cache_key in _lsj_summary_cache:
        return jsonify(_lsj_summary_cache[cache_key])
    if not _anthropic:
        return jsonify({"error": "AI unavailable"}), 503

    conn = db()
    exact_key = None    # set for LSJ rows so summary_json is written back
    abp_strongs = None  # set for abp_ext rows so summary_json is written back
    try:
        if "." in strongs_param:
            snum = strongs_param.lstrip("Gg")
            try:
                abp_row = conn.execute(
                    "SELECT def_html, summary_json FROM abp_ext WHERE strongs = ? OR strongs = ?",
                    (snum, "G" + snum),
                ).fetchone()
            except Exception as e:
                log.warning("abp_ext summary lookup failed: %s", e)
                abp_row = None
            if abp_row:
                row = {"def_html": abp_row["def_html"], "summary_json": abp_row["summary_json"]}
                abp_strongs = snum
            else:
                row = None
        else:
            plain = _strip_accents(lemma).lower()
            row = conn.execute(
                "SELECT key, def_html, summary_json FROM lsj WHERE key = ?", (lemma,)
            ).fetchone()
            if not row and plain:
                row = conn.execute(
                    "SELECT key, def_html, summary_json FROM lsj WHERE plain = ?", (plain,)
                ).fetchone()
            if row:
                exact_key = row["key"]
    finally:
        conn.close()
    if not row:
        return jsonify({"error": "not found"}), 404

    if row["summary_json"]:
        payload = json.loads(row["summary_json"])
        _lsj_summary_cache[cache_key] = payload
        return jsonify(payload)

    parser = _SectionParser()
    parser.feed(row["def_html"] or "")
    sections = parser.get_sections()
    if not sections:
        payload = {"sections": []}
        _lsj_summary_cache[cache_key] = payload
        return jsonify(payload)

    _lsj_refusal_re = re.compile(
        r'^(I |A\.\s*I |I\'m |I don\'t|I cannot|I appreciate|I need|Unfortunately)',
        re.IGNORECASE,
    )
    results = []
    for marker, text in sections:
        if len(text.strip()) < 20:
            continue
        msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": (
                "You are a lexicon summarizer. Extract the English definition from this LSJ Greek lexicon section. "
                "Write one to two plain prose sentences stating what the word means. "
                "No markdown, no headers, no bullet points, no Greek text, no citations, no abbreviations. "
                "If the section contains only grammatical labels or cross-references with no definition, "
                "write a single sentence summarizing any meaning present. "
                "Return only the bare sentences.\n\n" + text
            )}],
        )
        response_text = msg.content[0].text.strip()
        if _lsj_refusal_re.match(response_text):
            continue
        results.append({"marker": marker, "text": response_text})

    payload = {"sections": results}
    conn = db()
    try:
        if exact_key:
            conn.execute(
                "UPDATE lsj SET summary_json = ? WHERE key = ?",
                (json.dumps(payload), exact_key),
            )
            conn.commit()
        elif abp_strongs:
            conn.execute(
                "UPDATE abp_ext SET summary_json = ? WHERE strongs = ? OR strongs = ?",
                (json.dumps(payload), abp_strongs, "G" + abp_strongs),
            )
            conn.commit()
    finally:
        conn.close()
    _lsj_summary_cache[cache_key] = payload
    return jsonify(payload)


@app.route("/api/books")
def books_list():
    conn = db()
    try:
        rows = conn.execute("""
            SELECT b.abbrev, b.name, MAX(v.chapter) AS chapters
            FROM books b
            JOIN verses v ON v.book = b.abbrev
            GROUP BY b.abbrev, b.name
            ORDER BY b.id
        """).fetchall()
    finally:
        conn.close()
    return jsonify([{"abbrev": r["abbrev"], "name": r["name"], "chapters": r["chapters"]} for r in rows])


@app.route("/api/chapter/<book>/<int:chapter>")
def chapter_text(book, chapter):
    conn = db()
    try:
        rows = conn.execute(
            """SELECT v.verse, w.position, w.english, w.strongs_base, w.strongs,
                      l.lemma, l.translit, w.greek_pos, w.bracket_id
               FROM verses v
               JOIN words w ON w.verse_id = v.id
               LEFT JOIN lexicon l ON l.strongs = w.strongs_base
               WHERE v.book = ? AND v.chapter = ?
                 AND w.english IS NOT NULL AND w.english != ''
               ORDER BY v.verse, w.position""",
            (book, chapter),
        ).fetchall()
    finally:
        conn.close()
    verses: dict[int, dict] = {}
    order: list[int] = []
    for r in rows:
        vn = r["verse"]
        if vn not in verses:
            verses[vn] = {"words": []}
            order.append(vn)
        verses[vn]["words"].append({
            "position":     r["position"],
            "english":      r["english"],
            "strongs_base": r["strongs_base"],
            "strongs":      r["strongs"],
            "lemma":        r["lemma"],
            "translit":     r["translit"],
            "greek_pos":    r["greek_pos"],
            "bracket_id":   r["bracket_id"],
        })
    return jsonify([
        {
            "verse": v,
            "words": verses[v]["words"],
        }
        for v in order
    ])


@app.route("/api/strongs-count/<strongs_base>")
def strongs_count_route(strongs_base):
    if strongs_base == "*":
        return jsonify({"count": None})
    conn = db()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM words WHERE strongs = ?"
            " AND english IS NOT NULL AND english != ''",
            (strongs_base,),
        ).fetchone()
    finally:
        conn.close()
    return jsonify({"count": row["cnt"] if row else 0})


@app.route("/api/ai-search")
@limiter.limit("20 per hour")
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
            max_tokens=1500,
            temperature=0,
            system=_get_ai_system(),
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

        sql         = _normalize_union_sql(parsed.get("sql", "").strip())
        explanation = parsed.get("explanation", "")
        log.debug("SQL from AI: %s", sql)

        if not re.match(r"^\s*SELECT\b", sql, re.IGNORECASE):
            log.error("AI returned non-SELECT query: %r", sql)
            return jsonify({"error": "AI returned a non-SELECT query", "sql": sql}), 400

        conn = db_ro()
        try:
            rows = conn.execute(sql).fetchall()
        except Exception as e:
            log.error("SQL execution error: %s\nSQL: %s", e, sql)
            return jsonify({"error": f"SQL error: {e}", "sql": sql}), 400
        finally:
            conn.close()
        log.debug("SQL returned %d rows", len(rows))

        # ── Group word-level rows into one entry per verse ───────────────────
        verse_index = {}
        verse_order = []
        for r in rows:
            key = (r["book"], r["chapter"], r["verse"])
            if key not in verse_index:
                verse_index[key] = {
                    "ref":     f"{r['book']} {r['chapter']}:{r['verse']}",
                    "book":    r["book"],
                    "chapter": r["chapter"],
                    "verse":   r["verse"],
                    "words":   [],
                }
                verse_order.append(key)
            if not r["english"] or r["strongs_base"] == "*":
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
                    primary_set.add(key)
                    if key in verse_index:
                        continue  # already in results; primary_set.add above is enough
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

        # ── Tag is_primary on every result verse ──────────────────────────────
        # For divine council queries the hardcoded corpus is the sole authority —
        # Haiku's curation is ignored for primary tagging.
        if dc_query:
            for v in results:
                v["is_primary"] = (v["book"], v["chapter"], v["verse"]) in _DIVINE_COUNCIL_VERSES
        else:
            for v in results:
                v["is_primary"] = (v["book"], v["chapter"], v["verse"]) in primary_set

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

        payload = {"results": results, "total": len(results),
                   "explanation": explanation}
        _ai_cache[q] = payload
        _persist_ai_cache(q, payload)
        return jsonify(payload)

    except Exception:
        log.error("Unhandled exception in ai_search:\n%s", traceback.format_exc())
        return jsonify({"error": "Internal server error — see console for details"}), 500


if __name__ == "__main__":
    app.run(debug=True)
