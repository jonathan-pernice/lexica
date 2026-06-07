#!/usr/bin/env python3
"""Search routes (Phase 3 of REDESIGN_PLAN.md).

The /api/search endpoint (study-mode lexicon/Strong's search) plus its KJV
parallel helpers. Returns ABP + KJV results, gloss groupings, and dotted-variant
maps. Results are cached in-memory (_search_cache) keyed by "v3|q|phrase".

KJV results come from the _kjv_strongs_search / _kjv_word_search helpers.
"""
from collections import Counter
import json

from flask import Blueprint, Response, jsonify, request

from core import (
    db, _strongs_num, _strip_accents, _clean_gloss,
    _FUNCTION_STRONGS, _KJV_BOOK_ID_REV,
)

bp = Blueprint("search", __name__)

_search_cache: dict = {}        # in-memory lexicon search cache (q → payload)


def _kjv_strongs_search(conn, sids, out_rows, out_groupings):
    """Fetch KJV verse results for a list of strongs IDs (e.g. ['G4151','H7307'])."""
    for sid in sids:
        sid = sid.upper()
        base = sid.lstrip("GH")
        if base in _FUNCTION_STRONGS:
            continue
        is_hebrew = sid.startswith("H")
        if is_hebrew:
            meta = conn.execute(
                "SELECT lemma, xlit, description AS def FROM bdb WHERE strongs_id = ?", (sid,)
            ).fetchone()
        else:
            meta = conn.execute(
                "SELECT lemma, translit AS xlit, strongs_def AS def, derivation FROM lexicon WHERE strongs = ?", (base,)
            ).fetchone()
        lemma      = meta["lemma"] if meta else ""
        xlit       = meta["xlit"]  if meta else ""
        definition = meta["def"]   if meta else ""
        for r in conn.execute("""
            SELECT kw.book_id, kw.chapter, kw.verse_num, kw.word
            FROM kjv_strongs ks
            JOIN kjv_words kw ON kw.word_id = ks.word_id
            WHERE ks.strongs_id = ?
            ORDER BY kw.book_id, kw.chapter, kw.verse_num
            LIMIT 500
        """, (sid,)).fetchall():
            book = _KJV_BOOK_ID_REV.get(r["book_id"], "")
            out_rows.append({
                "ref": f"{book} {r['chapter']}:{r['verse_num']}",
                "book": book, "chapter": r["chapter"], "verse": r["verse_num"],
                "strongs": sid, "strongs_base": base, "strongs_raw": base,
                "gloss": r["word"] or "", "gloss_head": r["word"] or "",
                "lemma": lemma, "translit": xlit,
                "strongs_def": definition, "kjv_def": "",
                "derivation": (meta["derivation"] or "") if (meta and not is_hebrew) else "",
                "is_function": False, "isKjv": True, "isHebrew": is_hebrew,
                "source": "kjv",
            })
        for gr in conn.execute("""
            SELECT kw.word AS w, COUNT(*) AS cnt
            FROM kjv_strongs ks JOIN kjv_words kw ON kw.word_id = ks.word_id
            WHERE ks.strongs_id = ?
            GROUP BY kw.word HAVING cnt > 1 ORDER BY cnt DESC
        """, (sid,)).fetchall():
            out_groupings.setdefault(sid, []).append({"gloss": gr["w"], "count": gr["cnt"]})


