#!/usr/bin/env python3
"""LSJ / BDB lexicon-entry routes (Phase 3 of REDESIGN_PLAN.md).

Liddell-Scott-Jones Greek entries (with abp_ext + Strong's fallbacks), the
Haiku-backed LSJ sense summary, and Brown-Driver-Briggs Hebrew entries.

_lsj_concept_lookup and _format_lsj_context are used by the AI blueprint (its
LSJ-context step), so they live here with the other LSJ helpers and the AI module
imports them.
"""
import json
import re
from html.parser import HTMLParser

from flask import Blueprint, jsonify, request

from core import db, db_ro, _anthropic, limiter, log, _strip_accents

bp = Blueprint("lsj", __name__)


_LSJ_SYNTHESIS_SYSTEM = """\
You are a Greek lexicographer working from a Berean approach: the text speaks first. \
Anchor all analysis in the Greek source words and their lexical range as used in the \
Septuagint (LXX) and New Testament. Focus on biblical usage — how the word functions \
in the ABP interlinear, what it means in OT and NT contexts, and what its semantic \
range reveals about the text. Do not reference classical authors (Homer, Attic, Plato, \
Aristotle etc.) or classical Greek literary usage — the audience is reading the Bible, \
not classical literature. No imported systematic theology, no denominational assumptions \
— follow where the words actually lead. Write in plain prose, no markdown, no headers. \
Do not state the word's grammatical parsing (part of speech, case, number, tense, \
voice, mood) — that is shown separately. Focus only on meaning and semantic range.\
"""

# keyed on LSJ key; persists for server lifetime. Capped so a long-running worker
# can't grow it without bound — context-keyed entries are many distinct keys.
_lsj_summary_cache: dict = {}
_LSJ_SUMMARY_CACHE_MAX = 500


def _cache_lsj_summary(key: str, payload: dict) -> dict:
    """Store a summary payload, bounding the in-memory cache size. Returns payload."""
    if len(_lsj_summary_cache) < _LSJ_SUMMARY_CACHE_MAX:
        _lsj_summary_cache[key] = payload
    return payload

_LSJ_TERM_LIMIT = 4  # max LSJ entries per extracted search term


def _lsj_concept_lookup(terms: list[str]) -> list[dict]:
    """Search LSJ + lexicon for English terms; return matched Strong's + semantic snippets."""
    if not terms:
        return []
    conn = db()
    seen: set[str] = set()
    results: list[dict] = []
    try:
        for term in terms[:5]:
            pattern = f"%{term.lower()}%"
            rows = conn.execute(
                """SELECT l.strongs, l.lemma, l.translit, lsj.summary_json, lsj.def_html
                   FROM lexicon l
                   JOIN lsj ON lsj.plain = lower(strip_accents(l.lemma))
                   WHERE lower(lsj.def_html) LIKE ?
                   ORDER BY length(lsj.def_html)
                   LIMIT ?""",
                (pattern, _LSJ_TERM_LIMIT),
            ).fetchall()
            for row in rows:
                if row["strongs"] in seen:
                    continue
                seen.add(row["strongs"])
                semantic = ""
                if row["summary_json"]:
                    try:
                        sj = json.loads(row["summary_json"])
                        semantic = " ".join(
                            s["text"] for s in sj.get("sections", [])
                        )[:300]
                    except Exception:
                        pass
                if not semantic:
                    semantic = re.sub(r"<[^>]+>", " ", row["def_html"] or "")[:300].strip()
                # Fetch dotted variants present in the corpus for this base
                variants = [
                    v["strongs"] for v in conn.execute(
                        "SELECT DISTINCT strongs FROM words WHERE strongs LIKE ? AND strongs != ?",
                        (f"{row['strongs']}.%", row["strongs"]),
                    ).fetchall()
                ]
                results.append({
                    "strongs":         row["strongs"],
                    "lemma":           row["lemma"],
                    "translit":        row["translit"],
                    "semantic":        semantic,
                    "dotted_variants": variants,
                })
    except Exception as e:
        log.warning("LSJ concept lookup failed: %s", e)
    finally:
        conn.close()
    return results


