#!/usr/bin/env python3
"""Lexicon word-study routes (Phase 3 of REDESIGN_PLAN.md).

The Lexicon tab's flow: smart lookup (Strong's/Greek/Hebrew/English) → word
profile → book distribution → per-book verse list. ABP Greek comes from the
words table; Hebrew (and KJV) from kjv_strongs/kjv_words + bdb. Gloss renderings
are collapsed via _normalize_gloss so case/whitespace/punct variants merge.
"""
import re

from flask import Blueprint, jsonify, request

from core import db_ro, _KJV_BOOK_ID, _FUNCTION_STRONGS, _strip_accents

bp = Blueprint("lexicon", __name__)


_GLOSS_FUNC = {
    'a','an','the','my','his','her','your','their','our','its',
    'of','in','by','as','to','with','for','from','at','on','into',
    'is','are','was','were','be','been',
    'there','this','that','these','those',
    'and','or','not','no',
    'i','he','she','we','they','it',
    'up','out','off','over','under',
}

# For function-word renderings the meaningful label is the connector inside the
# phrase, not the content word. STRONG = prepositions / negatives / conjunctions
# (the actual sense of ἐν, οὐ, καί…); WEAK = articles / copulas / pronouns, used
# only when no strong connector is present.
_GLOSS_STRONG = {
    'in', 'into', 'by', 'with', 'to', 'unto', 'for', 'from', 'at', 'on', 'upon',
    'over', 'under', 'through', 'throughout', 'within', 'against', 'among',
    'amongst', 'near', 'onto', 'toward', 'towards', 'before', 'after', 'behind',
    'beside', 'about', 'concerning', 'during', 'of', 'off', 'out', 'around',
    'between', 'up', 'down',
    'not', 'no', 'nor', 'and', 'or', 'but', 'if', 'that', 'because', 'when',
    'while', 'as', 'than', 'so', 'then', 'therefore', 'lest', 'until', 'though',
    'yet',
}
_GLOSS_WEAK = {
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    'he', 'she', 'it', 'they', 'we', 'i', 'you', 'me', 'him', 'her', 'them', 'us',
    'this', 'these', 'those', 'my', 'his', 'your', 'their', 'our', 'its',
}


def _normalize_gloss(raw, is_func=False):
    import re
    s = re.sub(r"'s\b", '', re.sub(r'^[^\w]+|[^\w]+$', '', raw.strip()).lower())
    words = s.split()
    if not words:
        return ''
    if is_func:
        # ABP lumps extra English onto a function word ("baked in", "in the way",
        # "shall not be"). The real rendering is the connector, not the content
        # word english_head would pick. Prefer a strong connector, then a weak
        # one; fall back to the first word only when the phrase has no connector
        # at all (a rare genuine ABP mis-alignment, dropped later as a singleton).
        for w in words:
            if w in _GLOSS_STRONG:
                return w
        for w in words:
            if w in _GLOSS_WEAK:
                return w
        return words[0]
    # Content word: trim connector/copula/pronoun/article words off BOTH ends so
    # an ABP lump like "God so" / "God and the" / "God, and" collapses to the
    # content head ("god"). _GLOSS_FUNC alone missed adverb/conjunction trailers
    # ("so", "then", "yet"), which then won the "last word" tie-break and leaked
    # as bogus renderings (Luk 12:28 "God so" -> "so"). Punctuation is stripped
    # per-token so a mid-phrase comma ("God, and") can't survive either.
    drop = _GLOSS_FUNC | _GLOSS_STRONG | _GLOSS_WEAK
    words = [w.strip(".,;:!?'\"") for w in words]
    words = [w for w in words if w]
    if not words:
        return ''
    while len(words) > 1 and words[0] in drop:
        words.pop(0)
    while len(words) > 1 and words[-1] in drop:
        words.pop()
    if len(words) > 1:
        words = [words[-1]]
    return words[0]