def _kjv_word_search(conn, word, out_rows, out_groupings):
    """Search KJV by English word, returning results for all matching strongs (G+H)."""
    rows = conn.execute("""
        SELECT kw.book_id, kw.chapter, kw.verse_num, kw.word, ks.strongs_id,
               MAX(COALESCE(bdb.lemma, lex.lemma))        AS lemma,
               MAX(COALESCE(bdb.xlit, lex.translit))      AS xlit,
               MAX(COALESCE(lex.strongs_def, bdb.description)) AS definition,
               MAX(lex.derivation)                         AS derivation
        FROM kjv_words kw
        JOIN kjv_strongs ks ON ks.word_id = kw.word_id
        LEFT JOIN bdb ON bdb.strongs_id = ks.strongs_id AND ks.strongs_id LIKE 'H%'
        LEFT JOIN lexicon lex ON lex.strongs_g = ks.strongs_id
        WHERE kw.word = ? COLLATE NOCASE
        GROUP BY kw.book_id, kw.chapter, kw.verse_num, ks.strongs_id
        ORDER BY kw.book_id, kw.chapter, kw.verse_num
        LIMIT 500
    """, (word,)).fetchall()
    sid_counts = Counter(r["strongs_id"] for r in rows if r["strongs_id"].lstrip("GH") not in _FUNCTION_STRONGS)
    found_sids = [sid for sid, cnt in sid_counts.items() if cnt >= 3]
    for r in rows:
        sid  = r["strongs_id"]
        base = sid.lstrip("GH")
        if base in _FUNCTION_STRONGS:
            continue
        book = _KJV_BOOK_ID_REV.get(r["book_id"], "")
        out_rows.append({
            "ref": f"{book} {r['chapter']}:{r['verse_num']}",
            "book": book, "chapter": r["chapter"], "verse": r["verse_num"],
            "strongs": sid, "strongs_base": base, "strongs_raw": base,
            "gloss": r["word"] or "", "gloss_head": r["word"] or "",
            "lemma": r["lemma"] or "", "translit": r["xlit"] or "",
            "strongs_def": r["definition"] or "", "kjv_def": "",
            "derivation": (r["derivation"] or "") if not sid.startswith("H") else "",
            "is_function": False, "isKjv": True, "isHebrew": sid.startswith("H"),
            "source": "kjv",
        })
    for sid in found_sids:
        for gr in conn.execute("""
            SELECT kw.word AS w, COUNT(*) AS cnt
            FROM kjv_strongs ks JOIN kjv_words kw ON kw.word_id = ks.word_id
            WHERE ks.strongs_id = ? GROUP BY kw.word HAVING cnt > 1 ORDER BY cnt DESC
        """, (sid,)).fetchall():
            out_groupings.setdefault(sid, []).append({"gloss": gr["w"], "count": gr["cnt"]})


