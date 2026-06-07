#!/usr/bin/env python3
"""Shared core for the Lexica Flask app (Phase 3 of REDESIGN_PLAN.md).

App-independent layer that the view modules import: DB connections, the rate
limiter (created WITHOUT an app — app.py calls limiter.init_app(app)), the
Anthropic client, small shared helpers, and the function-word set. This module
imports NOTHING from the view modules or app.py, so there are no circular imports.

The `_FUNCTION_STRONGS` set is declared here but POPULATED IN PLACE at startup by
app.py's `_build_function_strongs_cache` (clear()+update(), never reassigned) so
that `from core import _FUNCTION_STRONGS` references stay valid after the rebuild.
"""
import logging
import os
import re
import sqlite3

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
limiter = Limiter(get_remote_address, default_limits=[], storage_uri="memory://")

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
    return conn


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
