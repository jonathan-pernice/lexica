#!/usr/bin/env python3
"""Library reading-pane summaries (book blurb + pericope-aware chapter summary).

Powers the right panel's DEFAULT content in the Library: when no word or verse is
selected, the reader sees a short Berean orientation to the book plus a few
sentences on the chapter they're on. Haiku-backed, anchored in the actual English
text (ABP `verses.text`, or a non-canonical text's `<book>_verses.english`).

Both halves are cached independently in ai_search_cache:
  - book blurb     →  query="summary_book:<book>"
  - chapter summary→  query="summary_ch:<book>:<chapter>"
with ver_key="summary" so a code-version cache bump preserves them (same treatment
as the 'xref' caches). Endpoint is rate-limited like the other paid AI routes.
"""
import json
import re
import time

from flask import Blueprint, jsonify

from core import db, db_ro, _anthropic, limiter, log, _ai_cache

bp = Blueprint("summary", __name__)

_BOOK_RE = re.compile(r"^[A-Za-z0-9_]+$")      # route guard: canonical abbrevs are mixed-case (Gen, Joh)
_EXTRA_BOOK_RE = re.compile(r"^[a-z0-9_]+$")   # stricter: table-name safe, used only when building <book>_verses


_SUMMARY_SYSTEM = """\
You are a textual scholar working from a Berean approach: the text speaks first. \
Let the actual words of the passage anchor everything you write. Import no \
systematic theology, no denominational framework, and no doctrinal assumptions \
from outside the text itself — follow where the words lead. You may note plain \
eschatological themes when the text itself raises them, but do not impose them. \
Never invent events or claims the text does not contain. Never mention any app, \
database, data source, or translation by name. Do not begin with a label, heading, \
or prefix of any kind — start directly with the first sentence. Write in plain, \
direct, readable language — not academic jargon. Each sentence must be one complete \
thought.\
"""


def _haiku(system: str, user: str, max_tokens: int) -> str | None:
    """One Haiku call; returns clean text or None on any failure."""
    try:
        msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=max_tokens,
            temperature=0,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return re.sub(r"^#+\s*[^:\n]*:\s*", "", msg.content[0].text.strip())
    except Exception as exc:
        log.warning("Summary Haiku call failed: %s", exc)
        return None


def _cache_get(cache_key: str):
    """In-memory first, then the DB cache table. Returns payload dict or None."""
    if cache_key in _ai_cache:
        return _ai_cache[cache_key]
    conn = db_ro()
    try:
        row = conn.execute(
            "SELECT result_json FROM ai_search_cache WHERE query=?", (cache_key,)
        ).fetchone()
    finally:
        conn.close()
    if row:
        try:
            payload = json.loads(row["result_json"])
            _ai_cache[cache_key] = payload
            return payload
        except Exception:
            return None
    return None


def _cache_put(cache_key: str, payload: dict) -> None:
    conn = db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO ai_search_cache"
            " (query, result_json, ver_key, created_at) VALUES (?,?,?,?)",
            (cache_key, json.dumps(payload), "summary", time.time()),
        )
        conn.commit()
    finally:
        conn.close()
    _ai_cache[cache_key] = payload


def _is_extra(conn, book: str) -> bool:
    if not _EXTRA_BOOK_RE.match(book):
        return False
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (f"{book}_verses",),
    ).fetchone() is not None


def _book_full_name(conn, book: str) -> str:
    row = conn.execute("SELECT name FROM books WHERE abbrev=?", (book,)).fetchone()
    if row and row["name"]:
        return row["name"]
    # Non-canonical / unknown: derive something readable from the table name.
    return book.replace("_", " ").title()


