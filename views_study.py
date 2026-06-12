#!/usr/bin/env python3
"""Study modules — admin-authored study content (the "engine").

One shared shape powers three views (a study TOPIC, a DENOMINATION's belief, one
side of an ARGUMENT). Every entry is the same thing: a position, the verses that
support it, the verses that sit in tension with it, a resolution (the middle road
the text points to, OR plainly marked an open mystery), private notes, and links
to related entries. Build the entry once here; the reader views render it.

Storage: study.db (core.study_db), kept OUT of bible.db (the corpus is rebuilt;
authored content must survive that) and OUT of git (*.db is gitignored), exactly
like notes.db. One row per entry.

Gating: every route is ADMIN-ONLY for now (the owner authors content). Reading may
open to the public later — that's a deliberate, separate decision (these modules
take positions, unlike the rest of the Berean app). Non-admins get a 404, same as
the admin user-management routes in views_notes.

Verses are stored as plain REFERENCES only ("Romans 10:17"); the KJV text is
resolved live from bible.db on read and for the editor's auto-fill, so a long verse
list costs a few keystrokes and the text never drifts from the corpus.

Endpoints (all admin-only):
  GET  /api/study/entries?type=        -> {entries:[{id,type,title,heldBy,status,updated}]}
  GET  /api/study/entry/<id>           -> full entry (verses resolved to text)
  POST /api/study/entry                -> create/update (mints id if absent) -> {id}
  POST /api/study/entry/<id>/delete    -> soft delete -> {ok}
  GET  /api/study/verse?ref=Rom+10:17  -> {ref, verses:[{ref,text}]}  (auto-fill)
"""
import json
import re
import secrets
import time

from flask import Blueprint, jsonify, request

from core import study_db, db_ro, limiter, _KJV_BOOK_ID, _KJV_BOOK_ID_REV
from views_notes import is_admin

bp = Blueprint("study", __name__)

_TYPES = ("topic", "denomination", "argument")
_RES_MODES = ("middle", "mystery")
_MAX_ENTRY_BYTES = 200_000     # one whole entry's JSON (long notes + many refs)
_MAX_VERSES = 300              # support/tension refs per bucket
_MAX_RANGE = 60                # verses a single reference range may expand to


