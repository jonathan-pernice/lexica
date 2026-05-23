#!/usr/bin/env python3
import json
import logging
import os
import re
import sqlite3
import traceback

import anthropic
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()

logging.basicConfig(level=logging.DEBUG, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bible")

_AI_SYSTEM = """\
You are a Biblical Greek theological assistant for a SQLite database of LXX Genesis \
(Apostolic Bible Polyglot interlinear). You understand Septuagint theology, Greek lexicology, \
and the major themes, narratives, and figures of Genesis.

─── DATABASE SCHEMA ────────────────────────────────────────────────────────
  verses(id, book TEXT, chapter INTEGER, verse INTEGER)  -- book always "Gen"
  words(id, verse_id, position INTEGER,
        english TEXT,       -- full ABP gloss, e.g. "my spirit", "of God"
        english_head TEXT,  -- core word, e.g. "spirit", "God"
        strongs TEXT,       -- exact ABP number: "4151", "1510.7.3", or "*"
        strongs_base TEXT)  -- base without dots: "1510"
  lexicon(strongs TEXT PK,  -- matches words.strongs_base
          lemma, translit, strongs_def, kjv_def, derivation)

─── THEOLOGICAL CONCEPT → STRONG'S MAPPING ────────────────────────────────
Use these to build WHERE clauses for thematic questions. Combine with OR.

CREATION & COSMOS
  create/make       G2936 (ktizō), G4160 (poieō)
  heaven/sky        G3772 (ouranos)
  earth/land        G1093 (gē)
  light             G5457 (phōs)
  darkness          G4655 (skotos), G4639 (skia)
  water / deep      G5204 (hydōr), G12 (abyssos)
  firmament         G4733 (stereōma)
  day / night       G2250 (hēmera), G3571 (nyx)
  void / formless   G517 (aoratos), G180 (akataskeuastos)

DIVINE NATURE & PRESENCE
  God               G2316 (theos)
  LORD / lord       G2962 (kyrios)
  angel / messenger G32 (angelos)
  spirit            G4151 (pneuma)
  glory             G1391 (doxa)
  face / presence   G4383 (prosōpon)
  name              G3686 (onoma)
  fear of God       G5401 (phobos), G5399 (phobeomai)

HUMANITY & ANTHROPOLOGY
  man / human       G444 (anthrōpos)
  image of God      G1504 (eikōn), G3667 (homoiōsis)
  breath of life    G4157 (pnoē), G4151 (pneuma), G5590 (psychē)
  soul / life       G5590 (psychē)
  bone / flesh      G3747 (ostoun), G4561 (sarx)
  male / female     G730 (arrēn), G2338 (thēlys)

SIN, FALL & JUDGMENT
  sin / transgress  G266 (hamartia), G458 (anomia)
  curse             G1944 (epikataratos), G2671 (katara)
  serpent           G3789 (ophis)
  naked             G1131 (gymnos)
  shame / hide      G2572 (kalyptō)
  expel / cast out  G1544 (ekballō)
  death             G2288 (thanatos), G599 (apothnēskō)
  kill / murder     G615 (apokteinō)

COVENANT & PROMISE
  covenant          G1242 (diathēkē)
  promise / oath    G3727 (horkos), G1860 (epangelia)
  sign / seal       G4592 (sēmeion)
  seed / offspring  G4690 (sperma)
  bless / blessing  G2127 (eulogeō), G2129 (eulogia)
  curse (verb)      G2672 (kataraomai)
  circumcision      G4061 (peritomē)
  inherit           G2816 (klēronomeō)

WORSHIP & SACRIFICE
  altar             G2379 (thysiastērion)
  sacrifice         G2378 (thysia), G3646 (holokautōma)
  offering          G1435 (dōron)
  call on the name  G1941 (epikaleō)
  tithe             G1181 (dekatē)

PROVIDENCE & TESTING
  test / tempt      G3985 (peirazō)
  trust / believe   G4100 (pisteuō)
  righteousness     G1343 (dikaiosynē), G1342 (dikaios)
  know / knowledge  G1097 (ginōskō), G1108 (gnōsis)

SUPERNATURAL FIGURES
  sons of God       G5207 (huios) + G2316 (theos) — MUST appear together in same verse
  Nephilim/giants   G1121 (gigas)
  divine council    G5207+G2316 co-occurring (ch 6), G32 angelos (ch 18, 28), G1121 Nephilim (ch 6)
  cherubim          G5502 (cheroubim)

FLOOD NARRATIVE (Gen 6–9)
  flood             G2627 (kataklymos)
  ark               G2787 (kibōtos)
  rainbow           G2463 (iris)

KEY NARRATIVE CHAPTERS
  Creation          ch 1–2    Garden of Eden     ch 2–3
  Cain & Abel       ch 4      Flood              ch 6–9
  Tower of Babel    ch 11     Abrahamic call     ch 12
  Covenant of fire  ch 15     Hagar/Ishmael      ch 16, 21
  Sodom             ch 18–19  Binding of Isaac   ch 22
  Jacob & Esau      ch 25–27  Jacob's ladder     ch 28
  Joseph            ch 37–50

─── QUERY RULES ────────────────────────────────────────────────────────────
• Proper nouns (people, places) have strongs = '*'; search english_head LIKE '%name%'
• PRECISION OVER RECALL — target 5–25 key defining passages, not every occurrence.
  Genesis has 50 chapters; common theological words appear hundreds of times. If an
  unconstrained query would return 50+ rows, add chapter scope or co-occurrence
  filters until the results are focused on the theologically significant verses.
• Theological/thematic questions: ALWAYS scope to the KEY NARRATIVE CHAPTERS listed
  above using  v.chapter IN (x,y,...)  or  v.chapter BETWEEN x AND y.
  Example: "covenant" → restrict to ch 9, 15, 17 (the three covenant episodes).
  Never scan all chapters for a theme — "covenant", "bless", and "God" appear
  throughout; only the defining passages matter.
• Use AND co-occurrence (multiple EXISTS subqueries or must_cooccur) to surface
  verses where several related concepts cluster — those are the key passages.
• Use OR across strongs_base values only for true synonyms (e.g. pneuma/pnoē for
  "breath of life") — not to widen an already broad search.
• Narrative-scoped queries: add  AND v.chapter BETWEEN x AND y
• For "sons of God" / divine council: ALWAYS require G5207 AND G2316 to co-occur
  in the same verse. Use two EXISTS subqueries (one per strongs_base), never OR.
  Restrict to ch 6 (Nephilim/sons of God), ch 18 (heavenly visitors to Abraham),
  ch 28 (Jacob's ladder / divine beings). Example pattern:
    WHERE EXISTS (SELECT 1 FROM words w2 WHERE w2.verse_id=v.id AND w2.strongs_base='5207')
      AND EXISTS (SELECT 1 FROM words w3 WHERE w3.verse_id=v.id AND w3.strongs_base='2316')
      AND v.chapter IN (6,18,28)
  Never query G2316 alone for divine-council topics — it matches nearly every verse.
• Use LIKE … COLLATE NOCASE for any text matching
• SELECT only — never INSERT, UPDATE, DELETE, DROP

─── OUTPUT FORMAT ───────────────────────────────────────────────────────────
Return ONLY valid JSON, no markdown, no prose outside the JSON:
{
  "explanation": "<one concise sentence: name the key chapters targeted and why>",
  "sql": "<SELECT query>",
  "must_cooccur": ["<strongs_base>", ...]
}

must_cooccur is REQUIRED whenever the query demands that multiple Strong's numbers
appear together in the same verse (e.g. divine council = ["5207","2316"]).
Set it to [] for single-concept queries. The server enforces co-occurrence from
this list as a post-filter, so you can use a simple IN(...) WHERE clause in the SQL
rather than nested EXISTS — but you MUST populate must_cooccur correctly.

The SELECT must return exactly these columns in this order:
  w.strongs_base, w.strongs, w.english, w.english_head,
  v.book, v.chapter, v.verse,
  l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
Join:   words w JOIN verses v ON w.verse_id = v.id
        LEFT JOIN lexicon l ON l.strongs = w.strongs_base
End:    ORDER BY v.id, w.position   LIMIT 100\
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
              AND w.english IS NOT NULL AND w.english != ''
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
              AND w.english IS NOT NULL AND w.english != ''
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
    try:
        q = request.args.get("q", "").strip()
        log.debug("ai_search called: q=%r", q)
        if not q:
            return jsonify({"error": "no query"}), 400

        key = os.environ.get("ANTHROPIC_API_KEY")
        log.debug("ANTHROPIC_API_KEY present: %s", bool(key))
        if not key:
            log.error("ANTHROPIC_API_KEY not set — check .env file")
            return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 500

        log.debug("Calling Haiku API…")
        client = anthropic.Anthropic(api_key=key)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=_AI_SYSTEM,
            messages=[{"role": "user", "content": q}],
        )
        raw = msg.content[0].text.strip()
        log.debug("Haiku raw response: %r", raw[:300])

        # Extract the JSON object even if surrounded by prose or fences
        start = raw.find("{")
        end   = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidate = raw[start:end + 1]
        else:
            candidate = raw

        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError as e:
            log.error("AI response not valid JSON: %s\nraw=%r", e, raw)
            return jsonify({"error": f"AI response not valid JSON: {e}", "raw": raw}), 500

        sql          = parsed.get("sql", "").strip()
        explanation  = parsed.get("explanation", "")
        must_cooccur = [str(s) for s in parsed.get("must_cooccur", [])]
        log.debug("SQL from AI: %s", sql)
        log.debug("must_cooccur: %s", must_cooccur)

        if not re.match(r"^\s*SELECT\b", sql, re.IGNORECASE):
            log.error("AI returned non-SELECT query: %r", sql)
            return jsonify({"error": "AI returned a non-SELECT query", "sql": sql}), 400

        conn = db()
        try:
            rows = conn.execute(sql).fetchall()
        except Exception as e:
            conn.close()
            log.error("SQL execution error: %s\nSQL: %s", e, sql)
            return jsonify({"error": f"SQL error: {e}", "sql": sql}), 400
        conn.close()
        log.debug("SQL returned %d rows", len(rows))

        # Group word-level rows into one entry per verse
        verse_index = {}
        verse_order = []
        for r in rows:
            key = (r["book"], r["chapter"], r["verse"])
            if key not in verse_index:
                verse_index[key] = {
                    "ref":     f"{r['book']} {r['chapter']}:{r['verse']}",
                    "book":    r["book"],
                    "chapter": r["chapter"],
                    "verse":   r["verse"],
                    "words":   [],
                }
                verse_order.append(key)
            if not r["english"]:
                continue
            verse_index[key]["words"].append({
                "strongs":     r["strongs"],
                "strongs_base": r["strongs_base"],
                "gloss":       r["english"],
                "lemma":       r["lemma"],
                "translit":    r["translit"],
                "strongs_def": (r["strongs_def"] or "").strip(),
                "kjv_def":     r["kjv_def"],
                "derivation":  (r["derivation"] or "").strip(),
            })

        results = [verse_index[k] for k in verse_order if verse_index[k]["words"]]
        log.debug("Grouped into %d verses", len(results))

        if must_cooccur:
            before = len(results)
            results = [
                v for v in results
                if all(
                    any(w["strongs_base"] == s for w in v["words"])
                    for s in must_cooccur
                )
            ]
            log.debug("must_cooccur filter: %d -> %d verses", before, len(results))

        return jsonify({"results": results, "total": len(results),
                        "explanation": explanation, "sql": sql})

    except Exception:
        log.error("Unhandled exception in ai_search:\n%s", traceback.format_exc())
        return jsonify({"error": "Internal server error — see console for details"}), 500


if __name__ == "__main__":
    app.run(debug=True)
