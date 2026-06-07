#!/usr/bin/env python3
"""KJV parallel-corpus routes (Phase 3 of REDESIGN_PLAN.md).

Chapter/verse rendering, per-word strongs lookups, batch verse-word fetch, and
the KJV strongs count/search endpoints. KJV uses standard Protestant BookIDs
(1-66) via core._KJV_BOOK_ID, bypassing the ABP books-table join.

NOTE: this is the KJV /api/kjv/strongs-search ROUTE, distinct from the
_kjv_strongs_search HELPER used by the search blueprint.
"""
from flask import Blueprint, jsonify, request

from core import db_ro, _KJV_BOOK_ID, _KJV_BOOK_ID_REV

bp = Blueprint("kjv", __name__)


@bp.route("/api/kjv/chapter/<book>/<int:chapter>")
def kjv_chapter(book, chapter):
    book_id = _KJV_BOOK_ID.get(book)
    if book_id is None:
        return jsonify([])
    conn = db_ro()
    try:
        rows = conn.execute("""
            SELECT kw.verse_num, kw.word_id, kw.verse_pos, kw.word, kw.italic, kw.punc,
                   GROUP_CONCAT(ks.strongs_id) AS strongs_ids,
                   kv.verse_text,
                   MAX(COALESCE(bdb.lemma, lex.lemma)) AS lemma,
                   MAX(COALESCE(bdb.xlit, lex.translit)) AS xlit
            FROM kjv_words kw
            LEFT JOIN kjv_strongs ks ON ks.word_id = kw.word_id
            LEFT JOIN kjv_verses kv ON kv.book_id = kw.book_id
                AND kv.chapter = kw.chapter AND kv.verse_num = kw.verse_num
            LEFT JOIN bdb ON bdb.strongs_id = ks.strongs_id AND ks.strongs_id LIKE 'H%'
            LEFT JOIN lexicon lex ON lex.strongs_g = ks.strongs_id
            WHERE kw.book_id = ? AND kw.chapter = ?
            GROUP BY kw.word_id, kw.verse_num, kw.verse_pos, kw.word, kw.italic, kw.punc, kv.verse_text
            ORDER BY kw.verse_num, kw.verse_pos
        """, (book_id, chapter)).fetchall()
        pericope_rows = conn.execute(
            "SELECT verse, heading FROM pericopes WHERE book = ? AND chapter = ?",
            (book, chapter)
        ).fetchall()
    finally:
        conn.close()
    headings = {r["verse"]: r["heading"] for r in pericope_rows}
    verses: dict[int, dict] = {}
    order: list[int] = []
    for r in rows:
        vn = r["verse_num"]
        if vn not in verses:
            verses[vn] = {"verse": vn, "words": [], "verse_text": r["verse_text"], "heading": headings.get(vn)}
            order.append(vn)
        sids = [s.strip() for s in (r["strongs_ids"] or "").split(",") if s.strip()]
        verses[vn]["words"].append({
            "word_id":   r["word_id"],
            "verse_pos": r["verse_pos"],
            "word":      r["word"],
            "italic":    bool(r["italic"]),
            "punc":      r["punc"] or "",
            "strongs_ids": sids,
            "lemma":     r["lemma"] or "",
            "xlit":      r["xlit"] or "",
        })
    return jsonify([verses[v] for v in order])


