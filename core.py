#!/usr/bin/env python3
"""Shared core for the Lexica Flask app.

App-independent layer that the view modules import: DB connections, the rate
limiter (created WITHOUT an app — app.py calls limiter.init_app(app)), the
Anthropic client, small shared helpers, and the function-word set. This module
imports NOTHING from the view modules or app.py, so there are no circular imports.

The `_FUNCTION_STRONGS` set is declared here but POPULATED IN PLACE at startup by
app.py's `_build_function_strongs_cache` (clear()+update(), never reassigned) so
that `from core import _FUNCTION_STRONGS` references stay valid after the rebuild.
"""
import hashlib
import json
import logging
import os
import re
import sqlite3
import time

import anthropic
from dotenv import load_dotenv
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

load_dotenv()

_log_level = getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
logging.basicConfig(level=_log_level, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bible")

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bible.db")

_anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
if not _anthropic_key:
    log.warning("ANTHROPIC_API_KEY not set — AI search will be unavailable")
_anthropic = anthropic.Anthropic(api_key=_anthropic_key) if _anthropic_key else None

# Created without an app; app.py wires it with limiter.init_app(app).
# default_limits is a per-endpoint, per-IP backstop against flooding the DB/SQLite
# routes (a flood is thousands/min, so 300/min stops abuse with huge headroom for
# real use — even many users behind one shared/NAT IP). The paid AI endpoints set
# their own tighter @limiter.limit("200 per hour"), which overrides this default;
# static asset loads are exempted in app.py so a normal page view never trips it.
limiter = Limiter(get_remote_address, default_limits=["300 per minute"], storage_uri="memory://")

# strongs_base values that are function words. Declared empty here; populated IN
# PLACE at startup by app.py's _build_function_strongs_cache (see module docstring).
_FUNCTION_STRONGS: set[str] = set()

# In-memory L1 cache for AI-derived payloads (ai-search queries + xref synthesis/
# curation). Shared by the AI and cross-reference blueprints; mutated IN PLACE
# (cache[key] = payload), never reassigned, so `from core import _ai_cache`
# references stay valid. Startup loads only the AI-search entries into it.
_ai_cache: dict = {}

# ABP abbreviation → KJV CSV BookID (standard Protestant 1-66). The books table
# uses ABP auto-increment IDs that include apocrypha, so they don't match KJV
# BookIDs; we bypass the join entirely. Shared by the kjv/crossref/lexicon/search
# blueprints, so it lives in core.
_KJV_BOOK_ID: dict[str, int] = {
    "Gen":  1, "Exo":  2, "Lev":  3, "Num":  4, "Deu":  5,
    "Jos":  6, "Jdg":  7, "Rth":  8, "1Sa":  9, "2Sa": 10,
    "1Ki": 11, "2Ki": 12, "1Ch": 13, "2Ch": 14, "Ezr": 15,
    "Neh": 16, "Est": 17, "Job": 18, "Psa": 19, "Pro": 20,
    "Ecc": 21, "Son": 22, "Isa": 23, "Jer": 24, "Lam": 25,
    "Eze": 26, "Dan": 27, "Hos": 28, "Joe": 29, "Amo": 30,
    "Oba": 31, "Jon": 32, "Mic": 33, "Nah": 34, "Hab": 35,
    "Zep": 36, "Hag": 37, "Zec": 38, "Mal": 39,
    "Mat": 40, "Mar": 41, "Luk": 42, "Joh": 43, "Act": 44,
    "Rom": 45, "1Co": 46, "2Co": 47, "Gal": 48, "Eph": 49,
    "Php": 50, "Col": 51, "1Th": 52, "2Th": 53, "1Ti": 54,
    "2Ti": 55, "Tit": 56, "Phm": 57, "Heb": 58, "Jas": 59,
    "1Pe": 60, "2Pe": 61, "1Jn": 62, "2Jn": 63, "3Jn": 64,
    "Jud": 65, "Rev": 66,
}
_KJV_BOOK_ID_REV: dict[int, str] = {v: k for k, v in _KJV_BOOK_ID.items()}

# App book-abbrev -> standard USFM 3-char code. Used by the audio features:
# FCBH wants it UPPERCASE (ESV audio); openbible.com's public-domain BSB files
# want it title-cased (BSB_<NN>_<Mrk>_<CCC>.mp3). Both derive from this one map.
_USFM_BOOK: dict[str, str] = {
    "Gen": "GEN", "Exo": "EXO", "Lev": "LEV", "Num": "NUM", "Deu": "DEU",
    "Jos": "JOS", "Jdg": "JDG", "Rth": "RUT", "1Sa": "1SA", "2Sa": "2SA",
    "1Ki": "1KI", "2Ki": "2KI", "1Ch": "1CH", "2Ch": "2CH", "Ezr": "EZR",
    "Neh": "NEH", "Est": "EST", "Job": "JOB", "Psa": "PSA", "Pro": "PRO",
    "Ecc": "ECC", "Son": "SNG", "Isa": "ISA", "Jer": "JER", "Lam": "LAM",
    "Eze": "EZK", "Dan": "DAN", "Hos": "HOS", "Joe": "JOL", "Amo": "AMO",
    "Oba": "OBA", "Jon": "JON", "Mic": "MIC", "Nah": "NAM", "Hab": "HAB",
    "Zep": "ZEP", "Hag": "HAG", "Zec": "ZEC", "Mal": "MAL", "Mat": "MAT",
    "Mar": "MRK", "Luk": "LUK", "Joh": "JHN", "Act": "ACT", "Rom": "ROM",
    "1Co": "1CO", "2Co": "2CO", "Gal": "GAL", "Eph": "EPH", "Php": "PHP",
    "Col": "COL", "1Th": "1TH", "2Th": "2TH", "1Ti": "1TI", "2Ti": "2TI",
    "Tit": "TIT", "Phm": "PHM", "Heb": "HEB", "Jas": "JAS", "1Pe": "1PE",
    "2Pe": "2PE", "1Jn": "1JN", "2Jn": "2JN", "3Jn": "3JN", "Jud": "JUD",
    "Rev": "REV",
}


def usfm_titlecase(usfm: str) -> str:
    """USFM code -> openbible.com's filename form: first letter capital, the rest
    lower, digits kept. 'MRK'->'Mrk', '1SA'->'1Sa', '3JN'->'3Jn'."""
    out, seen_alpha = [], False
    for c in usfm:
        if c.isalpha():
            out.append(c.upper() if not seen_alpha else c.lower())
            seen_alpha = True
        else:
            out.append(c)
    return "".join(out)

_STRONGS_RE = re.compile(r'^[GH]?(\d+(?:\.\d+)*)$', re.IGNORECASE)
_WORD_BOUNDARY_RE_CACHE: dict[str, re.Pattern] = {}


def _strip_accents(s: str | None) -> str | None:
    """Remove combining diacritical marks so 'pneuma' matches 'pneûma'."""
    if not s:
        return s
    import unicodedata
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def _word_boundary_match(haystack: str | None, needle: str | None) -> bool:
    """SQLite custom function: True if needle appears as a complete word in haystack."""
    if not haystack or not needle:
        return False
    pat = _WORD_BOUNDARY_RE_CACHE.get(needle)
    if pat is None:
        pat = re.compile(r'(?<!\w)' + re.escape(needle) + r'(?!\w)', re.IGNORECASE)
        _WORD_BOUNDARY_RE_CACHE[needle] = pat
    return bool(pat.search(haystack))


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
    conn.create_function("strip_accents", 1, _strip_accents)
    conn.create_function("word_boundary", 2, _word_boundary_match)
    return conn


# User study notes live in their OWN file, NOT bible.db — bible.db is the corpus
# (rebuilt/regenerated) and stays read-only-ish; user data must survive a rebuild
# and stay isolated. This is the ONLY place the site stores visitor-created data.
NOTES_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "notes.db")