def _ensure_tables():
    conn = study_db()
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS entries ("
            " id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,"
            " json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',"
            " created TEXT NOT NULL, updated TEXT NOT NULL,"
            " deleted INTEGER NOT NULL DEFAULT 0)"
        )
        conn.commit()
    finally:
        conn.close()


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ── Reference parsing ────────────────────────────────────────────────────────
# Map every reasonable spelling of a book to the app's 3-char abbreviation (the
# keys of core._KJV_BOOK_ID), plus a clean display name. The leading-number books
# (1/2/3 Samuel…) carry their digit and roman/word forms as aliases.
_BOOKS = [
    ("Gen", "Genesis", ["genesis", "gen", "ge", "gn"]),
    ("Exo", "Exodus", ["exodus", "exo", "exod", "ex"]),
    ("Lev", "Leviticus", ["leviticus", "lev", "lv"]),
    ("Num", "Numbers", ["numbers", "num", "nm", "nu"]),
    ("Deu", "Deuteronomy", ["deuteronomy", "deut", "deu", "dt"]),
    ("Jos", "Joshua", ["joshua", "josh", "jos", "jsh"]),
    ("Jdg", "Judges", ["judges", "judg", "jdg", "jg"]),
    ("Rth", "Ruth", ["ruth", "rth", "ru"]),
    ("1Sa", "1 Samuel", ["1 samuel", "1samuel", "1 sam", "1sam", "1sa", "i samuel", "first samuel"]),
    ("2Sa", "2 Samuel", ["2 samuel", "2samuel", "2 sam", "2sam", "2sa", "ii samuel", "second samuel"]),
    ("1Ki", "1 Kings", ["1 kings", "1kings", "1 kgs", "1kgs", "1ki", "i kings", "first kings"]),
    ("2Ki", "2 Kings", ["2 kings", "2kings", "2 kgs", "2kgs", "2ki", "ii kings", "second kings"]),
    ("1Ch", "1 Chronicles", ["1 chronicles", "1chronicles", "1 chron", "1chron", "1 chr", "1chr", "1ch", "i chronicles"]),
    ("2Ch", "2 Chronicles", ["2 chronicles", "2chronicles", "2 chron", "2chron", "2 chr", "2chr", "2ch", "ii chronicles"]),
    ("Ezr", "Ezra", ["ezra", "ezr"]),
    ("Neh", "Nehemiah", ["nehemiah", "neh", "ne"]),
    ("Est", "Esther", ["esther", "esth", "est"]),
    ("Job", "Job", ["job", "jb"]),
    ("Psa", "Psalms", ["psalms", "psalm", "psa", "ps", "pss"]),
    ("Pro", "Proverbs", ["proverbs", "prov", "pro", "prv", "pr"]),
    ("Ecc", "Ecclesiastes", ["ecclesiastes", "eccl", "ecc", "ec", "qoh"]),
    ("Son", "Song of Solomon", ["song of solomon", "song of songs", "song", "songs", "sos", "son", "canticles", "cant"]),
    ("Isa", "Isaiah", ["isaiah", "isa", "is"]),
    ("Jer", "Jeremiah", ["jeremiah", "jer", "je"]),
    ("Lam", "Lamentations", ["lamentations", "lam", "la"]),
    ("Eze", "Ezekiel", ["ezekiel", "ezek", "eze", "ezk"]),
    ("Dan", "Daniel", ["daniel", "dan", "dn"]),
    ("Hos", "Hosea", ["hosea", "hos", "ho"]),
    ("Joe", "Joel", ["joel", "joe", "jl"]),
    ("Amo", "Amos", ["amos", "amo", "am"]),
    ("Oba", "Obadiah", ["obadiah", "obad", "oba", "ob"]),
    ("Jon", "Jonah", ["jonah", "jon", "jnh"]),
    ("Mic", "Micah", ["micah", "mic", "mc"]),
    ("Nah", "Nahum", ["nahum", "nah", "na"]),
    ("Hab", "Habakkuk", ["habakkuk", "hab", "hb"]),
    ("Zep", "Zephaniah", ["zephaniah", "zeph", "zep", "zp"]),
    ("Hag", "Haggai", ["haggai", "hag", "hg"]),
    ("Zec", "Zechariah", ["zechariah", "zech", "zec", "zc"]),
    ("Mal", "Malachi", ["malachi", "mal", "ml"]),
    ("Mat", "Matthew", ["matthew", "matt", "mat", "mt"]),
    ("Mar", "Mark", ["mark", "mar", "mrk", "mk"]),
    ("Luk", "Luke", ["luke", "luk", "lk"]),
    ("Joh", "John", ["john", "joh", "jhn", "jn"]),
    ("Act", "Acts", ["acts", "act", "ac"]),
    ("Rom", "Romans", ["romans", "rom", "ro", "rm"]),
    ("1Co", "1 Corinthians", ["1 corinthians", "1corinthians", "1 cor", "1cor", "1co", "i corinthians", "first corinthians"]),
    ("2Co", "2 Corinthians", ["2 corinthians", "2corinthians", "2 cor", "2cor", "2co", "ii corinthians", "second corinthians"]),
    ("Gal", "Galatians", ["galatians", "gal", "ga"]),
    ("Eph", "Ephesians", ["ephesians", "eph", "ephes"]),
    ("Php", "Philippians", ["philippians", "phil", "php", "philip", "pp"]),
    ("Col", "Colossians", ["colossians", "col", "cl"]),
    ("1Th", "1 Thessalonians", ["1 thessalonians", "1thessalonians", "1 thess", "1thess", "1 th", "1th", "i thessalonians"]),
    ("2Th", "2 Thessalonians", ["2 thessalonians", "2thessalonians", "2 thess", "2thess", "2 th", "2th", "ii thessalonians"]),
    ("1Ti", "1 Timothy", ["1 timothy", "1timothy", "1 tim", "1tim", "1ti", "i timothy", "first timothy"]),
    ("2Ti", "2 Timothy", ["2 timothy", "2timothy", "2 tim", "2tim", "2ti", "ii timothy", "second timothy"]),
    ("Tit", "Titus", ["titus", "tit", "ti"]),
    ("Phm", "Philemon", ["philemon", "philem", "phm", "phlm", "pm"]),
    ("Heb", "Hebrews", ["hebrews", "heb", "hbr"]),
    ("Jas", "James", ["james", "jas", "jam", "jm"]),
    ("1Pe", "1 Peter", ["1 peter", "1peter", "1 pet", "1pet", "1pe", "i peter", "first peter"]),
    ("2Pe", "2 Peter", ["2 peter", "2peter", "2 pet", "2pet", "2pe", "ii peter", "second peter"]),
    ("1Jn", "1 John", ["1 john", "1john", "1 jn", "1jn", "1jo", "i john", "first john"]),
    ("2Jn", "2 John", ["2 john", "2john", "2 jn", "2jn", "2jo", "ii john", "second john"]),
    ("3Jn", "3 John", ["3 john", "3john", "3 jn", "3jn", "3jo", "iii john", "third john"]),
    ("Jud", "Jude", ["jude", "jud", "jd"]),
    ("Rev", "Revelation", ["revelation", "revelations", "rev", "rv", "apocalypse"]),
]
_BOOK_DISPLAY = {abbr: disp for abbr, disp, _ in _BOOKS}