_LSJ_XREF_RE = re.compile(r'\bv\.\s*<i>([^<]+)</i>')

def _is_lsj_stub(def_html: str) -> bool:
    text = re.sub(r'<[^>]+>', '', def_html or '').strip()
    return len(text) <= 150 and bool(_LSJ_XREF_RE.search(def_html or ''))

def _resolve_lsj_xref(conn, def_html: str, columns: str = "key, translit, def_html"):
    """If def_html is a bare cross-reference stub (v. <i>word</i>), fetch the referenced entry."""
    if not def_html:
        return None
    if len(re.sub(r'<[^>]+>', '', def_html).strip()) > 150:
        return None
    m = _LSJ_XREF_RE.search(def_html)
    if not m:
        return None
    # Don't follow if xref points to multiple sub-entries like "(A) and (B)" — ambiguous sense
    after = def_html[m.end():].lstrip()
    if after.startswith('('):
        return None
    ref = m.group(1).strip()
    ref_plain = _strip_accents(ref).lower().replace('-', '')
    row = conn.execute(f"SELECT {columns} FROM lsj WHERE key = ?", (ref,)).fetchone()
    if not row:
        row = conn.execute(
            f"SELECT {columns} FROM lsj WHERE replace(plain,'-','') = ?",
            (ref_plain,),
        ).fetchone()
    return row


def _format_lsj_context(entries: list[dict]) -> str:
    if not entries:
        return ""
    lines = ["LSJ LEXICAL CONTEXT — use these Strong's numbers in SQL WHERE clauses:"]
    for e in entries:
        line = f"  G{e['strongs']} {e['lemma']} ({e['translit']}): {e['semantic']}"
        variants = e.get("dotted_variants", [])
        if variants:
            vlist = ", ".join(f"G{v}" for v in sorted(variants))
            line += f" [corpus dotted variants: {vlist} — use w.strongs='...' to target specifically]"
        lines.append(line)
    return "\n".join(lines)

_SENSE_MARKER_RE = re.compile(r'^([IVX]+\.|[A-E]\.|[1-9][0-9]*\.|[a-e]\.)$')


class _SectionParser(HTMLParser):
    """Split LSJ def_html into major sense sections by bold markers."""
    def __init__(self):
        super().__init__()
        self._bold = False
        self._bold_buf: list[str] = []
        self._cur_marker: str | None = None
        self._cur_text: list[str] = []
        self._sections: list[tuple[str | None, str]] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("b", "strong"):
            self._bold = True
            self._bold_buf = []

    def handle_endtag(self, tag):
        if tag in ("b", "strong") and self._bold:
            self._bold = False
            marker = "".join(self._bold_buf).strip()
            if _SENSE_MARKER_RE.match(marker):
                text = "".join(self._cur_text).strip()
                if text:
                    self._sections.append((self._cur_marker, text))
                self._cur_marker = marker
                self._cur_text = []
            else:
                self._cur_text.append(marker)

    def handle_data(self, data):
        if self._bold:
            self._bold_buf.append(data)
        else:
            self._cur_text.append(data)

    def get_sections(self) -> list[tuple[str | None, str]]:
        text = "".join(self._cur_text).strip()
        if text:
            self._sections.append((self._cur_marker, text))
        return self._sections