def notes_db():
    conn = sqlite3.connect(NOTES_DB)
    conn.row_factory = sqlite3.Row
    return conn


# Admin-authored "study modules" content (guided topics, denomination chart,
# arguments) lives in its OWN file, study.db — kept OUT of bible.db (the corpus
# is rebuilt; authored study content must survive that) and OUT of git (*.db is
# gitignored), like notes.db. Only the admin (owner) writes here; reading may open
# up later. The admin gate in views_study.py decides who can touch it.
STUDY_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "study.db")


def study_db():
    conn = sqlite3.connect(STUDY_DB)
    conn.row_factory = sqlite3.Row
    return conn


# The ESV is a PERSONAL, owner-only reading text (Crossway-copyrighted — it is
# NEVER a public corpus like KJV/BSB). Its text lives in its OWN file, esv.db,
# kept OUT of bible.db and OUT of git (*.db is gitignored), and loaded on
# PythonAnywhere only by scripts/load_esv.py. The owner gate in views_esv.py
# decides who is allowed to read it; this helper just opens the file read-only.
ESV_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "esv.db")


def esv_db():
    """Read-only connection to esv.db. Raises sqlite3.OperationalError if the file
    isn't there yet (esv.db not loaded) — callers catch that and return empty."""
    conn = sqlite3.connect(f"file:{ESV_DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# The NIV is a PERSONAL, owner-only reading text too (Biblica/Zondervan-
# copyrighted — NEVER a public corpus like KJV/BSB). Same setup as the ESV above:
# its text lives in its OWN file, niv.db, kept OUT of bible.db and OUT of git, and
# loaded on PythonAnywhere only by scripts/load_niv.py. The owner gate in
# views_niv.py decides who may read it; this helper just opens the file read-only.
NIV_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "niv.db")