def _norm_book(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace(".", " ")).strip().lower()


# alias (spaced + de-spaced) -> abbrev
_BOOK_LOOKUP: dict[str, str] = {}
for _abbr, _disp, _aliases in _BOOKS:
    for _a in _aliases:
        n = _norm_book(_a)
        _BOOK_LOOKUP.setdefault(n, _abbr)
        _BOOK_LOOKUP.setdefault(n.replace(" ", ""), _abbr)

_REF_RE = re.compile(
    r"^\s*([1-3]?\s*[A-Za-z][A-Za-z. ]*?)\s*"   # book (optional leading 1-3)
    r"(\d+):(\d+)"                                # chapter:verse
    r"(?:\s*[-–—]\s*(\d+)(?::(\d+))?)?" # optional -end  or  -endCh:endVerse
    r"\s*$"
)


def _parse_ref(ref: str):
    """'Romans 10:17' / 'Eph 2:8-9' / 'John 3:16-4:2' -> (book_id, start_ch,
    start_v, end_ch, end_v) or None. A bare end number is an end-VERSE in the same
    chapter; 'end:v' is a cross-chapter end."""
    if not ref or not isinstance(ref, str):
        return None
    m = _REF_RE.match(ref.strip())
    if not m:
        return None
    book_raw, ch, v, e1, e2 = m.groups()
    abbr = _BOOK_LOOKUP.get(_norm_book(book_raw)) or _BOOK_LOOKUP.get(_norm_book(book_raw).replace(" ", ""))
    if not abbr:
        return None
    book_id = _KJV_BOOK_ID.get(abbr)
    if book_id is None:
        return None
    start_ch, start_v = int(ch), int(v)
    if e1 is None:                       # single verse
        end_ch, end_v = start_ch, start_v
    elif e2 is None:                     # same-chapter range (8-9)
        end_ch, end_v = start_ch, int(e1)
    else:                                # cross-chapter range (3:16-4:2)
        end_ch, end_v = int(e1), int(e2)
    return book_id, start_ch, start_v, end_ch, end_v


