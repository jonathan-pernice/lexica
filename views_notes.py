#!/usr/bin/env python3
"""Study-notes accounts + sync — the only visitor-write path on the site.

Notes are browser-local first (static/src/12-notes-store.jsx). Sync is opt-in:
a visitor signs up / logs in with an email + password, and their notes sync to
that account on every device they log into. The app stays fully usable with no
account (browse + local notes), exactly as before.

Auth: email + password (password stored ONE-WAY hashed via werkzeug — never
readable). Stay-logged-in is a random bearer token kept in the browser; the
server keeps a table of valid tokens (logout deletes the token). NO email
verification and NO "forgot password" yet — password reset needs the site to
send email (SMTP), which isn't configured on PA. Add it later (a reset token
mailed to the address). Until then a lost password = no self-serve recovery.

Storage: notes.db (core.notes_db), kept OUT of bible.db (corpus gets rebuilt;
user data must survive that). Tables: users, tokens, notes (one row per note,
keyed by owner = "u<user_id>").

Endpoints:
  POST /api/auth/signup  {email, password} -> {token, email}
  POST /api/auth/login   {email, password} -> {token, email}
  POST /api/auth/logout                     -> {ok}
  GET  /api/auth/me                          -> {email} | 401
  POST /api/notes/sync   {notes:[...]}       -> {notes:[...]}   (Authorization: Bearer <token>)
Two-way last-write-wins merge by note id; deletes carry a tombstone.
"""
import json
import re
import secrets
import sqlite3
import time

from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash, check_password_hash

from core import notes_db, limiter

bp = Blueprint("notes", __name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MAX_NOTES = 5000            # per account
_MAX_NOTE_BYTES = 8000       # one note's JSON
_MAX_BODY_BYTES = 4_000_000  # whole request
_MIN_PASSWORD = 8


def _ensure_tables():
    conn = notes_db()
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,"
            " pass_hash TEXT NOT NULL, created TEXT NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tokens ("
            " token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created TEXT NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS notes ("
            " code TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL,"
            " updated TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,"
            " PRIMARY KEY (code, id))"
        )
        conn.commit()
    finally:
        conn.close()


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _user_for_token(conn):
    """Return the user_id for the request's bearer token, or None."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:].strip()
    if not token:
        return None
    row = conn.execute("SELECT user_id FROM tokens WHERE token = ?", (token,)).fetchone()
    return row["user_id"] if row else None


def _read_creds():
    try:
        body = json.loads(request.get_data(cache=False) or b"{}")
    except (ValueError, TypeError):
        return None, None
    if not isinstance(body, dict):
        return None, None
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    return email, password


@bp.route("/api/auth/signup", methods=["POST"])
@limiter.limit("20 per hour")
def signup():
    email, password = _read_creds()
    if not email or not _EMAIL_RE.match(email) or len(email) > 200:
        return jsonify({"error": "Enter a valid email."}), 400
    if not isinstance(password, str) or len(password) < _MIN_PASSWORD:
        return jsonify({"error": "Password must be at least 8 characters."}), 400
    _ensure_tables()
    conn = notes_db()
    try:
        try:
            cur = conn.execute(
                "INSERT INTO users (email, pass_hash, created) VALUES (?,?,?)",
                (email, generate_password_hash(password), _now()),
            )
        except sqlite3.IntegrityError:
            return jsonify({"error": "That email is already registered."}), 409
        user_id = cur.lastrowid
        token = secrets.token_urlsafe(24)
        conn.execute("INSERT INTO tokens (token, user_id, created) VALUES (?,?,?)", (token, user_id, _now()))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"token": token, "email": email})


@bp.route("/api/auth/login", methods=["POST"])
@limiter.limit("30 per hour")
def login():
    email, password = _read_creds()
    if not email or not password:
        return jsonify({"error": "Email and password required."}), 400
    _ensure_tables()
    conn = notes_db()
    try:
        row = conn.execute("SELECT id, pass_hash FROM users WHERE email = ?", (email,)).fetchone()
        if not row or not check_password_hash(row["pass_hash"], password):
            return jsonify({"error": "Wrong email or password."}), 401
        token = secrets.token_urlsafe(24)
        conn.execute("INSERT INTO tokens (token, user_id, created) VALUES (?,?,?)", (token, row["id"], _now()))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"token": token, "email": email})


@bp.route("/api/auth/logout", methods=["POST"])
def logout():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        conn = notes_db()
        try:
            conn.execute("DELETE FROM tokens WHERE token = ?", (token,))
            conn.commit()
        except sqlite3.Error:
            pass
        finally:
            conn.close()
    return jsonify({"ok": True})


@bp.route("/api/auth/me", methods=["GET"])
def me():
    _ensure_tables()
    conn = notes_db()
    try:
        uid = _user_for_token(conn)
        if uid is None:
            return jsonify({"error": "not signed in"}), 401
        row = conn.execute("SELECT email FROM users WHERE id = ?", (uid,)).fetchone()
    finally:
        conn.close()
    if not row:
        return jsonify({"error": "not signed in"}), 401
    return jsonify({"email": row["email"]})


@bp.route("/api/notes/sync", methods=["POST"])
@limiter.limit("200 per hour")
def notes_sync():
    raw = request.get_data(cache=False) or b""
    if len(raw) > _MAX_BODY_BYTES:
        return jsonify({"error": "too large"}), 413
    try:
        body = json.loads(raw or b"{}")
    except (ValueError, TypeError):
        return jsonify({"error": "bad request"}), 400
    if not isinstance(body, dict):
        return jsonify({"error": "bad request"}), 400

    _ensure_tables()
    conn = notes_db()
    try:
        uid = _user_for_token(conn)
        if uid is None:
            return jsonify({"error": "not signed in"}), 401
        owner = "u" + str(uid)

        incoming = body.get("notes") or []
        if not isinstance(incoming, list) or len(incoming) > _MAX_NOTES:
            return jsonify({"error": "bad notes"}), 400

        existing = {
            r["id"]: r["updated"]
            for r in conn.execute("SELECT id, updated FROM notes WHERE code = ?", (owner,))
        }
        for n in incoming:
            if not isinstance(n, dict):
                continue
            nid = n.get("id")
            upd = n.get("updated") or ""
            if not isinstance(nid, str) or not nid or not isinstance(upd, str):
                continue
            blob = json.dumps(n, separators=(",", ":"))
            if len(blob) > _MAX_NOTE_BYTES:
                continue
            if nid not in existing or upd > existing[nid]:
                conn.execute(
                    "INSERT OR REPLACE INTO notes (code, id, json, updated, deleted)"
                    " VALUES (?,?,?,?,?)",
                    (owner, nid, blob, upd, 1 if n.get("deleted") else 0),
                )
                existing[nid] = upd
        count = conn.execute("SELECT count(*) FROM notes WHERE code = ?", (owner,)).fetchone()[0]
        if count > _MAX_NOTES:
            conn.execute(
                "DELETE FROM notes WHERE code = ? AND id IN ("
                " SELECT id FROM notes WHERE code = ? ORDER BY updated ASC LIMIT ?)",
                (owner, owner, count - _MAX_NOTES),
            )
        conn.commit()
        rows = conn.execute("SELECT json FROM notes WHERE code = ?", (owner,)).fetchall()
    except sqlite3.Error:
        return jsonify({"error": "sync failed"}), 500
    finally:
        conn.close()

    out = []
    for r in rows:
        try:
            out.append(json.loads(r["json"]))
        except (ValueError, TypeError):
            continue
    return jsonify({"notes": out, "server_time": int(time.time())})