@bp.route("/api/lexicon/lookup")
def lexicon_lookup():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    conn = db_ro()
    try:
        m = re.match(r'^([GgHh]?)(\d+(?:\.\d+)?)$', q)
        if m:
            prefix = m.group(1).upper()
            num = m.group(2)
            snum = num.split('.')[0]
            is_heb = prefix == 'H' or (not prefix and int(snum) > 5624)
            if is_heb:
                row = conn.execute(
                    "SELECT strongs_id, lemma, xlit, description FROM bdb WHERE strongs_id = ?",
                    (f"H{snum}",)
                ).fetchone()
                if row:
                    return jsonify([{"strongs": row["strongs_id"], "lemma": row["lemma"] or "", "translit": row["xlit"] or "", "gloss": row["description"] or ""}])
            else:
                row = conn.execute(
                    "SELECT strongs, lemma, translit, strongs_def FROM lexicon WHERE strongs = ?",
                    (snum,)
                ).fetchone()
                if row:
                    return jsonify([{"strongs": f"G{row['strongs']}", "lemma": row["lemma"] or "", "translit": row["translit"] or "", "gloss": row["strongs_def"] or ""}])
            return jsonify([])
        # English/transliteration search — Greek lexicon + Hebrew BDB. The
        # lemma/translit/xlit matches are accent-insensitive (strip_accents on
        # both sides) so a Latin transliteration ("pneuma") matches the stored
        # accented form ("pneûma"), and Greek/Hebrew typed without accents/points
        # still matches. Definition matches keep the raw query.
        qn = (_strip_accents(q) or q).lower()
        grk = conn.execute(
            """SELECT strongs, lemma, translit, strongs_def FROM lexicon
               WHERE strongs_def LIKE ? OR kjv_def LIKE ?
                  OR strip_accents(lower(translit)) LIKE ?
                  OR strip_accents(lower(lemma)) LIKE ?
               LIMIT 15""",
            (f"%{q}%", f"%{q}%", f"%{qn}%", f"%{qn}%")
        ).fetchall()
        heb = conn.execute(
            """SELECT strongs_id, lemma, xlit, description FROM bdb
               WHERE description LIKE ?
                  OR strip_accents(lower(lemma)) LIKE ?
                  OR strip_accents(lower(xlit)) LIKE ?
               LIMIT 10""",
            (f"%{q}%", f"%{qn}%", f"%{qn}%")
        ).fetchall()
        results = [{"strongs": f"G{r['strongs']}", "lemma": r["lemma"] or "", "translit": r["translit"] or "", "gloss": r["strongs_def"] or ""} for r in grk]
        results += [{"strongs": r["strongs_id"], "lemma": r["lemma"] or "", "translit": r["xlit"] or "", "gloss": r["description"] or ""} for r in heb]
        return jsonify(results[:20])
    finally:
        conn.close()


