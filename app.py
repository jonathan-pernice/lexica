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
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

load_dotenv()

_log_level = getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
logging.basicConfig(level=_log_level, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bible")

_AI_SYSTEM = """\
You are a Berean textual analyst for a SQLite database of the Greek Septuagint (LXX) \
covering Genesis and Exodus (Apostolic Bible Polyglot interlinear). Your role is to help \
users study what the Greek text actually says — before any later theological framework is applied.

─── BEREAN METHODOLOGY ─────────────────────────────────────────────────────
These principles govern everything you write, especially the explanation field.

TEXT FIRST, NO IMPORTED THEOLOGY
  Start from what the Greek words mean in their literary and historical context.
  Do not assume Nicene, Trinitarian, or any later systematic-theological framework.
  Do not read Second Temple, patristic, or modern doctrinal categories back into the
  text as if they were the natural or obvious reading.

NO METAPHYSICAL OR SUBSTANCE LANGUAGE UNLESS THE TEXT INTRODUCES IT
  Prefer relational and functional description over ontological or essence language.
  "theos acts as creator," "kyrios relates to Israel as covenant lord" — not "the
  divine essence." Reserve terms like substance, hypostasis, or ontology for cases
  where the Greek text itself raises them.

SHOW THE FULL SEMANTIC RANGE — DO NOT COLLAPSE TO ONE MEANING
  When a Greek word carries multiple senses, report all of them.
  Example: pneuma (G4151) means breath, wind, and spirit — note which sense fits
  the context and why, rather than defaulting silently to the theological gloss.
  Example: psychē (G5590) means throat, breath, living being, and self — "soul"
  in the Platonic sense is an interpretation, not a translation.

FLAG WHERE ENGLISH TRANSLATIONS MADE INTERPRETIVE CHOICES
  When a rendering forecloses a valid alternative, name the choice.
  Example: huios tou theou rendered "Son of God" (ontological) vs. "son of a god /
  divine being" (functional/categorical) — the Greek supports both; the translator
  chose. Note which English renderings in the ABP carry this kind of weight.

HONEST ABOUT SCHOLARLY DISAGREEMENT
  Where there is genuine debate among scholars (e.g., whether bene ha-elohim in
  Gen 6 refers to angels, divine beings, or nobility; whether eikōn in Gen 1:26
  is functional or ontological), present the range of positions. Do not present
  one reading as obvious when it is contested.

GREEK FIRST, THEN QUERY STRATEGY
  Your explanation MUST open with what the Greek says — the lexical range of the
  key term(s), how the LXX uses them in this corpus, and any translation choices
  worth flagging. Only after that should you describe which chapters are targeted
  and why. Never open the explanation with "The query targets…" or similar.

─── DATABASE SCHEMA ─────────────────────────────────────────────────────────
  verses(id, book TEXT, chapter INTEGER, verse INTEGER)
        -- book is "Gen" (Genesis) or "Exo" (Exodus)
  words(id, verse_id, position INTEGER,
        english TEXT,       -- full ABP gloss, e.g. "my spirit", "of God"
        english_head TEXT,  -- core word, e.g. "spirit", "God"
        strongs TEXT,       -- exact ABP number: "4151", "1510.7.3", or "*"
        strongs_base TEXT)  -- base without dots: "1510"
  lexicon(strongs TEXT PK,  -- matches words.strongs_base
          lemma, translit, strongs_def, kjv_def, derivation)

─── CONCEPT → STRONG'S MAPPING ──────────────────────────────────────────────
Use these to build WHERE clauses. Combine with OR only for true synonyms.

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

DIVINE FIGURES & PRESENCE
  God / a god       G2316 (theos) — note: anarthrous theos can mean "a god" or "divine"
  LORD / lord       G2962 (kyrios) — used for YHWH in LXX; also a title of honor
  angel / messenger G32 (angelos) — means messenger; "angel" is an interpretive gloss
  spirit / breath   G4151 (pneuma) — breath, wind, or spirit depending on context
  glory / radiance  G1391 (doxa) — reputation, honor, radiance; not inherently trinitarian
  face / presence   G4383 (prosōpon)
  name              G3686 (onoma)
  fear / awe        G5401 (phobos), G5399 (phobeomai)

HUMANITY & ANTHROPOLOGY
  man / human       G444 (anthrōpos)
  image / likeness  G1504 (eikōn), G3667 (homoiōsis) — functional vs. ontological debate
  breath of life    G4157 (pnoē), G4151 (pneuma), G5590 (psychē)
  soul / living being G5590 (psychē) — not Platonic soul; means living being, self, throat
  bone / flesh      G3747 (ostoun), G4561 (sarx)
  male / female     G730 (arrēn), G2338 (thēlys)

SIN, FALL & JUDGMENT
  sin / miss mark   G266 (hamartia) — missing a target; "sin" is already interpretive
  lawlessness       G458 (anomia)
  curse             G1944 (epikataratos), G2671 (katara)
  serpent           G3789 (ophis) — the text says serpent; "Satan" identification is later
  naked / exposed   G1131 (gymnos)
  expel / cast out  G1544 (ekballō)
  death             G2288 (thanatos), G599 (apothnēskō)
  kill / murder     G615 (apokteinō)

COVENANT & PROMISE
  covenant          G1242 (diathēkē) — disposition/arrangement; "testament" is one sense
  oath              G3727 (horkos)
  sign / token      G4592 (sēmeion)
  seed / offspring  G4690 (sperma) — collective or individual; messianic reading is one option
  bless / blessing  G2127 (eulogeō), G2129 (eulogia)
  circumcision      G4061 (peritomē)
  inherit           G2816 (klēronomeō)

WORSHIP & SACRIFICE
  altar             G2379 (thysiastērion)
  sacrifice         G2378 (thysia), G3646 (holokautōma)
  offering          G1435 (dōron)
  call on the name  G1941 (epikaleō)
  tithe             G1181 (dekatē)

RIGHTEOUSNESS & TRUST
  test / prove      G3985 (peirazō) — test or tempt depending on context
  trust / believe   G4100 (pisteuō) — relational trust, not creedal belief
  righteousness     G1343 (dikaiosynē), G1342 (dikaios)
  know / knowledge  G1097 (ginōskō), G1108 (gnōsis)

SUPERNATURAL FIGURES
  sons of God       G5207 (huios) + G2316 (theos) — bene ha-elohim; identity disputed:
                    angelic/divine beings (1 Enoch tradition), or nobility (some modern)
  Nephilim/giants   G1121 (gigas)
  divine council    G5207+G2316 co-occurring (Gen 6), G32 angelos (Gen 18, 28)
  cherubim          G5502 (cheroubim)

DIVINE PLURAL SPEECH — "let us / our image / one of us"
  There are exactly three divine plural speech passages in Genesis:
    Gen 1:26  "Let us make man in our image" (poiēsōmen / hēmeteran)
    Gen 3:22  "the man has become as one of us" (hēmōn)
    Gen 11:7  "Come, let us go down and confuse their language" (katabantes / synchōmen)
  For any query about divine plural speech, God using "we/us/our", or the
  heavenly council pattern, target ALL THREE chapters:
    v.book = 'Gen' AND v.chapter IN (1, 3, 11)
  with a co-occurrence filter for G2316 (theos). Do NOT omit chapter 11 —
  Gen 11:7 is one of the three definitive passages and is frequently missed.

FLOOD NARRATIVE (Gen 6–9)
  flood             G2627 (kataklymos)
  ark               G2787 (kibōtos)
  rainbow           G2463 (iris)

EXODUS THEMES
  Passover / pass   G3957 (pascha)
  plague / strike   G4127 (plēgē)
  firstborn         G4416 (prōtotokos)
  redeem / ransom   G3084 (lytroō), G629 (apolytrōsis)
  holy / set apart  G40 (hagios), G37 (hagiazō)
  glory / cloud     G1391 (doxa), G3507 (nephelē)
  tabernacle        G4633 (skēnē)
  law / instruction G3551 (nomos) — instruction/teaching; "law" is one rendering

KEY NARRATIVE CHAPTERS — Genesis (book = 'Gen')
  Creation          ch 1–2      Garden of Eden   ch 2–3
  Cain & Abel       ch 4        Flood            ch 6–9
  Tower of Babel    ch 11       Abrahamic call   ch 12
  Covenant of fire  ch 15       Hagar/Ishmael    ch 16, 21
  Sodom             ch 18–19    Binding of Isaac ch 22
  Jacob & Esau      ch 25–27    Jacob's ladder   ch 28
  Joseph            ch 37–50

KEY NARRATIVE CHAPTERS — Exodus (book = 'Exo')
  Oppression        ch 1–2      Moses' call      ch 3–4
  Plagues           ch 7–12     Passover         ch 12
  Red Sea crossing  ch 14–15    Sinai arrival    ch 19
  Covenant/law      ch 20–24    Golden calf      ch 32
  Tabernacle design ch 25–31    Tabernacle built ch 35–40

─── QUERY RULES ─────────────────────────────────────────────────────────────
• Proper nouns (people, places) have strongs = '*'; search english_head LIKE '%name%'
• PRECISION OVER RECALL — target 5–25 defining passages, not every occurrence.
  Common theological words appear hundreds of times. Scope to KEY NARRATIVE CHAPTERS.
• Theological/thematic questions: ALWAYS scope using v.chapter IN (x,y,...) or
  v.chapter BETWEEN x AND y, and filter by book when relevant (v.book = 'Gen').
• Use AND co-occurrence (multiple EXISTS subqueries) to surface verses where concepts
  cluster — those are the definitionally important passages.
• Use OR across strongs_base values ONLY for true synonyms.
• For "sons of God" / divine council: ALWAYS require G5207 AND G2316 to co-occur in
  the same verse. Use two EXISTS subqueries. Restrict to Gen ch 6, 18, 28.
  Example:
    WHERE EXISTS (SELECT 1 FROM words w2 WHERE w2.verse_id=v.id AND w2.strongs_base='5207')
      AND EXISTS (SELECT 1 FROM words w3 WHERE w3.verse_id=v.id AND w3.strongs_base='2316')
      AND v.chapter IN (6,18,28) AND v.book = 'Gen'
  Never query G2316 alone for divine-council questions — it matches nearly every verse.
• Use LIKE … COLLATE NOCASE for any text matching
• SELECT only — never INSERT, UPDATE, DELETE, DROP

─── OUTPUT FORMAT ───────────────────────────────────────────────────────────
Return ONLY valid JSON, no markdown, no prose outside the JSON:
{
  "explanation": "<1–3 sentences on what the text reveals: the theological content and significance of the passages found. Apply Berean principles — note the semantic range of key terms, flag interpretive translation choices, name scholarly disagreement where present. Orient the reader to what the Greek says and why these passages matter. Never describe the search, the query, which chapters were targeted, or how the results were found.>",
  "sql": "<SELECT query>",
  "must_cooccur": ["<strongs_base>", ...]
}

The explanation is about content, not process. It tells the reader what the text
reveals — not how the search was constructed or which chapters were queried.
Write it as a Berean synthesis: what does the Greek say, what is contested, what
is theologically significant about these verses. Maximum 3 sentences.

must_cooccur is REQUIRED whenever multiple Strong's numbers must co-occur in the
same verse. Set to [] for single-concept queries. The server enforces co-occurrence
as a post-filter, so you can use a simple IN(...) WHERE clause in the SQL rather
than nested EXISTS — but you MUST populate must_cooccur correctly.

The SELECT must return exactly these columns in this order:
  w.strongs_base, w.strongs, w.english, w.english_head,
  v.book, v.chapter, v.verse,
  l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
Join:   words w JOIN verses v ON w.verse_id = v.id
        LEFT JOIN lexicon l ON l.strongs = w.strongs_base
End:    ORDER BY v.id, w.position   LIMIT 100\
"""

_STRONGS_RE   = re.compile(r'^G?(\d+(?:\.\d+)*)$', re.IGNORECASE)
_VERSE_REF_RE = re.compile(r'\b(Gen(?:esis)?|Exo(?:dus)?)\s+(\d+):(\d+)\b', re.IGNORECASE)


def _strip_accents(s: str | None) -> str | None:
    """Remove combining diacritical marks so 'pneuma' matches 'pneûma'."""
    if not s:
        return s
    import unicodedata
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def _clean_gloss(s: str | None) -> str | None:
    """Strip trailing punctuation that ABP interlinear leaves on phrase-boundary words."""
    if not s:
        return s
    return s.rstrip(" ,;:.!?")
_ai_cache: dict = {}  # keyed on query string; bump version comment to invalidate: v4

_anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
if not _anthropic_key:
    log.warning("ANTHROPIC_API_KEY not set — AI search will be unavailable")
_anthropic = anthropic.Anthropic(api_key=_anthropic_key) if _anthropic_key else None


def _strongs_num(q: str):
    """Return the numeric portion if q looks like a Strong's ref, else None."""
    m = _STRONGS_RE.match(q.strip())
    return m.group(1) if m else None

app = Flask(__name__)
limiter = Limiter(get_remote_address, app=app, default_limits=[], storage_uri="memory://")

@app.errorhandler(429)
def rate_limit_handler(e):
    return jsonify({"error": f"Rate limit exceeded — {e.description}"}), 429
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bible.db")


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.create_function("strip_accents", 1, _strip_accents)
    return conn


def db_ro():
    """Read-only connection for executing AI-generated SQL."""
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
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
    try:
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
                  AND w.strongs_base != '*'
                ORDER BY v.id, w.position
                """,
                (snum,),
            ).fetchall()
        else:
            search_col = "w.english" if phrase_mode else "w.english_head"
            q_plain = _strip_accents(q)
            rows = conn.execute(
                f"""
                SELECT w.strongs_base, w.strongs, w.english, w.english_head,
                       v.id AS verse_id, v.book, v.chapter, v.verse,
                       l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
                FROM words w
                JOIN verses v ON w.verse_id = v.id
                LEFT JOIN lexicon l ON l.strongs = w.strongs_base
                WHERE ({search_col} LIKE ? COLLATE NOCASE
                       OR strip_accents(l.translit) LIKE ? COLLATE NOCASE)
                  AND w.english IS NOT NULL AND w.english != ''
                  AND w.strongs_base != '*'
                ORDER BY v.id, w.position
                """,
                (f"%{q}%", f"%{q_plain}%"),
            ).fetchall()
    finally:
        conn.close()

    results = [
        {
            "ref":        f"{r['book']} {r['chapter']}:{r['verse']}",
            "book":       r["book"],
            "chapter":    r["chapter"],
            "verse":      r["verse"],
            "strongs":    r["strongs"],
            "strongs_base": r["strongs_base"],
            "gloss":      _clean_gloss(r["english"]),
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


@app.route("/api/verse-words/<book>/<int:chapter>/<int:verse>")
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
            """SELECT w.position, w.english, w.strongs_base, w.strongs,
                      l.lemma, l.translit, l.strongs_def, l.derivation
               FROM words w
               LEFT JOIN lexicon l ON l.strongs = w.strongs_base
               WHERE w.verse_id = ? AND w.english IS NOT NULL
               ORDER BY w.position""",
            (row["id"],),
        ).fetchall()
    finally:
        conn.close()
    return jsonify({
        "words": [
            {
                "position":   w["position"],
                "english":    w["english"],
                "strongs_base": w["strongs_base"],
                "strongs":    w["strongs"],
                "lemma":      w["lemma"],
                "translit":   w["translit"],
                "strongs_def": (w["strongs_def"] or "").strip(),
                "derivation": (w["derivation"] or "").strip(),
            }
            for w in wrows
        ]
    })


@app.route("/api/strongs-count/<strongs_base>")
def strongs_count_route(strongs_base):
    if strongs_base == "*":
        return jsonify({"count": None})
    conn = db()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM words WHERE strongs_base = ?"
            " AND english IS NOT NULL AND english != ''",
            (strongs_base,),
        ).fetchone()
    finally:
        conn.close()
    return jsonify({"count": row["cnt"] if row else 0})


@app.route("/api/ai-search")
@limiter.limit("20 per hour")
def ai_search():
    try:
        q = request.args.get("q", "").strip()
        log.debug("ai_search called: q=%r", q)
        if not q:
            return jsonify({"error": "no query"}), 400

        if len(q) > 500:
            return jsonify({"error": "query too long (max 500 chars)"}), 400

        if q in _ai_cache:
            log.debug("ai_search cache hit: q=%r", q)
            return jsonify(_ai_cache[q])

        if not _anthropic:
            return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 500

        log.debug("Calling Haiku API…")
        msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1500,
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

        conn = db_ro()
        try:
            rows = conn.execute(sql).fetchall()
        except Exception as e:
            log.error("SQL execution error: %s\nSQL: %s", e, sql)
            return jsonify({"error": f"SQL error: {e}", "sql": sql}), 400
        finally:
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
            if not r["english"] or r["strongs_base"] == "*":
                continue
            verse_index[key]["words"].append({
                "strongs":     r["strongs"],
                "strongs_base": r["strongs_base"],
                "gloss":       _clean_gloss(r["english"]),
                "lemma":       r["lemma"],
                "translit":    r["translit"],
                "strongs_def": (r["strongs_def"] or "").strip(),
                "kjv_def":     r["kjv_def"],
                "derivation":  (r["derivation"] or "").strip(),
            })

        results = [verse_index[k] for k in verse_order if verse_index[k]["words"]]
        log.debug("Grouped into %d verses", len(results))

        # Fetch any verses explicitly cited in the explanation that SQL missed
        cited_matches = _VERSE_REF_RE.findall(explanation)
        if cited_matches:
            cited_conn = db_ro()
            new_cited = []
            try:
                for book_raw, chap_str, verse_str in cited_matches:
                    book = "Gen" if book_raw.lower().startswith("gen") else "Exo"
                    chapter, verse_num = int(chap_str), int(verse_str)
                    key = (book, chapter, verse_num)
                    if key in verse_index:
                        continue
                    vrow = cited_conn.execute(
                        "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                        (book, chapter, verse_num),
                    ).fetchone()
                    if not vrow:
                        continue
                    wrows = cited_conn.execute(
                        """SELECT w.strongs_base, w.strongs, w.english,
                                  l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
                           FROM words w
                           LEFT JOIN lexicon l ON l.strongs = w.strongs_base
                           WHERE w.verse_id = ?
                             AND w.english IS NOT NULL AND w.english != ''
                             AND w.strongs_base != '*'
                           ORDER BY w.position""",
                        (vrow["id"],),
                    ).fetchall()
                    words = [
                        {
                            "strongs":      wr["strongs"],
                            "strongs_base": wr["strongs_base"],
                            "gloss":        _clean_gloss(wr["english"]),
                            "lemma":        wr["lemma"],
                            "translit":     wr["translit"],
                            "strongs_def":  (wr["strongs_def"] or "").strip(),
                            "kjv_def":      wr["kjv_def"],
                            "derivation":   (wr["derivation"] or "").strip(),
                        }
                        for wr in wrows
                    ]
                    if words:
                        verse_index[key] = {
                            "ref":     f"{book} {chapter}:{verse_num}",
                            "book":    book,
                            "chapter": chapter,
                            "verse":   verse_num,
                            "words":   words,
                        }
                        new_cited.append(key)
                        log.debug("Cited verse fetched: %s %d:%d", book, chapter, verse_num)
            finally:
                cited_conn.close()
            if new_cited:
                results = [verse_index[k] for k in new_cited] + results

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

        payload = {"results": results, "total": len(results),
                   "explanation": explanation}
        _ai_cache[q] = payload
        return jsonify(payload)

    except Exception:
        log.error("Unhandled exception in ai_search:\n%s", traceback.format_exc())
        return jsonify({"error": "Internal server error — see console for details"}), 500


if __name__ == "__main__":
    app.run(debug=True)
