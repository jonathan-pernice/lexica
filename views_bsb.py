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

from core import db_ro, _KJV_BOOK_ID, _KJV_BOOK_ID_REV

bp = Blueprint("bsb", __name__)


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


@bp.route("/api/bsb/search")
def bsb_search():
    """Plain-text verse search over the BSB.

    q     — the search text
    mode  — 'phrase' (default: the words appear together) or 'all' (every word
            appears somewhere in the verse, any order)
    book  — optional book abbreviation (e.g. 'Joh') to limit the search
    """
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": [], "count": 0})
    mode = request.args.get("mode", "phrase")
    book = request.args.get("book", "").strip()

    where, params = [], []
    if mode == "all":
        for w in q.split():
            where.append("word_boundary(verse_text, ?)")
            params.append(w)
    else:
        where.append("verse_text LIKE ? COLLATE NOCASE")
        params.append(f"%{q}%")
    if book:
        bid = _KJV_BOOK_ID.get(book)
        if bid:
            where.append("book_id = ?")
            params.append(bid)

    sql = (
        "SELECT book_id, chapter, verse_num, verse_text FROM bsb_verses "
        "WHERE " + " AND ".join(where) +
        " ORDER BY book_id, chapter, verse_num LIMIT 1000"
    )
    conn = db_ro()
    try:
        rows = conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError:
        return jsonify({"results": [], "count": 0})
    finally:
        conn.close()

    results = [
        {
            "ref": f"{_KJV_BOOK_ID_REV.get(r['book_id'], '')} {r['chapter']}:{r['verse_num']}",
            "book": _KJV_BOOK_ID_REV.get(r["book_id"], ""),
            "chapter": r["chapter"],
            "verse": r["verse_num"],
            "text": r["verse_text"],
        }
        for r in rows
    ]
    return jsonify({"results": results, "count": len(results)})