@bp.route("/api/lexicon/english")
def lexicon_english():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    corpus = request.args.get("corpus", "all")
    testament = request.args.get("testament", "all")  # all | ot | nt
    _NT = {"Mat","Mar","Luk","Joh","Act","Rom","1Co","2Co","Gal","Eph","Php","Col",
           "1Th","2Th","1Ti","2Ti","Tit","Phm","Heb","Jas","1Pe","2Pe","1Jn","2Jn","3Jn","Jud","Rev"}
    # Testament filters. ABP: join words→verses and test book membership in the
    # NT set. KJV: book_id >= 40 is the NT. Empty strings when no filter active.
    if testament in ("nt", "ot"):
        _nt_ph = ",".join("?" * len(_NT))
        _op = "IN" if testament == "nt" else "NOT IN"
        _abp_join = "JOIN verses v ON v.id = w.verse_id"
        _abp_where = f"AND v.book {_op} ({_nt_ph})"
        _abp_params = sorted(_NT)
        _kjv_where = "AND kw.book_id >= 40" if testament == "nt" else "AND kw.book_id < 40"
    else:
        _abp_join = _abp_where = _kjv_where = ""
        _abp_params = []
    conn = db_ro()

    def _top_glosses_abp(snums):
        if not snums:
            return {}
        placeholders = ",".join("?" * len(snums))
        rows = conn.execute(f"""
            SELECT w.strongs_base, w.english_head, COUNT(*) AS cnt
            FROM words w {_abp_join}
            WHERE w.strongs_base IN ({placeholders})
              AND w.english_head IS NOT NULL AND w.english_head != ''
              {_abp_where}
            GROUP BY w.strongs_base, w.english_head
            ORDER BY w.strongs_base, cnt DESC
        """, (*snums, *_abp_params)).fetchall()
        out = {}
        for r in rows:
            sn = r["strongs_base"]
            g = r["english_head"]
            if " " in g:
                continue
            if sn not in out:
                out[sn] = []
            if len(out[sn]) < 8:
                out[sn].append({"gloss": g, "count": r["cnt"]})
        return out

    def _top_glosses_heb(snums):
        if not snums:
            return {}
        placeholders = ",".join("?" * len(snums))
        rows = conn.execute(f"""
            SELECT ks.strongs_id, kw.word, COUNT(*) AS cnt
            FROM kjv_words kw
            JOIN kjv_strongs ks ON ks.word_id = kw.word_id
            WHERE ks.strongs_id IN ({placeholders})
              AND (kw.italic IS NULL OR kw.italic = 0)
              {_kjv_where}
            GROUP BY ks.strongs_id, kw.word
            ORDER BY ks.strongs_id, cnt DESC
        """, snums).fetchall()
        out = {}
        for r in rows:
            sn = r["strongs_id"]
            if sn not in out:
                out[sn] = []
            if len(out[sn]) < 8:
                out[sn].append({"gloss": r["word"], "count": r["cnt"]})
        return out

    try:
        abp_rows, heb_rows = [], []

        if corpus in ("abp", "all"):
            # ABP Greek: match by english_head
            abp_rows = conn.execute(f"""
                SELECT w.strongs_base AS sbase,
                       l.lemma AS lemma, l.translit AS translit,
                       COUNT(*) AS cnt
                FROM words w
                LEFT JOIN lexicon l ON l.strongs_g = w.strongs_base
                {_abp_join}
                WHERE w.english_head = ? COLLATE NOCASE
                  AND w.strongs_base IS NOT NULL
                  AND w.strongs_base != '*'
                  AND w.strongs_base LIKE 'G%'
                  {_abp_where}
                GROUP BY w.strongs_base
                ORDER BY cnt DESC
                LIMIT 20
            """, (q, *_abp_params)).fetchall()
            # Drop function-word Strong's (ἐν, the article, conjunctions…). They
            # only reach an English-text lookup via a stray phrase-gloss whose
            # english_head borrowed a content noun ("in blessing" → head
            # "blessing"), so a content search like "blessing" would otherwise
            # surface them as junk hits. The Search tab filters them the same way.
            abp_rows = [r for r in abp_rows
                        if r["sbase"][1:] not in _FUNCTION_STRONGS]

        if corpus in ("kjv", "all"):
            # KJV words → strongs. In 'kjv' mode include BOTH NT Greek (G) and OT
            # Hebrew (H). In 'all' mode restrict to Hebrew (H) — the ABP rows above
            # already carry the Greek (LXX OT + Greek NT), and the KJV NT is the
            # SAME Greek text, so including G here would double-count it.
            kjv_filter = "AND ks.strongs_id LIKE 'H%'" if corpus == "all" else ""
            heb_rows = conn.execute(f"""
                SELECT ks.strongs_id AS sbase,
                       COALESCE(l.lemma, b.lemma)   AS lemma,
                       COALESCE(l.translit, b.xlit) AS translit,
                       COUNT(*) AS cnt
                FROM kjv_words kw
                JOIN kjv_strongs ks ON ks.word_id = kw.word_id
                LEFT JOIN lexicon l ON l.strongs_g = ks.strongs_id
                LEFT JOIN bdb b ON b.strongs_id = ks.strongs_id AND ks.strongs_id LIKE 'H%'
                WHERE kw.word = ? COLLATE NOCASE
                  AND (kw.italic IS NULL OR kw.italic = 0)
                  {_kjv_where}
                  {kjv_filter}
                GROUP BY ks.strongs_id
                ORDER BY cnt DESC
                LIMIT 10
            """, (q,)).fetchall()

        abp_snums = [r["sbase"] for r in abp_rows]
        heb_snums = [r["sbase"] for r in heb_rows]
        abp_glosses = _top_glosses_abp(abp_snums)
        heb_glosses = _top_glosses_heb(heb_snums)

        # Native-per-strongs: each number counts from its own corpus (Greek from
        # ABP, Hebrew from KJV). In 'all' the two lists are disjoint (ABP Greek +
        # KJV Hebrew), so we do NOT sum — summing would double-count the Greek NT,
        # which appears in both ABP and the KJV. Glosses are normalized so
        # case/whitespace/punct variants collapse to one.
        results = []
        def _emit(rows, gmap):
            for r in rows:
                gl = {}
                for g in gmap.get(r["sbase"], []):
                    key = _normalize_gloss(g["gloss"])
                    if key:
                        gl[key] = gl.get(key, 0) + g["count"]
                glosses = sorted(({"gloss": k, "count": c} for k, c in gl.items()),
                                 key=lambda x: -x["count"])[:8]
                results.append({"strongs": r["sbase"], "lemma": r["lemma"] or "",
                                "translit": r["translit"] or "", "count": r["cnt"],
                                "glosses": glosses})
        _emit(abp_rows, abp_glosses)
        _emit(heb_rows, heb_glosses)
        results.sort(key=lambda x: -x["count"])
        return jsonify(results)
    finally:
        conn.close()