@bp.route("/api/search")
def search():
    q = request.args.get("q", "").strip()
    phrase_mode = request.args.get("phrase", "0") == "1"

    if not q:
        return jsonify({"abp_results": [], "kjv_results": [], "abp_groupings": {}, "kjv_groupings": {}, "variants": {}})

    cache_key = f"v3|{q}|{phrase_mode}"
    if cache_key in _search_cache:
        return Response(_search_cache[cache_key], mimetype="application/json")

    conn = db()
    groupings: dict = {}
    variants: dict = {}
    kjv_rows: list = []
    kjv_groupings: dict = {}
    try:
        snum = _strongs_num(q)
        q_plain = _strip_accents(q)
        if snum:
            col = "w.strongs" if "." in snum else "w.strongs_base"
            rows = conn.execute(
                f"""
                SELECT w.strongs_base, w.strongs, w.english, w.english_head,
                       v.id AS verse_id, v.book, v.chapter, v.verse,
                       l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
                FROM words w
                JOIN verses v ON w.verse_id = v.id
                LEFT JOIN lexicon l ON l.strongs_g = w.strongs_base
                WHERE ({col} = ? OR {col} = ? OR {col} = ?)
                  AND w.english IS NOT NULL AND w.english != ''
                  AND w.strongs_base != '*'
                ORDER BY v.id, w.position
                LIMIT 500
                """,
                (snum, f"G{snum}", f"H{snum}"),
            ).fetchall()
            # KJV: search by base strongs (strip dot if dotted)
            base_snum = snum.split(".")[0]
            _is_h_snum = q.strip().upper().startswith("H") or (base_snum.isdigit() and int(base_snum) > 5624)
            kjv_sid = f"H{base_snum}" if _is_h_snum else f"G{base_snum}"
            _kjv_strongs_search(conn, [kjv_sid], kjv_rows, kjv_groupings)
        else:
            if phrase_mode:
                # Phrase mode: word-boundary match within the full multi-word gloss.
                rows = conn.execute(
                    """
                    SELECT w.strongs_base, w.strongs, w.english, w.english_head,
                           v.id AS verse_id, v.book, v.chapter, v.verse,
                           l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
                    FROM words w
                    JOIN verses v ON w.verse_id = v.id
                    LEFT JOIN lexicon l ON l.strongs_g = w.strongs_base
                    WHERE (word_boundary(w.english, ?)
                           OR word_boundary(strip_accents(l.translit), ?))
                      AND w.english IS NOT NULL AND w.english != ''
                      AND w.strongs_base != '*'
                    ORDER BY v.id, w.position
                    LIMIT 500
                    """,
                    (q, q_plain),
                ).fetchall()
            else:
                # Default mode: exact head-word match (english_head is a single token),
                # with english fallback for rows where english_head is null,
                # or transliteration prefix/substring for Greek lookup flexibility.
                rows = conn.execute(
                    """
                    SELECT w.strongs_base, w.strongs, w.english, w.english_head,
                           v.id AS verse_id, v.book, v.chapter, v.verse,
                           l.lemma, l.translit, l.strongs_def, l.kjv_def, l.derivation
                    FROM words w
                    JOIN verses v ON w.verse_id = v.id
                    LEFT JOIN lexicon l ON l.strongs_g = w.strongs_base
                    WHERE (w.english_head = ? COLLATE NOCASE
                           OR w.english = ? COLLATE NOCASE
                           OR word_boundary(strip_accents(l.translit), ?)
                           OR strip_accents(l.lemma) = ?)
                      AND w.english IS NOT NULL AND w.english != ''
                      AND w.strongs_base != '*'
                    ORDER BY v.id, w.position
                    LIMIT 500
                    """,
                    (q, q, q_plain, q_plain),
                ).fetchall()
                # Also search proper nouns (strongs='*') by name
                pn_rows = conn.execute(
                    """
                    SELECT w.strongs_base, w.strongs, w.english, w.english_head,
                           v.id AS verse_id, v.book, v.chapter, v.verse,
                           NULL AS lemma, NULL AS translit, NULL AS strongs_def,
                           NULL AS kjv_def, NULL AS derivation
                    FROM words w
                    JOIN verses v ON w.verse_id = v.id
                    WHERE w.english_head = ? COLLATE NOCASE
                      AND w.strongs_base = '*'
                    ORDER BY v.id, w.position
                    LIMIT 300
                    """,
                    (q,),
                ).fetchall()
                rows = list(rows) + list(pn_rows)
        # Gloss groupings: keyed by exact dotted strongs number.
        def _is_content(r):
            return r["strongs"] and r["strongs"] != "*" and r["strongs_base"] not in _FUNCTION_STRONGS

        hebrew_strongs = []
        if snum:
            unique_strongs = list({r["strongs"] for r in rows if _is_content(r)})
        else:
            # Greek groupings: top G-strongs where searched term is a primary ABP translation
            greek_strongs = [
                r["strongs"] for r in conn.execute(
                    """SELECT strongs,
                              SUM(CASE WHEN english_head = ? COLLATE NOCASE THEN 1 ELSE 0 END) AS m
                       FROM words
                       WHERE strongs IS NOT NULL AND strongs != '*'
                       GROUP BY strongs
                       HAVING m >= 10 AND m * 10 >= COUNT(*)
                       ORDER BY m DESC
                       LIMIT 4""",
                    (q,),
                ).fetchall()
                if r["strongs"] not in _FUNCTION_STRONGS
            ]
            # Hebrew groupings: top H-strongs from KJV where the English word matches
            hebrew_strongs = [
                r["strongs_id"] for r in conn.execute(
                    """WITH totals AS (
                           SELECT strongs_id, COUNT(*) AS total
                           FROM kjv_strongs WHERE strongs_id LIKE 'H%'
                           GROUP BY strongs_id
                       )
                       SELECT ks.strongs_id,
                              COUNT(*) AS match_cnt,
                              t.total AS total_cnt
                       FROM kjv_strongs ks
                       JOIN kjv_words kw ON kw.word_id = ks.word_id
                       JOIN totals t ON t.strongs_id = ks.strongs_id
                       WHERE kw.word = ? COLLATE NOCASE
                         AND ks.strongs_id LIKE 'H%'
                       GROUP BY ks.strongs_id
                       HAVING match_cnt >= 50 AND match_cnt * 10 >= total_cnt
                       ORDER BY match_cnt DESC
                       LIMIT 4""",
                    (q,),
                ).fetchall()
            ]
            unique_strongs = greek_strongs
        if unique_strongs:
            placeholders = ",".join("?" * len(unique_strongs))
            for gr in conn.execute(
                f"""SELECT strongs, english_head, COUNT(*) AS cnt
                    FROM words
                    WHERE strongs IN ({placeholders})
                      AND english_head IS NOT NULL AND english_head != ''
                    GROUP BY strongs, english_head
                    HAVING cnt > 1
                    ORDER BY strongs, cnt DESC""",
                unique_strongs,
            ).fetchall():
                groupings.setdefault(gr["strongs"], []).append({"gloss": gr["english_head"], "count": gr["cnt"]})
        # Sibling variants: for each strongs_base that has dotted results,
        # fetch all corpus variants so the frontend can show related numbers.
        dotted_bases = {
            r["strongs_base"] for r in rows
            if r["strongs_base"] and r["strongs_base"] != "*"
            and r["strongs"] and "." in r["strongs"]
        }
        for base in dotted_bases:
            var_rows = conn.execute(
                "SELECT DISTINCT strongs FROM words WHERE strongs_base = ? ORDER BY strongs",
                (base,),
            ).fetchall()
            all_v = [v["strongs"] for v in var_rows]
            if len(all_v) > 1:
                variants[base] = all_v
        # ── KJV parallel search ───────────────────────────────────────────
        if not snum:
            # English word search: KJV results (G+H) via word match
            _kjv_word_search(conn, q, kjv_rows, kjv_groupings)
            # Also search BDB by transliteration for additional H coverage
            q_no_w = q_plain.replace('w', '').replace('W', '')
            extra_h = set()
            for hit in conn.execute(
                """SELECT strongs_id FROM bdb
                   WHERE strip_accents(xlit) LIKE ? COLLATE NOCASE
                      OR REPLACE(REPLACE(strip_accents(xlit),'w',''),'W','') LIKE ? COLLATE NOCASE
                   LIMIT 5""",
                (f"{q_plain}%", f"{q_no_w}%")
            ).fetchall():
                h_id = hit['strongs_id']
                if h_id not in {r["strongs"] for r in kjv_rows}:
                    extra_h.add(h_id)
            if extra_h:
                _kjv_strongs_search(conn, list(extra_h), kjv_rows, kjv_groupings)
    finally:
        conn.close()

    # Deduplicate to one entry per (strongs_base, verse) — study mode renders
    # verse-level anyway, so word-level duplicates are wasted payload.
    seen_verse_keys = set()
    deduped_rows = []
    for r in rows:
        k = (r["strongs_base"], r["book"], r["chapter"], r["verse"])
        if k not in seen_verse_keys:
            seen_verse_keys.add(k)
            deduped_rows.append(r)

    abp_results = [
        {
            "ref":        f"{r['book']} {r['chapter']}:{r['verse']}",
            "book":       r["book"],
            "chapter":    r["chapter"],
            "verse":      r["verse"],
            "strongs":    r["strongs"],
            "strongs_base": r["strongs_base"],
            "gloss":      _clean_gloss(r["english"]),
            "gloss_head": r["english_head"] or "",
            "lemma":      r["lemma"],
            "translit":   r["translit"],
            "strongs_def": (r["strongs_def"] or "").strip(),
            "kjv_def":    r["kjv_def"],
            "derivation": (r["derivation"] or "").strip(),
            "is_function": r["strongs_base"] in _FUNCTION_STRONGS,
            "source":     "abp",
        }
        for r in deduped_rows
    ]

    payload = {
        "abp_results":   abp_results,
        "kjv_results":   kjv_rows,
        "abp_groupings": groupings,
        "kjv_groupings": kjv_groupings,
        "variants":      variants,
    }
    json_str = json.dumps(payload)
    if len(_search_cache) < 200:
        _search_cache[cache_key] = json_str
    return Response(json_str, mimetype="application/json")
