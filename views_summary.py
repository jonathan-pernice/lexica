#!/usr/bin/env python3
"""Library reading-pane summaries (book blurb + pericope-aware chapter summary).

Powers the right panel's DEFAULT content in the Library: when no word or verse is
selected, the reader sees a short Berean orientation to the book plus a few
sentences on the chapter they're on. Haiku-backed, anchored in the actual English
text (ABP `verses.text`, or a non-canonical text's `<book>_verses.english`).

Both halves are cached independently in ai_search_cache:
  - book blurb     →  query="summary_book:<book>"
  - chapter summary→  query="summary_ch:<book>:<chapter>"
The ver_key is the unified prompt fingerprint (core.ai_fingerprint): a shared hash
of the system + user prompt templates, with a per-book author suffix. So editing the
prompt wording auto-refreshes every summary, while editing one book's author in
_BOOK_AUTHORS refreshes only that book (its blurb + its chapter summaries). No manual
version bump. Endpoint is rate-limited like the other paid AI routes.
"""
import hashlib
import re

from flask import Blueprint, jsonify

from core import (
    db_ro, _anthropic, limiter, log, _ai_cache,
    ai_fingerprint, ai_cache_get, ai_cache_put, ai_cache_prune,
    _KJV_BOOK_ID_REV,
)

bp = Blueprint("summary", __name__)

_BOOK_RE = re.compile(r"^[A-Za-z0-9_]+$")      # route guard: canonical abbrevs are mixed-case (Gen, Joh)
_EXTRA_BOOK_RE = re.compile(r"^[a-z0-9_]+$")   # stricter: table-name safe, used only when building <book>_verses

# Model per summary kind. The book blurb is tiny + bounded (1-2 sentences, fed only the
# opening) so Haiku keeps it tight. The chapter summary runs on Sonnet: it honors the
# length cap, while Haiku overruns (and gets truncated) on huge chapters like the
# Sibylline Oracles. _CHAP_MODEL is part of the cache fingerprint below, so swapping it
# refreshes cached chapter summaries.
_HAIKU_MODEL = "claude-haiku-4-5-20251001"
_CHAP_MODEL = "claude-sonnet-4-6"

# Our hand-curated author per book, fed to the model so it names the writer instead
# of hedging ("an apostolic witness…"). This list WINS over metaV — it keeps the better
# wording ("David and other psalmists", "the apostle John") and the scribe notes. Any
# book left blank here is filled from metaV's Writers table with the traditional
# attribution (Judges/Ruth/Samuel→Samuel, Kings→Jeremiah, Chronicles→Ezra, Job→Moses,
# Esther→Mordecai); see _metav_writers / _resolve_author below. Hebrews is anonymous in
# both (metaV marks it "Unknown") so it gets no author line.
_BOOK_AUTHORS = {
    "Gen": "Moses", "Exo": "Moses", "Lev": "Moses", "Num": "Moses", "Deu": "Moses",
    "Jos": "Joshua", "Ezr": "Ezra", "Neh": "Nehemiah",
    "Psa": "David and other psalmists", "Pro": "Solomon", "Ecc": "Solomon", "Son": "Solomon",
    "Isa": "Isaiah", "Jer": "Jeremiah, who dictated to his scribe Baruch",
    "Lam": "Jeremiah", "Eze": "Ezekiel", "Dan": "Daniel",
    "Hos": "Hosea", "Joe": "Joel", "Amo": "Amos", "Oba": "Obadiah", "Jon": "Jonah",
    "Mic": "Micah", "Nah": "Nahum", "Hab": "Habakkuk", "Zep": "Zephaniah",
    "Hag": "Haggai", "Zec": "Zechariah", "Mal": "Malachi",
    "Mat": "Matthew", "Mar": "Mark", "Luk": "Luke", "Joh": "the apostle John",
    "Act": "Luke", "Rom": "Paul, written down by his scribe Tertius",
    "1Co": "Paul", "2Co": "Paul", "Gal": "Paul",
    "Eph": "Paul", "Php": "Paul", "Col": "Paul", "1Th": "Paul", "2Th": "Paul",
    "1Ti": "Paul", "2Ti": "Paul", "Tit": "Paul", "Phm": "Paul",
    "Jas": "James", "1Pe": "Peter", "2Pe": "Peter",
    "1Jn": "the apostle John", "2Jn": "the apostle John", "3Jn": "the apostle John",
    "Jud": "Jude", "Rev": "the apostle John",
}