@bp.route("/api/kjv/verse/<book>/<int:chapter>/<int:verse_num>")
def kjv_verse_text(book, chapter, verse_num):
    book_id = _KJV_BOOK_ID.get(book)
    if book_id is None:
        return jsonify({"error": "not found"}), 404
    conn = db_ro()
    try:
        row = conn.execute(
            "SELECT verse_text FROM kjv_verses WHERE book_id = ? AND chapter = ? AND verse_num = ?",
            (book_id, chapter, verse_num)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify({"text": row["verse_text"]})


@bp.route("/api/kjv/verse_words/<book>/<int:chapter>/<int:verse_num>")
def kjv_verse_words(book, chapter, verse_num):
    book_id = _KJV_BOOK_ID.get(book)
    if book_id is None:
        return jsonify([])
    conn = db_ro()
    try:
        rows = conn.execute("""
            SELECT kw.word_id, kw.verse_pos, kw.word, kw.italic, kw.punc,
                   GROUP_CONCAT(ks.strongs_id) AS strongs_ids,
                   MAX(COALESCE(bdb.lemma, lex.lemma)) AS lemma,
                   MAX(COALESCE(bdb.xlit, lex.translit)) AS xlit
            FROM kjv_words kw
            LEFT JOIN kjv_strongs ks ON ks.word_id = kw.word_id
            LEFT JOIN bdb ON bdb.strongs_id = ks.strongs_id AND ks.strongs_id LIKE 'H%'
            LEFT JOIN lexicon lex ON lex.strongs_g = ks.strongs_id
            WHERE kw.book_id = ? AND kw.chapter = ? AND kw.verse_num = ?
            GROUP BY kw.word_id, kw.verse_pos, kw.word, kw.italic, kw.punc
            ORDER BY kw.verse_pos
        """, (book_id, chapter, verse_num)).fetchall()
    finally:
        conn.close()
    words = []
    for r in rows:
        sids = [s.strip() for s in (r["strongs_ids"] or "").split(",") if s.strip()]
        words.append({
            "word_id":    r["word_id"],
            "word":       r["word"],
            "italic":     bool(r["italic"]),
            "punc":       r["punc"] or "",
            "strongs_ids": sids,
            "lemma":      r["lemma"] or "",
            "xlit":       r["xlit"] or "",
        })
    return jsonify(words)


@bp.route("/api/kjv/verse_words_batch", methods=["POST"])
def kjv_verse_words_batch():
    """Batch fetch KJV verse words for multiple verses at once."""
    refs = request.get_json(silent=True) or []  # [{book, chapter, verse}, ...]
    if not isinstance(refs, list):
        return jsonify({})
    conn = db_ro()
    result = {}
    try:
        for ref in refs[:30]:  # cap at 30
            if not isinstance(ref, dict):
                continue
            book = ref.get("book", "")
            chapter = ref.get("chapter", 0)
            verse_num = ref.get("verse", 0)
            book_id = _KJV_BOOK_ID.get(book)
            if not book_id:
                continue
            rows = conn.execute("""
                SELECT kw.word_id, kw.verse_pos, kw.word, kw.italic, kw.punc,
                       GROUP_CONCAT(ks.strongs_id) AS strongs_ids,
                       MAX(COALESCE(bdb.lemma, lex.lemma)) AS lemma,
                       MAX(COALESCE(bdb.xlit, lex.translit)) AS xlit
                FROM kjv_words kw
                LEFT JOIN kjv_strongs ks ON ks.word_id = kw.word_id
                LEFT JOIN bdb ON bdb.strongs_id = ks.strongs_id AND ks.strongs_id LIKE 'H%'
                LEFT JOIN lexicon lex ON lex.strongs_g = ks.strongs_id
                WHERE kw.book_id = ? AND kw.chapter = ? AND kw.verse_num = ?
                GROUP BY kw.word_id, kw.verse_pos, kw.word, kw.italic, kw.punc
                ORDER BY kw.verse_pos
            """, (book_id, chapter, verse_num)).fetchall()
            words = []
            for r in rows:
                sids = [s.strip() for s in (r["strongs_ids"] or "").split(",") if s.strip()]
                words.append({
                    "word_id": r["word_id"],
                    "word": r["word"],
                    "italic": bool(r["italic"]),
                    "punc": r["punc"] or "",
                    "strongs_ids": sids,
                    "lemma": r["lemma"] or "",
                    "xlit": r["xlit"] or "",
                })
            key = f"{book}:{chapter}:{verse_num}"
            result[key] = words
    finally:
        conn.close()
    return jsonify(result)


@bp.route("/api/kjv/strongs-count/<strongs_id>")
def kjv_strongs_count(strongs_id):
    conn = db_ro()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM kjv_strongs WHERE strongs_id = ?",
            (strongs_id.upper(),)
        ).fetchone()
    finally:
        conn.close()
    return jsonify({"count": row["cnt"] if row else 0})


@bp.route("/api/kjv/strongs-search/<strongs_id>")
def kjv_strongs_search(strongs_id):
    """Return all KJV verses containing a given Strong's ID, one entry per word occurrence."""
    sid = strongs_id.upper()
    conn = db_ro()
    try:
        rows = conn.execute("""
            SELECT kw.book_id, kw.chapter, kw.verse_num, kw.word,
                   MAX(COALESCE(bdb.lemma, lex.lemma))   AS lemma,
                   MAX(COALESCE(bdb.xlit, lex.translit)) AS xlit,
                   MAX(COALESCE(lex.strongs_def, bdb.description)) AS definition
            FROM kjv_strongs ks
            JOIN kjv_words kw ON kw.word_id = ks.word_id
            LEFT JOIN bdb ON bdb.strongs_id = ks.strongs_id AND ks.strongs_id LIKE 'H%'
            LEFT JOIN lexicon lex ON lex.strongs_g = ks.strongs_id
            WHERE ks.strongs_id = ?
            GROUP BY kw.book_id, kw.chapter, kw.verse_num, kw.word
            ORDER BY kw.book_id, kw.chapter, kw.verse_num
        """, (sid,)).fetchall()
    finally:
        conn.close()
    results = []
    base = sid.lstrip("GH")
    for r in rows:
        book_abbrev = _KJV_BOOK_ID_REV.get(r["book_id"], "")
        results.append({
            "strongs":      sid,
            "strongs_base": base,
            "strongs_raw":  base,
            "greek":        r["lemma"] or "",
            "translit":     r["xlit"] or "",
            "gloss":        r["word"] or "",
            "ref":          f"{book_abbrev} {r['chapter']}:{r['verse_num']}",
            "book":         book_abbrev,
            "chapter":      r["chapter"],
            "verse":        r["verse_num"],
            "definition":   r["definition"] or "",
            "derivation":   "",
            "is_function":  False,
            "isKjv":        True,
            "isHebrew":     sid.startswith("H"),
        })
    return jsonify({"results": results})
