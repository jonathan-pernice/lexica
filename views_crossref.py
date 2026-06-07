#!/usr/bin/env python3
"""Cross-reference (TSK) routes (Phase 3 of REDESIGN_PLAN.md).

Torrey's Treasury of Scripture Knowledge cross-references for a verse, plus the
two Haiku-backed endpoints that synthesise / curate them. Cross-ref payloads are
cached in core._ai_cache (in-memory) and in the ai_search_cache table with
ver_key='xref' (preserved across AI-cache version bumps).

_XREF_SYNTHESIS_SYSTEM is also imported by the AI blueprint (the cross-ref
enrichment helper), so it lives here with its primary consumer.
"""
import json
import re
import time

from flask import Blueprint, jsonify

from core import (
    db, db_ro, _anthropic, limiter, log, _ai_cache,
    _KJV_BOOK_ID, _KJV_BOOK_ID_REV,
)

bp = Blueprint("crossref", __name__)


_XREF_SYNTHESIS_SYSTEM = """\
You are a textual scholar working from a Berean approach: the text speaks first. \
Let the Greek and Hebrew source words anchor the analysis. Import no systematic \
theology, no denominational assumptions, and no doctrinal framework from outside \
the passages themselves — follow where the words actually lead. Write 3 to 5 complete sentences identifying the thematic thread connecting a set of \
cross-referenced passages. Focus on the underlying Greek/Hebrew lexical range, canonical \
patterns, and intertextual echoes. Never mention any app, database, data source, \
or translation by name. Do not begin with a label, heading, or prefix of any kind — \
start directly with the first sentence. Write in plain, direct language — clear and readable, not academic jargon. \
Each sentence should be one complete thought — not a fragment, not a paragraph.\
"""

_XREF_CURATION_SYSTEM = """\
You are a biblical scholar evaluating cross-references from Torrey's Treasury of \
Scripture Knowledge. Given a source verse and a numbered list of candidate passages, \
select the 8 to 10 with the strongest connection to the source — prioritizing direct \
quotations, shared key terms in the Greek or Hebrew, thematic parallels, and \
canonical echoes. Exclude weak matches that share only common vocabulary with no \
deeper connection. Return ONLY a JSON array of the selected 1-based numbers, \
e.g. [1,3,7,12]. No prose, no explanation — only the array.\
"""


@bp.route("/api/cross-references/<book>/<int:chapter>/<int:verse>")
def cross_references_route(book, chapter, verse):
    book_id = _KJV_BOOK_ID.get(book)
    if book_id is None:
        return jsonify([])
    conn = db_ro()
    try:
        row = conn.execute(
            "SELECT verse_id FROM kjv_verses WHERE book_id=? AND chapter=? AND verse_num=?",
            (book_id, chapter, verse),
        ).fetchone()
        if not row:
            return jsonify([])
        refs = conn.execute(
            """SELECT kv.book_id, kv.chapter, kv.verse_num, kv.verse_text
               FROM cross_references cr
               JOIN kjv_verses kv ON kv.verse_id = cr.verse_ref_id
               WHERE cr.verse_id = ?
               ORDER BY kv.verse_id""",
            (row["verse_id"],),
        ).fetchall()
    finally:
        conn.close()
    result = []
    for r in refs:
        abbrev = _KJV_BOOK_ID_REV.get(r["book_id"])
        if abbrev:
            result.append({
                "book":     abbrev,
                "chapter":  r["chapter"],
                "verse":    r["verse_num"],
                "ref":      f"{abbrev} {r['chapter']}:{r['verse_num']}",
                "kjv_text": r["verse_text"],
            })
    return jsonify(result)


@bp.route("/api/cross-references/synthesis/<book>/<int:chapter>/<int:verse>")
@limiter.limit("200 per hour")
def cross_ref_synthesis(book, chapter, verse):
    if not _anthropic:
        return jsonify({"synthesis": None})
    book_id = _KJV_BOOK_ID.get(book)
    if book_id is None:
        return jsonify({"synthesis": None})
    cache_key = f"xref_synth:{book}:{chapter}:{verse}"
    if cache_key in _ai_cache:
        return jsonify(_ai_cache[cache_key])
    conn = db_ro()
    try:
        cached = conn.execute(
            "SELECT result_json FROM ai_search_cache WHERE query=?", (cache_key,)
        ).fetchone()
        if cached:
            payload = json.loads(cached["result_json"])
            _ai_cache[cache_key] = payload
            return jsonify(payload)
        src = conn.execute(
            "SELECT verse_id, verse_text FROM kjv_verses"
            " WHERE book_id=? AND chapter=? AND verse_num=?",
            (book_id, chapter, verse),
        ).fetchone()
        if not src:
            return jsonify({"synthesis": None})
        refs = conn.execute(
            """SELECT kv.verse_text FROM cross_references cr
               JOIN kjv_verses kv ON kv.verse_id = cr.verse_ref_id
               WHERE cr.verse_id = ? LIMIT 20""",
            (src["verse_id"],),
        ).fetchall()
    finally:
        conn.close()
    if not refs:
        return jsonify({"synthesis": None})
    ref_block = "\n".join(f"- {r['verse_text']}" for r in refs)
    try:
        msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=350,
            temperature=0,
            system=_XREF_SYNTHESIS_SYSTEM,
            messages=[{"role": "user", "content":
                f'Source: "{src["verse_text"]}"\n\nCross-references:\n{ref_block}'}],
        )
        synthesis = re.sub(r"^#+\s*[^:\n]*:\s*", "", msg.content[0].text.strip())
    except Exception as exc:
        log.warning("Cross-ref synthesis failed: %s", exc)
        return jsonify({"synthesis": None})
    payload = {"synthesis": synthesis}
    conn = db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO ai_search_cache"
            " (query, result_json, ver_key, created_at) VALUES (?,?,?,?)",
            (cache_key, json.dumps(payload), "xref", time.time()),
        )
        conn.commit()
    finally:
        conn.close()
    _ai_cache[cache_key] = payload
    return jsonify(payload)


