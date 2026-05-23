#!/usr/bin/env python3
import json
import os
import re
import sqlite3

import anthropic
from flask import Flask, jsonify, render_template, request

_AI_SYSTEM = """\
You are a query translator for a SQLite database of LXX Genesis (Apostolic Bible Polyglot interlinear).

Schema:
  verses(id, book TEXT, chapter INTEGER, verse INTEGER)   -- book is always "Gen"
  words(id, verse_id, position INTEGER,
        english TEXT,       -- full ABP gloss, e.g. "my spirit", "of God"
        english_head TEXT,  -- core/head word, e.g. "spirit", "God"
        strongs TEXT,       -- exact ABP number, e.g. "4151", "1510.7.3", "*"
        strongs_base TEXT)  -- base without dots, e.g. "1510"
  lexicon(strongs TEXT PK,  -- matches words.strongs_base
          lemma TEXT, translit TEXT, strongs_def TEXT, kjv_def TEXT, derivation TEXT)

Given a question, return ONLY valid JSON with this exact shape — no markdown, no commentary:
{
  "explanation": "<one sentence: what you understood and how you are searching>",
  "sql": "<SELECT query>"
}

The SELECT must return exactly these columns in this order:
  w.strongs_base, w.strongs, w.english, w.english_head,
  v.book, v.chapter, v.verse,
  l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation

Always join:  words w  JOIN verses v ON w.verse_id = v.id
              LEFT JOIN lexicon l ON l.strongs = w.strongs_base
Always end:   ORDER BY v.id, w.position  LIMIT 200

Use LIKE … COLLATE NOCASE for text, = for Strong's numbers.
For thematic questions use your knowledge of Greek Strong's numbers to build the WHERE clause.
SELECT only — never INSERT, UPDATE, DELETE, or DROP.\
"""

_STRONGS_RE = re.compile(r'^G?(\d+(?:\.\d+)*)$', re.IGNORECASE)


def _strongs_num(q: str):
    """Return the numeric portion if q looks like a Strong's ref, else None."""
    m = _STRONGS_RE.match(q.strip())
    return m.group(1) if m else None

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
    phrase_mode = request.args.get("phrase", "0") == "1"

    if not q:
        return jsonify({"results": [], "total": 0})

    conn = db()
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
            ORDER BY v.id, w.position
            """,
            (snum,),
        ).fetchall()
    else:
        search_col = "w.english" if phrase_mode else "w.english_head"
        rows = conn.execute(
            f"""
            SELECT w.strongs_base, w.strongs, w.english, w.english_head,
                   v.id AS verse_id, v.book, v.chapter, v.verse,
                   l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
            FROM words w
            JOIN verses v ON w.verse_id = v.id
            LEFT JOIN lexicon l ON l.strongs = w.strongs_base
            WHERE {search_col} LIKE ? COLLATE NOCASE
            ORDER BY v.id, w.position
            """,
            (f"%{q}%",),
        ).fetchall()
    conn.close()

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


@app.route("/api/ai-search")
def ai_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "no query"}), 400

    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 500

    client = anthropic.Anthropic(api_key=key)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        system=_AI_SYSTEM,
        messages=[{"role": "user", "content": q}],
    )
    raw = msg.content[0].text.strip()

    # Strip accidental markdown fences
    if raw.startswith("```"):
        raw = re.sub(r"^```[^\n]*\n?", "", raw).rstrip("`").strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        return jsonify({"error": f"AI response not valid JSON: {e}", "raw": raw}), 500

    sql         = parsed.get("sql", "").strip()
    explanation = parsed.get("explanation", "")

    if not re.match(r"^\s*SELECT\b", sql, re.IGNORECASE):
        return jsonify({"error": "AI returned a non-SELECT query", "sql": sql}), 400

    conn = db()
    try:
        rows = conn.execute(sql).fetchall()
    except Exception as e:
        conn.close()
        return jsonify({"error": f"SQL error: {e}", "sql": sql}), 400
    conn.close()

    results = [
        {
            "ref":         f"{r['book']} {r['chapter']}:{r['verse']}",
            "book":        r["book"],
            "chapter":     r["chapter"],
            "verse":       r["verse"],
            "strongs":     r["strongs"],
            "strongs_base": r["strongs_base"],
            "gloss":       r["english"],
            "lemma":       r["lemma"],
            "translit":    r["translit"],
            "strongs_def": (r["strongs_def"] or "").strip(),
            "kjv_def":     r["kjv_def"],
            "derivation":  (r["derivation"] or "").strip(),
        }
        for r in rows
    ]

    return jsonify({"results": results, "total": len(results),
                    "explanation": explanation, "sql": sql})


if __name__ == "__main__":
    app.run(debug=True)