@bp.route("/api/lexicon/profile/<strongs>")
def lexicon_profile(strongs):
    m = re.match(r'^([GgHh]?)(\d+(?:\.\d+)?)$', strongs.strip())
    if not m:
        return jsonify({"error": "invalid"}), 400
    prefix = m.group(1).upper()
    num = m.group(2)
    snum = num.split('.')[0]
    is_heb = prefix == 'H' or (not prefix and int(snum) > 5624)
    conn = db_ro()
    try:
        if is_heb:
            strongs_id = f"H{snum}"
            row = conn.execute(
                "SELECT lemma, xlit, description FROM bdb WHERE strongs_id = ?", (strongs_id,)
            ).fetchone()
            if not row:
                return jsonify({"error": "not found"}), 404
            lemma, translit, definition = row["lemma"] or "", row["xlit"] or "", row["description"] or ""
        else:
            strongs_id = f"G{snum}"
            row = conn.execute(
                "SELECT lemma, translit, strongs_def, kjv_def FROM lexicon WHERE strongs = ?", (snum,)
            ).fetchone()
            if not row:
                return jsonify({"error": "not found"}), 404
            lemma = row["lemma"] or ""
            translit = row["translit"] or ""
            definition = row["strongs_def"] or row["kjv_def"] or ""
        # Corpus: default H→kjv, G→abp; override via ?corpus=
        corpus = request.args.get("corpus", "kjv" if is_heb else "abp")
        if corpus == "all":  # profile is single-corpus; 'all' would double-count NT
            corpus = "kjv" if is_heb else "abp"
        _NT = {"Mat","Mar","Luk","Joh","Act","Rom","1Co","2Co","Gal","Eph","Php","Col",
               "1Th","2Th","1Ti","2Ti","Tit","Phm","Heb","Jas","1Pe","2Pe","1Jn","2Jn","3Jn","Jud","Rev"}
        book_meta = {r["abbrev"]: {"name": r["name"], "testament": "NT" if r["abbrev"] in _NT else "OT"}
                     for r in conn.execute("SELECT abbrev, name FROM books").fetchall()}
        sid = f"H{snum}" if is_heb else f"G{snum}"
        abbrev_by_id = {v: k for k, v in _KJV_BOOK_ID.items()}

        def _abp_book_counts():  # ABP interlinear: strongs_base in words→verses
            rows = conn.execute("""
                SELECT v.book AS book, COUNT(*) AS cnt
                FROM words w JOIN verses v ON w.verse_id = v.id
                WHERE w.strongs_base = ? GROUP BY v.book
            """, (sid,)).fetchall()
            return {r["book"]: r["cnt"] for r in rows}

        def _kjv_book_counts():  # KJV text: strongs_id in kjv_strongs→kjv_words
            rows = conn.execute("""
                SELECT kw.book_id AS book_id, COUNT(*) AS cnt
                FROM kjv_strongs ks JOIN kjv_words kw ON kw.word_id = ks.word_id
                WHERE ks.strongs_id = ? GROUP BY kw.book_id
            """, (sid,)).fetchall()
            out = {}
            for r in rows:
                abbrev = abbrev_by_id.get(r["book_id"], "")
                if abbrev:
                    out[abbrev] = out.get(abbrev, 0) + r["cnt"]
            return out

        def _abp_gloss_rows():
            return conn.execute("""
                SELECT english AS gloss, COUNT(*) AS cnt FROM words
                WHERE strongs_base = ? AND english IS NOT NULL AND english != '' AND english != '*'
                GROUP BY english
            """, (sid,)).fetchall()

        def _kjv_gloss_rows():
            return conn.execute("""
                SELECT kw.word AS gloss, COUNT(*) AS cnt
                FROM kjv_strongs ks JOIN kjv_words kw ON kw.word_id = ks.word_id
                WHERE ks.strongs_id = ? GROUP BY kw.word
            """, (sid,)).fetchall()

        # corpus=all merges the ABP + KJV distributions/glosses by book/rendering.
        book_counts = {}
        if corpus in ("abp", "all"):
            for b, c in _abp_book_counts().items():
                book_counts[b] = book_counts.get(b, 0) + c
        if corpus in ("kjv", "all"):
            for b, c in _kjv_book_counts().items():
                book_counts[b] = book_counts.get(b, 0) + c
        books = [{"book": b, "name": book_meta.get(b, {}).get("name", b),
                  "testament": book_meta.get(b, {}).get("testament", ""), "count": c}
                 for b, c in sorted(book_counts.items(), key=lambda x: -x[1])]
        total = sum(b["count"] for b in books)

        gloss_rows = []
        if corpus in ("abp", "all"):
            gloss_rows += _abp_gloss_rows()
        if corpus in ("kjv", "all"):
            gloss_rows += _kjv_gloss_rows()
        # Function-word Strong's (ἐν, the article, οὐ, καί…): label by the
        # connector inside the phrase, not the content word english_head picked.
        is_func = (not is_heb) and snum in _FUNCTION_STRONGS
        norm_counts = {}
        for r in gloss_rows:
            if not r["gloss"] or r["gloss"] in ("*", ""):
                continue
            key = _normalize_gloss(r["gloss"], is_func=is_func)
            if key:
                norm_counts[key] = norm_counts.get(key, 0) + r["cnt"]
        items = sorted(norm_counts.items(), key=lambda x: -x[1])
        # A few function-word rows carry a stray bare content gloss ("blessing")
        # from bracket/gloss mis-splits. In a word used thousands of times a
        # one-off rendering is noise, so drop singletons for function words.
        # Content words keep everything — a rare rendering there is meaningful.
        if is_func:
            items = [(g, c) for g, c in items if c > 1]
        glosses = [{"gloss": g, "count": c} for g, c in items]
        # Which corpora actually have this strongs (so the UI can gray unavailable
        # toggles). Checks real data — so backfilled proper-noun Hebrew (which DO
        # have ABP/words rows) keep ABP enabled.
        has_abp = conn.execute("SELECT 1 FROM words WHERE strongs_base = ? LIMIT 1", (sid,)).fetchone() is not None
        has_kjv = conn.execute("SELECT 1 FROM kjv_strongs WHERE strongs_id = ? LIMIT 1", (sid,)).fetchone() is not None
        return jsonify({"strongs": strongs_id, "lemma": lemma, "translit": translit, "definition": definition, "total": total, "books": books, "corpus": corpus, "glosses": glosses, "has_abp": has_abp, "has_kjv": has_kjv})
    except Exception:
        return jsonify({"error": "Server error"}), 500
    finally:
        conn.close()


