#!/usr/bin/env python3
"""Hebrew OT interlinear — a PUBLIC reading text (Westminster Leningrad Codex).

Unlike views_esv.py / views_niv.py (owner-only copyrighted texts), the Hebrew is
public domain, so these routes are OPEN — no owner gate, served like ABP/KJV/BSB.
The text lives in its OWN file, heb.db (core.heb_db), loaded on PA by
scripts/load_hebrew.py — never in bible.db, never in git (*.db is gitignored).

Right-to-left rendering happens in the frontend; here we just hand back each word
with its Hebrew (vowel points, no chant accents), Strong's H-number, grammar code,
and short English gloss, in reading order. The H-number drives the existing BDB
lexicon sidebar, so word-clicks light up with no extra wiring.

During rollout the FRONTEND shows the HEB toggle only to the owner (status.owner)
so visitors don't see a half-loaded OT; flip that to status.available once all 39
books are in. The data route itself stays public the whole time (public-domain text).

Endpoints:
  GET /api/hebrew/status                          -> {available: bool, owner: bool}
  GET /api/hebrew/chapter/<book>/<chapter>        -> [{verse, heading, words:[...]}]
  GET /api/hebrew/verse-words/<book>/<ch>/<verse> -> {words:[...]}  (one verse, for the side card)
"""
import sqlite3

from flask import Blueprint, jsonify

from core import db_ro, heb_db
from views_notes import is_owner as _is_owner   # only to gate VISIBILITY during rollout


bp = Blueprint("hebrew", __name__)


@bp.route("/api/hebrew/status")
def hebrew_status():
    """Yes/no for the frontend: is the Hebrew text loaded, and is the caller the
    owner. The toggle shows on `available` once public; on `owner` during rollout."""
    available = False
    try:
        conn = heb_db()
        try:
            available = conn.execute("SELECT 1 FROM heb_words LIMIT 1").fetchone() is not None
        finally:
            conn.close()
    except sqlite3.OperationalError:
        available = False                                 # heb.db / table not there yet
    return jsonify({"available": available, "owner": _is_owner()})


@bp.route("/api/hebrew/chapter/<book>/<int:chapter>")
def hebrew_chapter(book, chapter):
    # Public, public-domain text — no owner gate (cf. ESV/NIV which 404 non-owners).
    # The book id is the app's own abbreviation (e.g. "Jon"); heb_words stores that
    # directly, so no numeric mapping is needed. An unknown book just returns [].
    try:
        conn = heb_db()
    except sqlite3.OperationalError:
        return jsonify([])                                # heb.db not loaded yet
    try:
        try:
            rows = conn.execute(
                "SELECT verse, position, hebrew, strongs, morph, gloss, translit, grammar"
                " FROM heb_words WHERE book = ? AND chapter = ? ORDER BY verse, position",
                (book, chapter),
            ).fetchall()
        except sqlite3.OperationalError:
            # heb.db built before the translit/grammar columns existed — read the legacy shape
            rows = conn.execute(
                "SELECT verse, position, hebrew, strongs, morph, gloss"
                " FROM heb_words WHERE book = ? AND chapter = ? ORDER BY verse, position",
                (book, chapter),
            ).fetchall()
    except sqlite3.OperationalError:
        return jsonify([])                                # heb_words table missing
    finally:
        conn.close()

    # section headings (shared) from bible.db's pericopes, same as niv/esv
    headings = {}
    try:
        bconn = db_ro()
        try:
            for r in bconn.execute(
                "SELECT verse, heading FROM pericopes WHERE book = ? AND chapter = ?",
                (book, chapter),
            ):
                headings[r["verse"]] = r["heading"]
        finally:
            bconn.close()
    except sqlite3.OperationalError:
        pass

    # group the flat word rows into verses, in reading order
    verses, cur_v, cur_words = [], None, None
    for r in rows:
        if r["verse"] != cur_v:
            cur_v = r["verse"]
            cur_words = []
            verses.append({"verse": cur_v, "heading": headings.get(cur_v), "words": cur_words})
        cur_words.append({
            "pos": r["position"],
            "hebrew": r["hebrew"],
            "strongs": r["strongs"],
            "morph": r["morph"],
            "gloss": r["gloss"],
            "translit": (r["translit"] if "translit" in r.keys() else ""),
            "grammar": (r["grammar"] if "grammar" in r.keys() else ""),
        })
    return jsonify(verses)


@bp.route("/api/hebrew/verse-words/<book>/<int:chapter>/<int:verse>")
def hebrew_verse_words(book, chapter, verse):
    """One verse's Hebrew words for the word-detail SIDE CARD interlinear. Same word
    shape as the chapter route, just a single verse. Returns {words:[]} if heb.db
    isn't loaded (so the side card simply shows nothing, never errors)."""
    try:
        conn = heb_db()
    except sqlite3.OperationalError:
        return jsonify({"words": []})                     # heb.db not loaded yet
    try:
        try:
            rows = conn.execute(
                "SELECT position, hebrew, strongs, gloss, translit"
                " FROM heb_words WHERE book = ? AND chapter = ? AND verse = ? ORDER BY position",
                (book, chapter, verse),
            ).fetchall()
        except sqlite3.OperationalError:
            # heb.db built before the translit column existed — read the legacy shape
            rows = conn.execute(
                "SELECT position, hebrew, strongs, gloss"
                " FROM heb_words WHERE book = ? AND chapter = ? AND verse = ? ORDER BY position",
                (book, chapter, verse),
            ).fetchall()
    except sqlite3.OperationalError:
        return jsonify({"words": []})                     # heb_words table missing
    finally:
        conn.close()
    words = [{
        "hebrew": r["hebrew"],
        "strongs": r["strongs"],
        "gloss": r["gloss"],
        "translit": (r["translit"] if "translit" in r.keys() else ""),
    } for r in rows]
    return jsonify({"words": words})