# metaV's Writers table (bible.db) fills the books _BOOK_AUTHORS leaves blank with the
# traditional attribution. Read once, lazily, and cached; if the table is missing or
# empty we just fall back to the hand list (no author line for the blanks). metaV's
# book_id is the standard Protestant 1-66, mapped to our abbrev via _KJV_BOOK_ID_REV.
_metav_writers_cache: dict | None = None


def _metav_writers() -> dict:
    """metaV's Writers table → {abbrev: writer}. Skips its "Unknown" rows (Hebrews).
    Loaded once; safe-empty on any read error so a missing table never breaks summaries."""
    global _metav_writers_cache
    if _metav_writers_cache is not None:
        return _metav_writers_cache
    out: dict[str, str] = {}
    try:
        conn = db_ro()
        try:
            for r in conn.execute("SELECT book_id, writer FROM metav_writers"):
                abbrev = _KJV_BOOK_ID_REV.get(r["book_id"])
                writer = (r["writer"] or "").strip()
                if abbrev and writer and writer.lower() != "unknown":
                    out[abbrev] = writer
        finally:
            conn.close()
    except Exception as exc:
        log.warning("metav_writers read failed (using hand list only): %s", exc)
    _metav_writers_cache = out
    return out


def _resolve_author(book: str) -> str | None:
    """Our curated name wins (better wording + scribe notes); metaV fills the blanks
    with the traditional attribution. None when neither has one (e.g. Hebrews)."""
    return _BOOK_AUTHORS.get(book) or _metav_writers().get(book)


_SUMMARY_SYSTEM = """\
You are a textual scholar working from a Berean approach: the text speaks first. \
Let the actual words of the passage anchor everything you write. Import no \
systematic theology, no denominational framework, and no doctrinal assumptions \
from outside the text itself — follow where the words lead. You may, however, name the traditionally recognized author, \
audience, and historical setting of a book when these are well established (for example, \
that 1 John is the apostle John's letter, or that Romans is Paul writing to the church in \
Rome), even when the passage at hand does not name them — that is ordinary background, not \
imported doctrine. Do not hedge a well-known author as an unnamed "writer." You may note plain \
eschatological themes when the text itself raises them, but do not impose them. \
Never invent events or claims the text does not contain. Never mention any app, \
database, data source, or translation by name. Do not begin with a label, heading, \
or prefix of any kind — start directly with the first sentence. Write in plain, \
direct, readable language — not academic jargon. Each sentence must be one complete \
thought.\
"""

# The user-message skeletons. Kept as named templates (not inline f-strings) so the
# cache fingerprint below covers the instruction wording too — historically the part
# that actually changed (the "don't skip the opening" / "name strange events" tweaks).
_AUTHOR_LINE_TMPL = (
    'The traditionally recognized author of this book is {author} — '
    'name them by name as the writer (do not hedge as "an unnamed writer" or '
    '"an apostolic witness"), even though the text itself may not name them. '
)
_BOOK_PROMPT_TMPL = (
    'Below is the opening of the book "{name}". {author_line}In 1 to 2 '
    'sentences, orient a reader to what this book is, its author and '
    'intended audience, and its overall concern. Do not retell the opening '
    'verses.\n\nOpening text:\n{opening}'
)
_CHAP_PROMPT_TMPL = (
    'Below is one chapter of "{name}". {author_line}The lines marked '
    '"[Section: ...]" are the natural section breaks — use them to track the '
    'chapter\'s arc, but do NOT write a line for every section. Summarize what '
    'happens, anchored in the text, in a single tight paragraph: a short or '
    'simple chapter needs only a sentence or two, and even the longest, most '
    'eventful chapter should stay around 150 words and never exceed roughly 200, '
    'no matter how many sections it has. Do not pad, and do not cram. For a long '
    'chapter, give its overall arc and only the few most significant people, '
    'beings, and events rather than narrating each section; group the rest. Name '
    'those notable people, beings, and events specifically — including any that '
    'are strange or supernatural, reported plainly rather than softened or '
    'omitted. Use plain, short sentences, one idea each; never force several '
    'events into one long run-on. Still open with the chapter\'s beginning — do '
    'not skip it or collapse it into a generic line. When you refer to the '
    "writer, use the author's name.\n\n{chap_block}"
)

