#!/usr/bin/env python3
"""Library (ABP interlinear) reading routes (Phase 3 of REDESIGN_PLAN.md).

The ABP primary text: per-verse plain text, per-verse word list (interlinear
stack), the book list with chapter counts, and the full chapter render (with
pericope headings + proper-noun typing). Word dicts are built via the shared
core._serialize_word_core so chapter_text / verse_words can't drift.
"""
import re

from flask import Blueprint, jsonify

from core import db, _serialize_word_core, _FUNCTION_STRONGS

bp = Blueprint("library", __name__)


@bp.route("/api/verse/<book>/<int:chapter>/<int:verse>")
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


@bp.route("/api/verse-words/<book>/<int:chapter>/<int:verse>")
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
            """SELECT w.position, w.english, w.english_head, w.greek_pos, w.bracket_id, w.italic,
                      COALESCE(w.italic_words, '') AS italic_words,
                      w.strongs_base, w.strongs, w.is_pn, w.morph,
                      l.lemma, l.translit, l.kjv_def, l.strongs_def, l.derivation,
                      t.entity_type AS pn_type, t.entity_types AS pn_types
               FROM words w
               LEFT JOIN lexicon l ON l.strongs_g = w.strongs_base
               LEFT JOIN tipnr t ON t.strongs = w.strongs_base
               WHERE w.verse_id = ?
               ORDER BY w.position""",
            (row["id"],),
        ).fetchall()
    finally:
        conn.close()
    return jsonify({
        "words": [
            {
                **_serialize_word_core(w),
                "position":    w["position"],
                "italic":      bool(w["italic"]),
                "morph":       w["morph"],
                "strongs_def": (w["strongs_def"] or "").strip(),
                "derivation":  (w["derivation"] or "").strip(),
                "pn_type":     w["pn_type"],
                "pn_types":    w["pn_types"],
                "is_content":  w["strongs_base"] not in _FUNCTION_STRONGS,
            }
            for w in wrows
        ]
    })


@bp.route("/api/books")
def books_list():
    conn = db()
    try:
        rows = conn.execute("""
            SELECT b.abbrev, b.name, MAX(v.chapter) AS chapters
            FROM books b
            JOIN verses v ON v.book = b.abbrev
            GROUP BY b.abbrev, b.name
            ORDER BY COALESCE(b.sort_order, b.id)
        """).fetchall()
    finally:
        conn.close()
    return jsonify([{"abbrev": r["abbrev"], "name": r["name"], "chapters": r["chapters"]} for r in rows])


# Non-canonical texts (Didache, etc.) each live in their OWN two tables,
# `<book>_words` / `<book>_verses`, created by scripts/didache_proof/load_extra.py.
# They are walled off from the Bible's words/verses and from search + lexicon counts.
_EXTRA_BOOK_RE = re.compile(r"^[a-z0-9_]+$")   # table-name safe; blocks anything odd


@bp.route("/api/extra/<book>/chapter/<int:chapter>")
def extra_chapter(book, chapter):
    """Serve one chapter of a non-canonical text in the shape the Library reader
    consumes, plus a readable-English line per verse. Degrades quietly (empty
    list) if the text's tables haven't been loaded on PA yet."""
    if not _EXTRA_BOOK_RE.match(book):
        return jsonify([])
    wtable, vtable = f"{book}_words", f"{book}_verses"
    conn = db()
    try:
        have = {r["name"] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?)",
            (wtable, vtable)
        ).fetchall()}
        if wtable not in have:
            return jsonify([])
        # join the lexicon for the transliteration (same key the Bible uses:
        # lexicon.strongs_g = 'G####'); the Didache words carry that G-number.
        wrows = conn.execute(
            f"""SELECT w.verse, w.position, w.greek, w.lemma, w.strongs, w.gloss, l.translit
                FROM {wtable} w
                LEFT JOIN lexicon l ON l.strongs_g = w.strongs
                WHERE w.chapter=? ORDER BY w.verse, w.position""", (chapter,)
        ).fetchall()
        # `heading` was added later — only select it if the table has it, so an
        # older (pre-headings) load still serves cleanly until the next reload.
        has_heading = vtable in have and any(
            c["name"] == "heading" for c in conn.execute(f"PRAGMA table_info({vtable})")
        )
        vsel = "verse, english, heading" if has_heading else "verse, english"
        vrows = conn.execute(
            f"SELECT {vsel} FROM {vtable} WHERE chapter=? ORDER BY verse",
            (chapter,)
        ).fetchall() if vtable in have else []
    finally:
        conn.close()
    english = {r["verse"]: r["english"] for r in vrows}
    headings = {r["verse"]: r["heading"] for r in vrows} if has_heading else {}
    verses: dict[int, list] = {}
    order: list[int] = []
    for r in wrows:
        vn = r["verse"]
        if vn not in verses:
            verses[vn] = []
            order.append(vn)
        sg = r["strongs"] or ""                          # "G1322" or ""
        verses[vn].append({
            "position":     r["position"],
            "english":      r["gloss"],                  # per-word gloss (interlinear)
            "english_head": None,
            "lemma":        r["lemma"],                  # Greek dictionary form
            "translit":     r["translit"],               # romanized form (from lexicon)
            "greek":        r["greek"],                  # inflected form as printed
            "strongs_base": sg or None,                 # G-number → drives word-study click
            "strongs":      sg[1:] if sg else None,      # bare, frontend renders G{strongs}
            "greek_pos":    None,
            "bracket_id":   None,
            "italic":       0,
            "is_pn":        0,
            "morph":        None,
        })
    return jsonify([
        {"verse": v, "heading": headings.get(v), "english": english.get(v, ""), "words": verses[v]}
        for v in order
    ])


@bp.route("/api/chapter/<book>/<int:chapter>")
def chapter_text(book, chapter):
    conn = db()
    try:
        rows = conn.execute(
            """SELECT v.verse, v.text AS prose, w.position, w.english, w.english_head, w.strongs_base, w.strongs,
                      l.lemma, l.translit, l.kjv_def, w.greek_pos, w.bracket_id, w.italic, w.is_pn, w.morph,
                      COALESCE(w.italic_words, '') AS italic_words,
                      COALESCE(w.smcap_words,  '') AS smcap_words,
                      t.entity_type AS pn_type, t.entity_types AS pn_types,
                      p.heading
               FROM verses v
               JOIN words w ON w.verse_id = v.id
               LEFT JOIN lexicon l ON l.strongs_g = w.strongs_base
               LEFT JOIN tipnr t ON t.strongs = w.strongs_base
               LEFT JOIN pericopes p ON p.book = v.book AND p.chapter = v.chapter AND p.verse = v.verse
               WHERE v.book = ? AND v.chapter = ?
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
            verses[vn] = {"words": [], "heading": r["heading"], "prose": r["prose"]}
            order.append(vn)
        verses[vn]["words"].append({
            **_serialize_word_core(r),
            "position":     r["position"],
            "italic":       r["italic"],
            "morph":        r["morph"],
            "smcap_words":  r["smcap_words"],
            "pn_type":      r["pn_type"],
            "pn_types":     r["pn_types"],
        })
    return jsonify([
        {
            "verse": v,
            "heading": verses[v]["heading"],
            "prose": verses[v]["prose"],
            "words": verses[v]["words"],
        }
        for v in order
    ])