def niv_db():
    """Read-only connection to niv.db. Raises sqlite3.OperationalError if the file
    isn't there yet (niv.db not loaded) — callers catch that and return empty."""
    conn = sqlite3.connect(f"file:{NIV_DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# The Hebrew OT interlinear (Westminster Leningrad Codex via OpenScriptures morphhb)
# is PUBLIC DOMAIN — unlike the ESV/NIV above it is NOT owner-gated; it's meant to be
# a public study text like ABP/KJV/BSB. It still lives in its OWN file, heb.db, kept
# OUT of bible.db (the corpus is rebuilt; this text isn't) and OUT of git (*.db is
# gitignored), loaded on PythonAnywhere only by scripts/load_hebrew.py.
HEB_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "heb.db")


def heb_db():
    """Read-only connection to heb.db. Raises sqlite3.OperationalError if the file
    isn't there yet (heb.db not loaded) — callers catch that and return empty."""
    conn = sqlite3.connect(f"file:{HEB_DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# ── Unified AI-synthesis result cache ────────────────────────────────────────
# Every Haiku-backed synthesis (search, summary, xref, metav person/place) stores
# its rows in ai_search_cache with ver_key = "<category>:<fingerprint>", the
# fingerprint being a hash of THAT synthesis's own prompt text. Editing a prompt
# changes only its category's fingerprint, so only that cache lazily refreshes, and
# each category prunes only its own stale rows. The row KEY (`query`) stays stable,
# so a regenerate OVERWRITES the stale row in place (it's the PRIMARY KEY) instead
# of leaving parallel old/new rows behind.

def ai_fingerprint(category: str, *parts) -> str:
    """'<category>:<16-hex sha1 of parts>'. `parts` = the prompt material that, when
    edited, should invalidate this category's cache (system prompt + instruction
    templates, plus any manual code-version salt for non-prompt logic changes)."""
    raw = "|".join(str(p) for p in parts)
    return f"{category}:{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]}"


def ai_cache_get(query: str, ver_key: str):
    """Cached payload for (query, ver_key), or None. A row written under a DIFFERENT
    ver_key (an older prompt) deliberately misses here so it regenerates."""
    conn = db_ro()
    try:
        row = conn.execute(
            "SELECT result_json FROM ai_search_cache WHERE query=? AND ver_key=?",
            (query, ver_key),
        ).fetchone()
    finally:
        conn.close()
    if row:
        try:
            return json.loads(row["result_json"])
        except Exception:
            return None
    return None


def ai_cache_put(query: str, payload: dict, ver_key: str) -> None:
    """Write one cache row (fire-and-forget; errors are logged only)."""
    try:
        conn = db()
        conn.execute(
            "INSERT OR REPLACE INTO ai_search_cache"
            " (query, result_json, ver_key, created_at) VALUES (?,?,?,?)",
            (query, json.dumps(payload), ver_key, time.time()),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        log.warning("Could not persist %s cache entry: %s", ver_key.split(":", 1)[0], exc)


def ai_cache_prune(category: str, keep_prefix: str) -> int:
    """Delete this category's STALE rows — ver_key starting '<category>:' but not
    under `keep_prefix` — and nothing else. `keep_prefix` is the current ver_key for
    a single-version category (search/xref/pn), or the shared template prefix
    'summary:<tpl>' for summaries (whose rows carry a per-book author suffix)."""
    try:
        conn = db()
        n = conn.execute(
            "DELETE FROM ai_search_cache"
            " WHERE ver_key LIKE ? AND ver_key NOT LIKE ?",
            (f"{category}:%", f"{keep_prefix}%"),
        ).rowcount
        conn.commit()
        conn.close()
        return n
    except Exception as exc:
        log.warning("Could not prune %s cache: %s", category, exc)
        return 0


def ai_cache_drop_legacy() -> int:
    """One-time sweep of pre-unification rows. Every legacy ver_key is colonless
    (bare-hex search hashes + the literals 'summary'/'xref'/'pn'); every new ver_key
    is '<category>:<hash>'. So 'has no colon' cleanly identifies all old rows. They
    would otherwise linger forever — get() filters on the new ver_key so they're
    never served, and ai_cache_prune only matches '<category>:%'. Harmless to re-run
    once they're gone (matches nothing)."""
    try:
        conn = db()
        n = conn.execute(
            "DELETE FROM ai_search_cache WHERE ver_key NOT LIKE '%:%'"
        ).rowcount
        conn.commit()
        conn.close()
        return n
    except Exception as exc:
        log.warning("Could not drop legacy cache rows: %s", exc)
        return 0


def _strongs_num(q: str):
    """Return the numeric portion if q looks like a Strong's ref, else None."""
    m = _STRONGS_RE.match(q.strip())
    return m.group(1) if m else None


def _serialize_word_core(row) -> dict:
    """Canonical core fields for an ABP words+lexicon row, built ONE way so the
    three word serializers (chapter_text / verse_words / _fetch_verse_words) can't
    drift — drift is what caused the is_pn-in-chapter bug. Each caller spreads this
    and adds its own extras (position, morph, pn_type, smcap_words, strongs_def,
    derivation, gloss, is_function/is_content, and italic's int-vs-bool form).
    Requires the row to expose: english, english_head, strongs, strongs_base,
    greek_pos, bracket_id, italic_words, lemma, translit, kjv_def, is_pn."""
    return {
        "english":      row["english"],
        "english_head": row["english_head"],
        "strongs":      row["strongs"],
        "strongs_base": row["strongs_base"],
        "greek_pos":    row["greek_pos"],
        "bracket_id":   row["bracket_id"],
        "italic_words": row["italic_words"],
        "lemma":        row["lemma"],
        "translit":     row["translit"],
        "kjv_def":      row["kjv_def"],
        "is_pn":        bool(row["is_pn"] or 0),
    }


def _clean_gloss(s: str | None) -> str | None:
    """Strip trailing punctuation that ABP interlinear leaves on phrase-boundary words."""
    if not s:
        return s
    return s.strip(" ,;:.!?—-)(][")