# Shared template fingerprint: editing any prompt above changes this, so every
# summary lazily refreshes. Rows carry a per-book author suffix (see _summary_ver),
# so editing one book's author in _BOOK_AUTHORS refreshes only that book.
_SUMMARY_TPL_BASE = ai_fingerprint(
    "summary", _SUMMARY_SYSTEM, _AUTHOR_LINE_TMPL, _BOOK_PROMPT_TMPL, _CHAP_PROMPT_TMPL, _CHAP_MODEL
)


def _summary_ver(book: str) -> str:
    """ver_key for this book's summaries: the shared template hash plus a short hash
    of the book's own author string. The row's query key stays stable, so changing an
    author overwrites that book's row in place rather than orphaning it. Uses the
    resolved author (hand list or metaV), so a metaV fill or a scribe edit refreshes
    only that book's cached summaries."""
    author = _resolve_author(book) or ""
    return f"{_SUMMARY_TPL_BASE}:{hashlib.sha1(author.encode('utf-8')).hexdigest()[:8]}"


def prune_cache() -> int:
    """Startup: drop summary rows from an OLD template version. Per-book author
    changes self-heal via in-place overwrite, so the keeper is the template prefix."""
    return ai_cache_prune("summary", _SUMMARY_TPL_BASE)


def _summarize(system: str, user: str, max_tokens: int,
               model: str = _HAIKU_MODEL) -> str | None:
    """One summary call; returns clean text or None on any failure. Defaults to Haiku
    (the book blurb); the chapter summary passes Sonnet, which holds the length cap that
    Haiku overruns on huge chapters."""
    try:
        msg = _anthropic.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=0,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return re.sub(r"^#+\s*[^:\n]*:\s*", "", msg.content[0].text.strip())
    except Exception as exc:
        log.warning("Summary AI call failed: %s", exc)
        return None


def _cache_get(cache_key: str, ver_key: str):
    """In-memory first, then the DB cache table (matched on ver_key, so an entry from
    an older prompt misses and regenerates). Returns payload dict or None."""
    if cache_key in _ai_cache:
        return _ai_cache[cache_key]
    payload = ai_cache_get(cache_key, ver_key)
    if payload is not None:
        _ai_cache[cache_key] = payload
    return payload


def _cache_put(cache_key: str, payload: dict, ver_key: str) -> None:
    ai_cache_put(cache_key, payload, ver_key)
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

    ver = _summary_ver(book)
    book_key = f"summary_book:{book}"
    chap_key = f"summary_ch:{book}:{chapter}"

    book_payload = _cache_get(book_key, ver)
    chap_payload = _cache_get(chap_key, ver)
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

    author = _resolve_author(book)
    author_line = _AUTHOR_LINE_TMPL.format(author=author) if author else ""

    # Book blurb — generate if not already cached.
    if book_payload is None:
        if opening:
            text = _summarize(
                _SUMMARY_SYSTEM,
                _BOOK_PROMPT_TMPL.format(name=name, author_line=author_line, opening=opening),
                max_tokens=160,
            )
        else:
            text = None
        book_payload = {"text": text}
        if text:
            _cache_put(book_key, book_payload, ver)

    # Chapter summary — pericope-aware, generate if not already cached.
    if chap_payload is None:
        if chap_block:
            text = _summarize(
                _SUMMARY_SYSTEM,
                _CHAP_PROMPT_TMPL.format(name=name, author_line=author_line, chap_block=chap_block),
                max_tokens=480,   # headroom; Sonnet keeps it to ~150-200 words
                model=_CHAP_MODEL,
            )
        else:
            text = None
        chap_payload = {"text": text}
        if text:
            _cache_put(chap_key, chap_payload, ver)

    return jsonify({
        "book_summary": book_payload.get("text"),
        "chapter_summary": chap_payload.get("text"),
    })
