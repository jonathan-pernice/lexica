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

# Public-domain KJV chapter narration, hosted by audiotreasure.com. Two recordings:
#   VOICE (preferred) — Stephen Johnston, voice-only, ~60% higher bitrate (clearer):
#       /content/KJV_AT/<NN>_<Name><CCC>.mp3   (3-digit chapter glued to the name)
#   MUSIC (fallback)  — "Firefighters for Christ", narrator + soft music bed, lower bitrate:
#       /content/KJV_FF/<NN>_<Name>_<chap>.mp3 (chap 2-digit, Psalms 3-digit)
# The VOICE set is missing files for 6 books on the host (their page links 404), so those
# fall back to the MUSIC set — every book still plays. Book-name tokens are each site
# folder's own irregular spellings (pinned, not derived). No key; files stream cross-site,
# so we just hand the browser the URL for an <audio> tag (same approach as BSB). A
# DRAMATIZED multi-voice KJV is the FCBH recording, which needs the pending Bible Brain key.
_KJV_VOICE_BASE = "https://www.audiotreasure.com/content/KJV_AT"
_KJV_MUSIC_BASE = "https://www.audiotreasure.com/content/KJV_FF"
# book_id -> KJV_AT (voice) book-name token. Proper-ish spellings ("Psalms" is plural here).
_KJV_VOICE_NAME = {
    1: "Genesis", 2: "Exodus", 3: "Leviticus", 4: "Numbers", 5: "Deuteronomy",
    6: "Joshua", 7: "Judges", 8: "Ruth", 9: "1Samuel", 10: "2Samuel",
    11: "1Kings", 12: "2Kings", 13: "1Chronicles", 14: "2Chronicles", 15: "Ezra",
    16: "Nehemiah", 17: "Esther", 19: "Psalms", 20: "Proverbs", 21: "Ecclesiastes",
    23: "Isaiah", 24: "Jeremiah", 25: "Lamentations", 26: "Ezekiel", 27: "Daniel",
    28: "Hosea", 29: "Joel", 30: "Amos", 31: "Obadiah", 32: "Jonah", 33: "Micah",
    34: "Nahum", 35: "Habakkuk", 36: "Zephaniah", 37: "Haggai", 38: "Zechariah",
    39: "Malachi", 40: "Matthew", 41: "Mark", 42: "Luke", 43: "John", 44: "Acts",
    45: "Romans", 46: "1Corinthians", 47: "2Corinthians", 48: "Galatians",
    49: "Ephesians", 50: "Philippians", 51: "Colossians", 52: "1Thessalonians",
    53: "2Thessalonians", 54: "1Timothy", 55: "2Timothy", 56: "Titus",
    58: "Hebrews", 59: "James", 60: "1Peter", 61: "2Peter", 62: "1John",
    66: "Revelation",
}
# Books whose KJV_AT (voice) files are absent on the host -> use the MUSIC set instead.
_KJV_VOICE_MISSING = {18, 22, 57, 63, 64, 65}   # Job, Song of Solomon, Philemon, 2/3 John, Jude
# book_id -> KJV_FF (music) book-name token. Irregular ("Soloman" typo, "Prov", "1Cor"...).
_KJV_MUSIC_NAME = {
    1: "Genesis", 2: "Exodus", 3: "Leviticus", 4: "Numbers", 5: "Deuteronomy",
    6: "Joshua", 7: "Judges", 8: "Ruth", 9: "1Samuel", 10: "2Samuel",
    11: "1Kings", 12: "2Kings", 13: "1Chronicles", 14: "2Chronicles", 15: "Ezra",
    16: "Nehemiah", 17: "Esther", 18: "Job", 19: "Psalm", 20: "Prov",
    21: "Ecclesiastes", 22: "Song_of_Soloman", 23: "Isaiah", 24: "Jeremiah",
    25: "Lamentations", 26: "Ezekiel", 27: "Daniel", 28: "Hosea", 29: "Joel",
    30: "Amos", 31: "Obadiah", 32: "Jonah", 33: "Micah", 34: "Nahum",
    35: "Habakkuk", 36: "Zephaniah", 37: "Haggai", 38: "Zechariah", 39: "Malachi",
    40: "Matthew", 41: "Mark", 42: "Luke", 43: "John", 44: "Acts", 45: "Romans",
    46: "1Cor", 47: "2Cor", 48: "Gal", 49: "Ephesians", 50: "Philippians",
    51: "Colossians", 52: "1Thess", 53: "2Thess", 54: "1Timothy", 55: "2Timothy",
    56: "Titus", 57: "Philemon", 58: "Hebrews", 59: "James", 60: "1Peter",
    61: "2Peter", 62: "1John", 63: "2John", 64: "3John", 65: "Jude",
    66: "Revelation",
}


@bp.route("/api/kjv/audio/<book>/<int:chapter>")
def kjv_audio(book, chapter):
    """Public-domain KJV chapter narration URL (audiotreasure.com). Prefers the clearer
    voice-only reading; falls back to the music reading for the books the voice set is
    missing. Returns {url}; no key, no gate — KJV is public. {url: None} if unknown."""
    book_id = _KJV_BOOK_ID.get(book)
    if book_id is None:
        return jsonify({"url": None})
    # Voice-only (clearer) where the host has it.
    if book_id not in _KJV_VOICE_MISSING and book_id in _KJV_VOICE_NAME:
        stem = f"{book_id:02d}_{_KJV_VOICE_NAME[book_id]}"
        return jsonify({"url": f"{_KJV_VOICE_BASE}/{stem}{chapter:03d}.mp3"})
    # Music fallback (complete set).
    name = _KJV_MUSIC_NAME.get(book_id)
    if not name:
        return jsonify({"url": None})
    chap = f"{chapter:03d}" if book_id == 19 else f"{chapter:02d}"
    return jsonify({"url": f"{_KJV_MUSIC_BASE}/{book_id:02d}_{name}_{chap}.mp3"})


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
