#!/usr/bin/env python3
import re
import sqlite3

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
DB = "bible.db"


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/search")
def search():
    q = request.args.get("q", "").strip()
    whole_words = request.args.get("w", "0") == "1"

    if not q:
        return jsonify({"results": [], "total": 0})

    conn = db()
    rows = conn.execute(
        """
        SELECT w.strongs_base, w.strongs, w.english, w.english_head,
               v.id AS verse_id, v.book, v.chapter, v.verse,
               l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
        FROM words w
        JOIN verses v ON w.verse_id = v.id
        LEFT JOIN lexicon l ON l.strongs = w.strongs_base
        WHERE w.english_head LIKE ? COLLATE NOCASE
        ORDER BY v.id, w.position
        """,
        (f"%{q}%",),
    ).fetchall()
    conn.close()

    if whole_words:
        pat = re.compile(r"\b" + re.escape(q) + r"\b", re.IGNORECASE)
        rows = [r for r in rows if pat.search(r["english_head"] or "")]

    results = [
        {
            "ref":        f"{r['book']} {r['chapter']}:{r['verse']}",
            "book":       r["book"],
            "chapter":    r["chapter"],
            "verse":      r["verse"],
            "strongs":    r["strongs"],
            "strongs_base": r["strongs_base"],
            "gloss":      r["english"],
            "lemma":      r["lemma"],
            "translit":   r["translit"],
            "strongs_def": (r["strongs_def"] or "").strip(),
            "kjv_def":    r["kjv_def"],
            "derivation": (r["derivation"] or "").strip(),
        }
        for r in rows
    ]

    return jsonify({"results": results, "total": len(results)})


@app.route("/api/verse/<book>/<int:chapter>/<int:verse>")
def verse_text(book, chapter, verse):
    conn = db()
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
    conn.close()

    return jsonify({"text": " ".join(w["english"] for w in words)})


if __name__ == "__main__":
    app.run(debug=True)