@bp.route("/api/lsj/<path:lemma>")
def lsj_lookup(lemma):
    strongs_param = request.args.get("strongs", "")
    conn = db()
    try:
        if "." in strongs_param:
            snum = strongs_param.lstrip("Gg")
            try:
                abp_row = conn.execute(
                    "SELECT def_html FROM abp_ext WHERE trim(strongs) = ? OR trim(strongs) = ?",
                    (snum, "G" + snum),
                ).fetchone()
            except Exception as e:
                log.warning("abp_ext lookup failed: %s", e)
                abp_row = None
        else:
            snum = strongs_param
            abp_row = None
        plain = _strip_accents(lemma).lower().replace('-', '')
        row = conn.execute(
            "SELECT key, translit, def_html FROM lsj WHERE key = ?", (lemma,)
        ).fetchone()
        if not row and plain:
            row = conn.execute(
                "SELECT key, translit, def_html FROM lsj"
                " WHERE lower(strip_accents(replace(key,'-',''))) = ?"
                "   AND key NOT LIKE '-%'", (plain,)        # don't match suffix headwords (-σε, -θεν…)
            ).fetchone()
        if row and not abp_row:
            xref = _resolve_lsj_xref(conn, row["def_html"])
            if xref:
                row = xref
            elif _is_lsj_stub(row["def_html"]):
                row = None
        lex_row = None
        if not row and not abp_row:
            lex_row = conn.execute(
                "SELECT strongs_def, translit FROM lexicon WHERE lemma = ?", (lemma,)
            ).fetchone()
            if not lex_row and snum:
                lex_row = conn.execute(
                    "SELECT strongs_def, translit FROM lexicon WHERE strongs = ?",
                    (snum.lstrip("Gg"),),
                ).fetchone()
    finally:
        conn.close()
    def _trim_br(html):
        import re as _re
        return _re.sub(r'(\s*<br\s*/?>\s*)+$', '', html or '', flags=_re.IGNORECASE)

    if abp_row:
        return jsonify({
            "key":      snum,
            "translit": "",
            "def_html": _trim_br(abp_row["def_html"]),
            "source":   "abp_ext",
        })
    if lex_row and lex_row["strongs_def"]:
        return jsonify({
            "key":      lemma,
            "translit": lex_row["translit"] or "",
            "def_html": f"<p>{lex_row['strongs_def']}</p>",
            "source":   "strongs",
        })
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify({
        "key":      row["key"],
        "translit": row["translit"],
        "def_html": _trim_br(row["def_html"]),
    })