@bp.route("/api/cross-references/curated/<book>/<int:chapter>/<int:verse>")
@limiter.limit("200 per hour")
def cross_refs_curated(book, chapter, verse):
    if not _anthropic:
        return jsonify({"refs": [], "synthesis": None})
    book_id = _KJV_BOOK_ID.get(book)
    if book_id is None:
        return jsonify({"refs": [], "synthesis": None})

    cache_key = f"xref_cur:{book}:{chapter}:{verse}"
    if cache_key in _ai_cache:
        return jsonify(_ai_cache[cache_key])

    conn = db_ro()
    try:
        cached = conn.execute(
            "SELECT result_json FROM ai_search_cache WHERE query=?", (cache_key,)
        ).fetchone()
        if cached:
            payload = json.loads(cached["result_json"])
            _ai_cache[cache_key] = payload
            return jsonify(payload)

        src = conn.execute(
            "SELECT verse_id, verse_text FROM kjv_verses"
            " WHERE book_id=? AND chapter=? AND verse_num=?",
            (book_id, chapter, verse),
        ).fetchone()
        if not src:
            return jsonify({"refs": [], "synthesis": None})

        all_refs = conn.execute(
            """SELECT kv.verse_id, kv.book_id, kv.chapter, kv.verse_num, kv.verse_text
               FROM cross_references cr
               JOIN kjv_verses kv ON kv.verse_id = cr.verse_ref_id
               WHERE cr.verse_id = ?
               ORDER BY kv.verse_id""",
            (src["verse_id"],),
        ).fetchall()

        # Fetch ABP text for the source verse so synthesis reflects ABP vocabulary
        abp_text = ""
        abp_id_row = conn.execute(
            "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
            (book, chapter, verse),
        ).fetchone()
        if abp_id_row:
            abp_words = conn.execute(
                "SELECT english FROM words WHERE verse_id=? AND english IS NOT NULL ORDER BY position",
                (abp_id_row["id"],),
            ).fetchall()
            abp_text = " ".join(w["english"] for w in abp_words)
    finally:
        conn.close()

    if not all_refs:
        return jsonify({"refs": [], "synthesis": None})

    # Step 1: Haiku selects the 8–10 most relevant cross-refs
    numbered = "\n".join(f"{i+1}. {r['verse_text']}" for i, r in enumerate(all_refs))
    selected_refs = []
    try:
        sel_msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=120,
            temperature=0,
            system=_XREF_CURATION_SYSTEM,
            messages=[{"role": "user", "content": (
                f'Source: "{src["verse_text"]}"\n\nCandidates:\n{numbered}\n\n'
                "Return ONLY a JSON array of selected 1-based numbers."
            )}],
        )
        raw = sel_msg.content[0].text.strip()
        m = re.search(r'\[[\d,\s]+\]', raw)
        if m:
            indices = json.loads(m.group())
            selected_refs = [
                all_refs[i - 1] for i in indices
                if isinstance(i, int) and 1 <= i <= len(all_refs)
            ][:10]
    except Exception as exc:
        log.warning("Cross-ref curation failed: %s", exc)

    if not selected_refs:
        selected_refs = list(all_refs[:8])

    refs = []
    for r in selected_refs:
        abbrev = _KJV_BOOK_ID_REV.get(r["book_id"])
        if abbrev:
            refs.append({
                "book":    abbrev,
                "chapter": r["chapter"],
                "verse":   r["verse_num"],
                "ref":     f"{abbrev} {r['chapter']}:{r['verse_num']}",
                "kjv_text": r["verse_text"],
            })

    # Step 2: Synthesis from the curated set
    synthesis = None
    if refs:
        ref_block = "\n".join(f"- {r['kjv_text']}" for r in refs)
        src_line = (
            f'Source (ABP): "{abp_text}"\n'
            "The cross-references below are KJV; let the ABP source vocabulary guide your word choices."
            if abp_text else f'Source: "{src["verse_text"]}"'
        )
        try:
            syn_msg = _anthropic.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=350,
                temperature=0,
                system=_XREF_SYNTHESIS_SYSTEM,
                messages=[{"role": "user", "content":
                    f'{src_line}\n\nCross-references:\n{ref_block}'}],
            )
            synthesis = re.sub(
                r"^#+\s*[^:\n]*:\s*", "", syn_msg.content[0].text.strip()
            )
        except Exception as exc:
            log.warning("Cross-ref synthesis failed: %s", exc)

    payload = {"refs": refs, "synthesis": synthesis}
    conn = db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO ai_search_cache"
            " (query, result_json, ver_key, created_at) VALUES (?,?,?,?)",
            (cache_key, json.dumps(payload), "xref", time.time()),
        )
        conn.commit()
    finally:
        conn.close()
    _ai_cache[cache_key] = payload
    return jsonify(payload)
