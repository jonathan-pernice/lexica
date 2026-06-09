#!/usr/bin/env python3
"""Cross-reference (TSK) routes (Phase 3 of REDESIGN_PLAN.md).

Torrey's Treasury of Scripture Knowledge cross-references for a verse, plus the
two Haiku-backed endpoints that synthesise / curate them. Cross-ref payloads are
cached in core._ai_cache (in-memory) and in the ai_search_cache table with
ver_key=_XREF_VER — the unified prompt fingerprint (core.ai_fingerprint over the two
xref system prompts). Editing either prompt auto-refreshes this cache and nothing else.

_XREF_SYNTHESIS_SYSTEM is also imported by the AI blueprint (the cross-ref
enrichment helper), so it lives here with its primary consumer.
"""
import json
import re

from flask import Blueprint, jsonify

from core import (
    db_ro, _anthropic, limiter, log, _ai_cache,
    _KJV_BOOK_ID, _KJV_BOOK_ID_REV,
    ai_fingerprint, ai_cache_get, ai_cache_put, ai_cache_prune,
)

bp = Blueprint("crossref", __name__)


_XREF_SYNTHESIS_SYSTEM = """\
You are a textual scholar with a Berean approach: the text speaks first. Working only \
from the passages in front of you, say how the cross-referenced verses connect. Bring in \
no systematic theology and no outside doctrinal framework — follow where the words lead.

Write for a reader who knows no Greek or Hebrew. Keep it plain and concrete, never \
academic. One idea per sentence, short sentences, and never pack several parallels into a \
run-on. Let the length follow the connection: a simple link needs a sentence or two, a \
rich one a few more — up to about 100 words. Do not pad, and do not cram.

Be selective — name the strongest link or two, not every parallel. Describe the \
connection the passages themselves make. Do not settle contested questions, moralize, or \
add application; where a reading is genuinely debated, leave it open. Report the plain \
sense, including anything supernatural, as the text gives it — never rationalize it or \
soften it into a natural explanation.

If you cite a Greek or Hebrew word, give a readable transliteration and a short English \
gloss once — for example, tov, "good" — never the original script, and never the same \
gloss twice. Do not name any app, database, source, or translation. Open straight into \
the first sentence: no heading, no label, and never a stock phrase like "The thematic \
thread" or "These passages." Vary how you begin.

Here is one example of the right voice, on a different passage:
In the wilderness bread appears on the ground each morning, and the people ask man hu, \
"what is it?" — the question that becomes its name. Later passages keep returning to this \
bread: a jar of it set before the covenant, and a generation that ate it and still died. \
The thread is daily provision no one earned, and how quickly it was forgotten. Whether \
the kept jar means more than a memorial, the texts do not say.\
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

# One fingerprint for both xref endpoints (they share a category). Editing either
# system prompt above changes it, so cached synthesis/curation lazily refreshes.
_XREF_VER = ai_fingerprint("xref", _XREF_CURATION_SYSTEM, _XREF_SYNTHESIS_SYSTEM)


def prune_cache() -> int:
    """Startup: drop xref rows tagged with an older prompt fingerprint."""
    return ai_cache_prune("xref", _XREF_VER)


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
    cached = ai_cache_get(cache_key, _XREF_VER)
    if cached is not None:
        _ai_cache[cache_key] = cached
        return jsonify(cached)
    conn = db_ro()
    try:
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
            model="claude-sonnet-4-6",
            max_tokens=400,
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
    ai_cache_put(cache_key, payload, _XREF_VER)
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
    cached = ai_cache_get(cache_key, _XREF_VER)
    if cached is not None:
        _ai_cache[cache_key] = cached
        return jsonify(cached)

    conn = db_ro()
    try:
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
                model="claude-sonnet-4-6",
                max_tokens=400,
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
    ai_cache_put(cache_key, payload, _XREF_VER)
    _ai_cache[cache_key] = payload
    return jsonify(payload)