@bp.route("/api/lsj-summary/<path:lemma>")
@limiter.limit("200 per hour")
def lsj_summary(lemma):
    strongs_param = request.args.get("strongs", "")
    book    = request.args.get("book", "").strip()
    chapter = request.args.get("chapter", "").strip()
    verse_n = request.args.get("verse", "").strip()
    has_ctx = bool(book and chapter and verse_n)

    base_key = f"abp:{strongs_param}" if ("." in strongs_param) else lemma
    mem_key  = (f"ctx:{base_key}:{book}.{chapter}.{verse_n}"
                if has_ctx else f"gen:{base_key}")

    if mem_key in _lsj_summary_cache:
        return jsonify(_lsj_summary_cache[mem_key])
    if not _anthropic:
        return jsonify({"error": "AI unavailable"}), 503

    conn = db()
    exact_key = None
    abp_strongs = None
    row = None
    try:
        if "." in strongs_param:
            snum = strongs_param.lstrip("Gg")
            try:
                abp_row = conn.execute(
                    "SELECT def_html, summary_json FROM abp_ext WHERE trim(strongs) = ? OR trim(strongs) = ?",
                    (snum, "G" + snum),
                ).fetchone()
            except Exception as e:
                log.warning("abp_ext summary lookup failed: %s", e)
                abp_row = None
            if abp_row:
                row = {"def_html": abp_row["def_html"], "summary_json": abp_row["summary_json"]}
                abp_strongs = snum
            else:
                row = None
        else:
            plain = _strip_accents(lemma).lower().replace('-', '')
            row = conn.execute(
                "SELECT key, def_html, summary_json FROM lsj WHERE key = ?", (lemma,)
            ).fetchone()
            if not row and plain:
                row = conn.execute(
                    "SELECT key, def_html, summary_json FROM lsj"
                    " WHERE lower(strip_accents(replace(key,'-',''))) = ?"
                    "   AND key NOT LIKE '-%'", (plain,)     # don't match suffix headwords (-σε, -θεν…)
                ).fetchone()
            if row:
                xref = _resolve_lsj_xref(conn, row["def_html"], "key, def_html, summary_json")
                if xref:
                    row = xref
                elif _is_lsj_stub(row["def_html"]):
                    row = None
            if row:
                exact_key = row["key"]
    finally:
        conn.close()
    if not row:
        return jsonify({"error": "not found"}), 404

    # Parse existing summary_json — may contain sections, general, context
    sj: dict = {}
    if row["summary_json"]:
        try:
            sj = json.loads(row["summary_json"])
        except Exception:
            sj = {}

    # Check DB cache for the requested synthesis type
    ctx_db_key = f"{book}.{chapter}.{verse_n}"
    if has_ctx and sj.get("context", {}).get(ctx_db_key):
        payload = {"summary": sj["context"][ctx_db_key], "contextual": True}
        return jsonify(_cache_lsj_summary(mem_key, payload))
    if not has_ctx and sj.get("general"):
        payload = {"summary": sj["general"], "contextual": False}
        return jsonify(_cache_lsj_summary(mem_key, payload))

    # Fetch verse text for contextual summary
    plain_def = re.sub(r"<[^>]+>", " ", row["def_html"] or "").strip()
    actual_ctx = has_ctx
    verse_text = ""
    if has_ctx:
        try:
            vconn = db_ro()
            try:
                vrow = vconn.execute(
                    "SELECT text FROM verses WHERE book=? AND chapter=? AND verse=?",
                    (book, int(chapter), int(verse_n)),
                ).fetchone()
                if vrow:
                    verse_text = vrow["text"]
            finally:
                vconn.close()
        except Exception:
            pass
        if not verse_text:
            actual_ctx = False  # fall back to general if verse not found

    if actual_ctx:
        user_content = (
            f"Verse: {book} {chapter}:{verse_n} — {verse_text}\n\n"
            f"LSJ entry for {lemma}:\n{plain_def[:2000]}\n\n"
            "Identify the sense of this word active in the verse above and explain it in plain prose. "
            "2-3 sentences, 60 words max. Let the entry dictate the length — do not pad. "
            "No markdown, no headers, no bullet points."
        )
    else:
        user_content = (
            f"LSJ entry for {lemma}:\n{plain_def[:2000]}\n\n"
            "Summarize the primary meaning of this word and its main range of uses. "
            "2-3 sentences, 60 words max. Let the entry dictate the length — do not pad. "
            "No markdown, no headers, no bullet points."
        )

    try:
        synth_msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            temperature=0,
            system=_LSJ_SYNTHESIS_SYSTEM,
            messages=[{"role": "user", "content": user_content}],
        )
        synthesis = synth_msg.content[0].text.strip()
    except Exception as exc:
        log.warning("LSJ synthesis failed: %s", exc)
        return jsonify({"error": "synthesis failed"}), 500

    # Store synthesis back into summary_json alongside sections
    if actual_ctx:
        sj.setdefault("context", {})[ctx_db_key] = synthesis
    else:
        sj["general"] = synthesis

    conn = db()
    try:
        sj_str = json.dumps(sj, ensure_ascii=False)
        if exact_key:
            conn.execute("UPDATE lsj SET summary_json = ? WHERE key = ?", (sj_str, exact_key))
        elif abp_strongs:
            conn.execute(
                "UPDATE abp_ext SET summary_json = ? WHERE trim(strongs) = ? OR trim(strongs) = ?",
                (sj_str, abp_strongs, "G" + abp_strongs),
            )
        conn.commit()
    finally:
        conn.close()

    payload = {"summary": synthesis, "contextual": actual_ctx}
    return jsonify(_cache_lsj_summary(mem_key, payload))


@bp.route("/api/bdb/<path:strongs_id>")
def bdb_lookup(strongs_id):
    conn = db_ro()
    try:
        row = conn.execute(
            "SELECT strongs_id, lemma, xlit, pronounce, description, part_of_speech FROM bdb WHERE strongs_id = ?",
            (strongs_id.upper(),)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify({
        "strongs_id":     row["strongs_id"],
        "lemma":          row["lemma"] or "",
        "xlit":           row["xlit"] or "",
        "pronounce":      row["pronounce"] or "",
        "description":    row["description"] or "",
        "part_of_speech": row["part_of_speech"] or "",
    })
