#!/usr/bin/env python3
"""Berean Standard Bible (BSB) routes.

BSB is a reading + plain-text-search corpus only — no word-level / Strong's
data (ABP and KJV already carry that). One table, bsb_verses, mirroring
kjv_verses on the same 1-66 book-id numbering (core._KJV_BOOK_ID).

Two endpoints:
  GET /api/bsb/chapter/<book>/<chapter>  — verses for a chapter (+ pericope headings)
  GET /api/bsb/search?q=&mode=&book=     — eSword-style plain-text find

If bsb_verses hasn't been loaded yet (scripts/load_bsb.py), both endpoints
return empty rather than erroring, so deploying the code before the data is safe.
"""
import sqlite3

from flask import Blueprint, jsonify, request

from core import db_ro, _KJV_BOOK_ID, _USFM_BOOK, usfm_titlecase

bp = Blueprint("bsb", __name__)

# openbible.com hosts the public-domain (CC0) BSB narration. Plain narrator
# (Souer), one mp3 per chapter at a fixed pattern:
#   https://openbible.com/audio/souer/BSB_<NN>_<Abbr>_<CCC>.mp3
# NN = 01-66 book number, Abbr = title-cased USFM code (Gen, Jdg, Mrk, Jhn...),
# CCC = zero-padded chapter. No key, freely streamable, so we just hand the
# browser the URL to play in an <audio> tag.
_BSB_AUDIO_BASE = "https://openbible.com/audio/souer"


@bp.route("/api/bsb/chapter/<book>/<int:chapter>")
def bsb_chapter(book, chapter):
    book_id = _KJV_BOOK_ID.get(book)
    if book_id is None:
        return jsonify([])
    conn = db_ro()
    try:
        rows = conn.execute(
            "SELECT verse_num, verse_text FROM bsb_verses "
            "WHERE book_id = ? AND chapter = ? ORDER BY verse_num",
            (book_id, chapter),
        ).fetchall()
        pericope_rows = conn.execute(
            "SELECT verse, heading FROM pericopes WHERE book = ? AND chapter = ?",
            (book, chapter),
        ).fetchall()
    except sqlite3.OperationalError:
        return jsonify([])           # bsb_verses not loaded yet
    finally:
        conn.close()
    headings = {r["verse"]: r["heading"] for r in pericope_rows}
    return jsonify([
        {
            "verse": r["verse_num"],
            "verse_text": r["verse_text"],
            "heading": headings.get(r["verse_num"]),
        }
        for r in rows
    ])

@bp.route("/api/bsb/audio/<book>/<int:chapter>")
def bsb_audio(book, chapter):
    """Public-domain BSB chapter narration URL (openbible.com). Returns {url}; no
    key, no gate — BSB is public. {url: None} if the book isn't recognized."""
    book_id = _KJV_BOOK_ID.get(book)
    usfm = _USFM_BOOK.get(book)
    if book_id is None or not usfm:
        return jsonify({"url": None})
    fname = f"BSB_{book_id:02d}_{usfm_titlecase(usfm)}_{chapter:03d}.mp3"
    return jsonify({"url": f"{_BSB_AUDIO_BASE}/{fname}"})


# NOTE: plain-text BSB search lives in views_search.py's generic /api/text-search
# (corpus=bsb), which also covers KJV and ABP. No BSB-specific search route here.