@bp.route("/api/lexicon/books/<strongs>")
def lexicon_books(strongs):
    m = re.match(r'^([GgHh]?)(\d+(?:\.\d+)?)$', strongs.strip())
    if not m:
        return jsonify({"error": "invalid"}), 400
    prefix, snum = m.group(1).upper(), m.group(2)
    is_heb = prefix == "H"
    corpus = request.args.get("corpus", "kjv" if is_heb else "abp")
    if corpus == "all":
        corpus = "kjv" if is_heb else "abp"
    gloss = request.args.get("gloss", "").strip().lower()
    conn = db_ro()
    try:
        _NT = {"Mat","Mar","Luk","Joh","Act","Rom","1Co","2Co","Gal","Eph","Php","Col",
               "1Th","2Th","1Ti","2Ti","Tit","Phm","Heb","Jas","1Pe","2Pe","1Jn","2Jn","3Jn","Jud","Rev"}
        book_meta = {r["abbrev"]: {"name": r["name"], "testament": "NT" if r["abbrev"] in _NT else "OT"}
                     for r in conn.execute("SELECT abbrev, name FROM books").fetchall()}
        abbrev_by_id = {v: k for k, v in _KJV_BOOK_ID.items()}
        sid = f"H{snum}" if is_heb else f"G{snum}"
        is_func = (not is_heb) and snum.split('.')[0] in _FUNCTION_STRONGS
        book_counts = {}  # corpus=all merges ABP + KJV per book (gloss-filtered)
        if corpus in ("abp", "all"):
            for r in conn.execute("""
                SELECT v.book, w.english, COUNT(*) AS cnt
                FROM words w JOIN verses v ON w.verse_id = v.id
                WHERE w.strongs_base = ?
                GROUP BY v.book, w.english
            """, (sid,)).fetchall():
                if gloss and _normalize_gloss(r["english"] or "", is_func=is_func) != gloss:
                    continue
                book_counts[r["book"]] = book_counts.get(r["book"], 0) + r["cnt"]
        if corpus in ("kjv", "all"):
            for r in conn.execute("""
                SELECT kw.book_id, kw.word AS english, COUNT(*) AS cnt
                FROM kjv_strongs ks JOIN kjv_words kw ON kw.word_id = ks.word_id
                WHERE ks.strongs_id = ?
                GROUP BY kw.book_id, kw.word
            """, (sid,)).fetchall():
                if gloss and _normalize_gloss(r["english"] or "", is_func=is_func) != gloss:
                    continue
                abbrev = abbrev_by_id.get(r["book_id"], "")
                if abbrev:
                    book_counts[abbrev] = book_counts.get(abbrev, 0) + r["cnt"]
        books = [{"book": b, "name": book_meta.get(b, {}).get("name", b),
                  "testament": book_meta.get(b, {}).get("testament", ""), "count": c}
                 for b, c in sorted(book_counts.items(), key=lambda x: -x[1])]
        return jsonify({"books": books})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@bp.route("/api/lexicon/verses/<strongs>/<book>")