def _resolve_ref(ref: str):
    """Resolve a reference to a list of {ref, text} from KJV (public-domain, all 66
    books). Returns [] if the reference can't be parsed or isn't found."""
    parsed = _parse_ref(ref)
    if not parsed:
        return []
    book_id, sc, sv, ec, ev = parsed
    conn = db_ro()
    try:
        start = conn.execute(
            "SELECT verse_id FROM kjv_verses WHERE book_id=? AND chapter=? AND verse_num=?",
            (book_id, sc, sv),
        ).fetchone()
        end = conn.execute(
            "SELECT verse_id FROM kjv_verses WHERE book_id=? AND chapter=? AND verse_num=?",
            (book_id, ec, ev),
        ).fetchone()
        if not start:
            return []
        start_id = start["verse_id"]
        end_id = end["verse_id"] if end else start_id
        if end_id < start_id:
            end_id = start_id
        if end_id - start_id + 1 > _MAX_RANGE:
            end_id = start_id + _MAX_RANGE - 1
        rows = conn.execute(
            "SELECT book_id, chapter, verse_num, verse_text FROM kjv_verses"
            " WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id",
            (start_id, end_id),
        ).fetchall()
    except Exception:
        return []
    finally:
        conn.close()
    out = []
    for r in rows:
        disp = _BOOK_DISPLAY.get(_KJV_BOOK_ID_REV.get(r["book_id"], ""), "")
        out.append({
            "ref": f"{disp} {r['chapter']}:{r['verse_num']}".strip(),
            "text": r["verse_text"],
        })
    return out


# ── Entry shape helpers ──────────────────────────────────────────────────────
def _clean_refs(items):
    """Keep a list of reference strings, trimmed, capped, de-duped (order kept)."""
    out, seen = [], set()
    if not isinstance(items, list):
        return out
    for it in items:
        ref = (it.get("ref") if isinstance(it, dict) else it) or ""
        ref = str(ref).strip()
        if ref and ref not in seen:
            seen.add(ref)
            out.append(ref)
            if len(out) >= _MAX_VERSES:
                break
    return out


def _body_from_request(body: dict) -> dict:
    """Normalize the incoming entry into the stored JSON shape — only the fields we
    keep, so a client can't smuggle extra keys in."""
    res = body.get("resolution") or {}
    mode = (res.get("mode") or "middle").strip().lower()
    if mode not in _RES_MODES:
        mode = "middle"
    related = body.get("related") if isinstance(body.get("related"), list) else []
    related = [str(x).strip() for x in related if str(x).strip()][:100]
    return {
        "heldBy": str(body.get("heldBy") or "").strip()[:200],
        "intro": str(body.get("intro") or "").strip()[:2000],
        "support": _clean_refs(body.get("support")),
        "tension": _clean_refs(body.get("tension")),
        "resolution": {"mode": mode, "text": str(res.get("text") or "").strip()[:8000]},
        "notes": str(body.get("notes") or "").strip()[:20000],
        "related": related,
    }


def _resolve_body(stored: dict) -> dict:
    """Expand stored refs into {ref, text} pairs for the client."""
    def expand(refs):
        out = []
        for ref in refs or []:
            hits = _resolve_ref(ref)
            if hits:
                out.append({"ref": ref, "text": " ".join(h["text"] for h in hits)})
            else:
                out.append({"ref": ref, "text": ""})   # unresolved — show the ref alone
        return out
    b = dict(stored)
    b["support"] = expand(stored.get("support"))
    b["tension"] = expand(stored.get("tension"))
    return b


def _guard():
    if not is_admin():
        return jsonify({"error": "not found"}), 404
    return None


