#!/usr/bin/env python3
"""ESV — PERSONAL, owner-only reading text + audio (server-enforced gate).

The ESV is Crossway-copyrighted, so it is NOT a public corpus like KJV/BSB. The
owner owns ESV copies and uses it for his OWN study only — personal use, not
publishing. EVERY route here checks the caller's login token against the owner's
email (ESV_OWNER_EMAIL, set in the WSGI env like the other secrets) and returns
404 to everyone else. Hiding the toggle is NOT the protection — the address
itself must not work for anyone but the owner, and that's enforced right here.

Text lives in its OWN file, esv.db (core.esv_db), loaded on PA by
scripts/load_esv.py — never in bible.db, never in git (*.db is gitignored).

Audio (optional) is streamed from Faith Comes By Hearing's Bible Brain API: this
route fetches a short-lived signed mp3 URL server-side (the FCBH key stays in the
WSGI env, never reaches the browser) and hands back just that URL.

Endpoints (all owner-gated):
  GET /api/esv/status                    -> {owner: bool}   (turns the toggle on)
  GET /api/esv/chapter/<book>/<chapter>  -> [{verse, verse_text, heading}]
  GET /api/esv/audio/<book>/<chapter>    -> {url: <mp3>|null}
All require Authorization: Bearer <token> whose account == the owner.
"""
import json
import os
import sqlite3
import urllib.parse
import urllib.request

from flask import Blueprint, jsonify, request

from core import db_ro, esv_db, notes_db, _KJV_BOOK_ID, _USFM_BOOK

bp = Blueprint("esv", __name__)

# The owner is identified by email, set in the WSGI env (os.environ['ESV_OWNER_EMAIL']
# = 'you@example.com'). Unset -> the feature is simply off for everyone (safe before
# setup). Compared case-insensitively against the account email in notes.db.
ESV_OWNER_EMAIL = (os.environ.get("ESV_OWNER_EMAIL") or "").strip().lower()

# Bible Brain (FCBH) audio. Key + filesets in the WSGI env. ENGESVN2DA is
# ENG / ESV / New Testament / multi-voice + background music / audio, so it's
# NT-only; set an OT fileset too if you have one, otherwise OT chapters have no
# audio (the Listen button just won't appear).
FCBH_API_KEY   = os.environ.get("FCBH_API_KEY")
FCBH_API_BASE  = os.environ.get("FCBH_API_BASE", "https://4.dbt.io/api")
ESV_FILESET_NT = os.environ.get("ESV_AUDIO_FILESET_NT", "ENGESVN2DA")
ESV_FILESET_OT = os.environ.get("ESV_AUDIO_FILESET_OT")   # optional

_USFM = _USFM_BOOK   # app book-abbrev -> USFM code (what FCBH expects)


def _is_owner():
    """True ONLY when the request carries a valid bearer token whose account email
    matches ESV_OWNER_EMAIL. No env owner set, no/blank token, unknown token, or a
    different account -> False. This is the gate every route leans on."""
    if not ESV_OWNER_EMAIL:
        return False
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token = auth[7:].strip()
    if not token:
        return False
    try:
        conn = notes_db()
    except sqlite3.Error:
        return False
    try:
        row = conn.execute(
            "SELECT u.email AS email FROM tokens t JOIN users u ON u.id = t.user_id"
            " WHERE t.token = ?",
            (token,),
        ).fetchone()
    except sqlite3.Error:
        return False
    finally:
        conn.close()
    return bool(row) and (row["email"] or "").strip().lower() == ESV_OWNER_EMAIL


@bp.route("/api/esv/status")
def esv_status():
    """The frontend asks this to decide whether to show the ESV toggle. It's just
    a yes/no — the owner's email never leaves the server."""
    return jsonify({"owner": _is_owner()})


@bp.route("/api/esv/chapter/<book>/<int:chapter>")
def esv_chapter(book, chapter):
    if not _is_owner():
        return jsonify({"error": "not found"}), 404      # opaque to non-owners
    book_id = _KJV_BOOK_ID.get(book)
    if book_id is None:
        return jsonify([])
    # ESV text from esv.db; section headings (shared) from bible.db's pericopes.
    try:
        conn = esv_db()
    except sqlite3.OperationalError:
        return jsonify([])                                # esv.db not loaded yet
    try:
        rows = conn.execute(
            "SELECT verse_num, verse_text FROM esv_verses"
            " WHERE book_id = ? AND chapter = ? ORDER BY verse_num",
            (book_id, chapter),
        ).fetchall()
    except sqlite3.OperationalError:
        return jsonify([])                                # esv_verses table missing
    finally:
        conn.close()

    headings = {}
    try:
        bconn = db_ro()
        try:
            for r in bconn.execute(
                "SELECT verse, heading FROM pericopes WHERE book = ? AND chapter = ?",
                (book, chapter),
            ):
                headings[r["verse"]] = r["heading"]
        finally:
            bconn.close()
    except sqlite3.OperationalError:
        pass

    return jsonify([
        {
            "verse": r["verse_num"],
            "verse_text": r["verse_text"],
            "heading": headings.get(r["verse_num"]),
        }
        for r in rows
    ])


@bp.route("/api/esv/audio/<book>/<int:chapter>")
def esv_audio(book, chapter):
    if not _is_owner():
        return jsonify({"error": "not found"}), 404
    if not FCBH_API_KEY:
        return jsonify({"url": None})                     # audio not configured
    usfm = _USFM.get(book)
    book_id = _KJV_BOOK_ID.get(book)
    if not usfm or book_id is None:
        return jsonify({"url": None})
    fileset = ESV_FILESET_NT if book_id >= 40 else ESV_FILESET_OT   # 40 = Matthew
    if not fileset:
        return jsonify({"url": None})                     # e.g. OT with no OT fileset

    url = (
        f"{FCBH_API_BASE}/bibles/filesets/{urllib.parse.quote(fileset)}/"
        f"{usfm}/{chapter}?v=4&key={urllib.parse.quote(FCBH_API_KEY)}"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "lexica/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return jsonify({"url": None})                     # FCBH down / bad key / no audio

    data = payload.get("data") if isinstance(payload, dict) else None
    path = None
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and item.get("path"):
                path = item["path"]
                break
    return jsonify({"url": path})