def lexicon_verses(strongs, book):
    m = re.match(r'^([GgHh]?)(\d+(?:\.\d+)?)$', strongs.strip())
    if not m:
        return jsonify([])
    prefix = m.group(1).upper()
    snum = m.group(2).split('.')[0]
    is_heb = prefix == 'H' or (not prefix and int(snum) > 5624)
    corpus = request.args.get("corpus", "kjv" if is_heb else "abp")
    gloss = request.args.get("gloss", "").strip()
    is_func = (not is_heb) and snum in _FUNCTION_STRONGS
    conn = db_ro()
    try:
        sid = f"H{snum}" if is_heb else f"G{snum}"
        if corpus == "all":  # verse text is single-corpus; show the word's native text
            corpus = "kjv" if is_heb else "abp"
        if corpus == "kjv":
            book_id = _KJV_BOOK_ID.get(book)
            if not book_id:
                conn.close()
                return jsonify({"verses": [], "glosses": []})
            # Render full verses from positioned tokens; highlight ONLY the words
            # actually tagged with the target strongs (exact, not by gloss match).
            # EXISTS restricts to verses that contain the strongs at least once.
            word_rows = conn.execute("""
                SELECT kw.chapter, kw.verse_num AS verse, kw.verse_pos,
                       kw.word, kw.italic, kw.punc,
                       MAX(CASE WHEN ks.strongs_id = ? THEN 1 ELSE 0 END) AS hl
                FROM kjv_words kw
                LEFT JOIN kjv_strongs ks ON ks.word_id = kw.word_id
                WHERE kw.book_id = ?
                  AND EXISTS (
                      SELECT 1 FROM kjv_words kw2
                      JOIN kjv_strongs ks2 ON ks2.word_id = kw2.word_id
                      WHERE kw2.book_id = kw.book_id
                        AND kw2.chapter = kw.chapter
                        AND kw2.verse_num = kw.verse_num
                        AND ks2.strongs_id = ?
                  )
                GROUP BY kw.word_id
                ORDER BY kw.chapter, kw.verse_num, kw.verse_pos
            """, (sid, book_id, sid)).fetchall()
        else:
            word_rows = conn.execute("""
                SELECT v.chapter, v.verse, v.text AS prose, w.english AS word, w.italic,
                       CASE WHEN w.strongs_base = ? THEN 1 ELSE 0 END AS hl
                FROM verses v
                JOIN words w ON w.verse_id = v.id
                WHERE v.book = ? AND v.id IN (
                    SELECT verse_id FROM words WHERE strongs_base = ?
                )
                ORDER BY v.chapter, v.verse, w.position
            """, (sid, book, sid)).fetchall()
        verse_prose = {}
        verse_order = []
        gloss_counts = {}
        if corpus == "kjv":
            verses = {}
            for r in word_rows:
                key = (r["chapter"], r["verse"])
                if key not in verses:
                    verses[key] = []
                    verse_order.append(key)
                word = r["word"] or ""
                hl = bool(r["hl"])
                verses[key].append({"w": word, "h": hl,
                                    "i": 1 if r["italic"] else 0,
                                    "punc": r["punc"] or ""})
                if hl and word:
                    norm = _normalize_gloss(word, is_func=is_func)
                    if norm:
                        gloss_counts[norm] = gloss_counts.get(norm, 0) + 1
            if gloss:
                verse_order = [k for k in verse_order
                               if any(e["h"] and _normalize_gloss(e["w"], is_func=is_func) == gloss for e in verses[k])]
            result_verses = [{"chapter": k[0], "verse": k[1], "words": verses[k]} for k in verse_order]
        else:
            verses = {}
            for r in word_rows:
                key = (r["chapter"], r["verse"])
                word = r["word"] or ""
                hl = bool(r["hl"])
                if key not in verses:
                    verses[key] = []
                    verse_prose[key] = r["prose"]
                    verse_order.append(key)
                verses[key].append({"w": word, "h": hl, "i": r["italic"] or 0})
                if hl and word:
                    norm = _normalize_gloss(word, is_func=is_func)
                    if norm:
                        gloss_counts[norm] = gloss_counts.get(norm, 0) + 1
            if gloss:
                verse_order = [k for k in verse_order
                               if any(e["h"] and _normalize_gloss(e["w"], is_func=is_func) == gloss for e in verses[k])]
            result_verses = [{"chapter": k[0], "verse": k[1], "words": verses[k], "text": verse_prose.get(k)} for k in verse_order]
        result_glosses = sorted([{"gloss": g, "count": c} for g, c in gloss_counts.items()], key=lambda x: -x["count"])
        conn.close()
        return jsonify({"verses": result_verses, "glosses": result_glosses})
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500