# ── Routes ───────────────────────────────────────────────────────────────────
@bp.route("/api/study/entries", methods=["GET"])
def list_entries():
    g = _guard()
    if g:
        return g
    _ensure_tables()
    wanted = (request.args.get("type") or "").strip().lower()
    conn = study_db()
    try:
        if wanted in _TYPES:
            rows = conn.execute(
                "SELECT id, type, title, json, status, updated FROM entries"
                " WHERE deleted=0 AND type=? ORDER BY updated DESC",
                (wanted,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, type, title, json, status, updated FROM entries"
                " WHERE deleted=0 ORDER BY updated DESC"
            ).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        try:
            heldBy = (json.loads(r["json"]) or {}).get("heldBy", "")
        except (ValueError, TypeError):
            heldBy = ""
        out.append({
            "id": r["id"], "type": r["type"], "title": r["title"],
            "heldBy": heldBy, "status": r["status"], "updated": r["updated"],
        })
    return jsonify({"entries": out})


@bp.route("/api/study/entry/<entry_id>", methods=["GET"])
def get_entry(entry_id):
    g = _guard()
    if g:
        return g
    _ensure_tables()
    conn = study_db()
    try:
        r = conn.execute(
            "SELECT id, type, title, json, status, created, updated FROM entries"
            " WHERE id=? AND deleted=0",
            (entry_id,),
        ).fetchone()
    finally:
        conn.close()
    if not r:
        return jsonify({"error": "not found"}), 404
    try:
        stored = json.loads(r["json"]) or {}
    except (ValueError, TypeError):
        stored = {}
    out = _resolve_body(stored)
    out.update({
        "id": r["id"], "type": r["type"], "title": r["title"],
        "status": r["status"], "created": r["created"], "updated": r["updated"],
    })
    return jsonify(out)


@bp.route("/api/study/entry", methods=["POST"])
@limiter.limit("400 per hour")
def save_entry():
    g = _guard()
    if g:
        return g
    raw = request.get_data(cache=False) or b""
    if len(raw) > _MAX_ENTRY_BYTES:
        return jsonify({"error": "too large"}), 413
    try:
        body = json.loads(raw or b"{}")
    except (ValueError, TypeError):
        return jsonify({"error": "bad request"}), 400
    if not isinstance(body, dict):
        return jsonify({"error": "bad request"}), 400

    etype = (body.get("type") or "").strip().lower()
    if etype not in _TYPES:
        return jsonify({"error": "bad type"}), 400
    title = str(body.get("title") or "").strip()[:300]
    if not title:
        return jsonify({"error": "A title is required."}), 400
    status = (body.get("status") or "draft").strip().lower()
    if status not in ("draft", "published"):
        status = "draft"

    stored = _body_from_request(body)
    payload = json.dumps(stored, ensure_ascii=False)
    now = _now()
    _ensure_tables()
    conn = study_db()
    try:
        entry_id = str(body.get("id") or "").strip()
        existing = None
        if entry_id:
            existing = conn.execute(
                "SELECT created FROM entries WHERE id=?", (entry_id,)
            ).fetchone()
        if existing:
            conn.execute(
                "UPDATE entries SET type=?, title=?, json=?, status=?, updated=?, deleted=0"
                " WHERE id=?",
                (etype, title, payload, status, now, entry_id),
            )
        else:
            if not entry_id:
                entry_id = "e_" + secrets.token_urlsafe(9)
            conn.execute(
                "INSERT INTO entries (id, type, title, json, status, created, updated, deleted)"
                " VALUES (?,?,?,?,?,?,?,0)",
                (entry_id, etype, title, payload, status, now, now),
            )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"id": entry_id, "updated": now})


@bp.route("/api/study/entry/<entry_id>/delete", methods=["POST"])
@limiter.limit("200 per hour")
def delete_entry(entry_id):
    g = _guard()
    if g:
        return g
    _ensure_tables()
    conn = study_db()
    try:
        conn.execute(
            "UPDATE entries SET deleted=1, updated=? WHERE id=?", (_now(), entry_id)
        )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})


@bp.route("/api/study/verse", methods=["GET"])
@limiter.limit("600 per hour")
def resolve_verse():
    """Auto-fill helper: look up one reference's KJV text as the editor adds it."""
    g = _guard()
    if g:
        return g
    ref = (request.args.get("ref") or "").strip()
    if not ref:
        return jsonify({"error": "no reference"}), 400
    verses = _resolve_ref(ref)
    if not verses:
        return jsonify({"ref": ref, "verses": [], "error": "Couldn't find that reference."}), 200
    return jsonify({"ref": ref, "verses": verses})