def _chapter_block(conn, book: str, chapter: int, extra: bool) -> str | None:
    """The chapter's English text with section headings marked inline, or None
    if the chapter has no text."""
    if extra:
        vtable = f"{book}_verses"
        has_heading = any(
            c["name"] == "heading" for c in conn.execute(f"PRAGMA table_info({vtable})")
        )
        hsel = ", heading" if has_heading else ""
        rows = conn.execute(
            f"SELECT verse, english{hsel} FROM {vtable} WHERE chapter=? ORDER BY verse",
            (chapter,),
        ).fetchall()
        get_text = lambda r: r["english"]
        get_head = (lambda r: r["heading"]) if has_heading else (lambda r: None)
    else:
        rows = conn.execute(
            """SELECT v.verse, v.text AS prose, p.heading
               FROM verses v
               LEFT JOIN pericopes p
                 ON p.book = v.book AND p.chapter = v.chapter AND p.verse = v.verse
               WHERE v.book=? AND v.chapter=? ORDER BY v.verse""",
            (book, chapter),
        ).fetchall()
        get_text = lambda r: r["prose"]
        get_head = lambda r: r["heading"]

    parts: list[str] = []
    for r in rows:
        head = get_head(r)
        if head:
            parts.append(f"\n[Section: {head}]")
        txt = (get_text(r) or "").strip()
        if txt:
            parts.append(f"{r['verse']}. {txt}")
    block = "\n".join(parts).strip()
    return block or None


def _opening_block(conn, book: str, extra: bool, limit: int = 30) -> str | None:
    """First chapter's text (capped), used to anchor the book-level blurb."""
    if extra:
        vtable = f"{book}_verses"
        rows = conn.execute(
            f"SELECT english AS t FROM {vtable} WHERE chapter=1 ORDER BY verse LIMIT ?",
            (limit,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT text AS t FROM verses WHERE book=? AND chapter=1 ORDER BY verse LIMIT ?",
            (book, limit),
        ).fetchall()
    block = " ".join((r["t"] or "").strip() for r in rows if (r["t"] or "").strip())
    return block or None


@bp.route("/api/summary/<book>/<int:chapter>")
@limiter.limit("200 per hour")
def reading_summary(book, chapter):
    if not _BOOK_RE.match(book):
        return jsonify({"book_summary": None, "chapter_summary": None})
    if not _anthropic:
        return jsonify({"book_summary": None, "chapter_summary": None})

    book_key = f"summary_book:{book}"
    chap_key = f"summary_ch:{book}:{chapter}"

    book_payload = _cache_get(book_key)
    chap_payload = _cache_get(chap_key)
    if book_payload is not None and chap_payload is not None:
        return jsonify({
            "book_summary": book_payload.get("text"),
            "chapter_summary": chap_payload.get("text"),
        })

    conn = db_ro()
    try:
        extra = _is_extra(conn, book)
        name = _book_full_name(conn, book)
        opening = None if book_payload is not None else _opening_block(conn, book, extra)
        chap_block = None if chap_payload is not None else _chapter_block(conn, book, chapter, extra)
    finally:
        conn.close()

    # Book blurb — generate if not already cached.
    if book_payload is None:
        if opening:
            text = _haiku(
                _SUMMARY_SYSTEM,
                f'Below is the opening of the book "{name}". In 1 to 2 sentences, '
                f'orient a reader to what this book is and its overall concern, '
                f'staying anchored to what the text plainly is. Do not retell the '
                f'opening verses.\n\nOpening text:\n{opening}',
                max_tokens=160,
            )
        else:
            text = None
        book_payload = {"text": text}
        if text:
            _cache_put(book_key, book_payload)

    # Chapter summary — pericope-aware, generate if not already cached.
    if chap_payload is None:
        if chap_block:
            text = _haiku(
                _SUMMARY_SYSTEM,
                f'Below is one chapter of "{name}". The lines marked '
                f'"[Section: ...]" are the natural section breaks in this chapter — '
                f'let your summary follow those sections in order rather than fighting '
                f'the chapter boundary. Write 3 to 4 sentences summarizing what '
                f'happens in this chapter, anchored in the text.\n\n{chap_block}',
                max_tokens=320,
            )
        else:
            text = None
        chap_payload = {"text": text}
        if text:
            _cache_put(chap_key, chap_payload)

    return jsonify({
        "book_summary": book_payload.get("text"),
        "chapter_summary": chap_payload.get("text"),
    })
