#!/usr/bin/env python3
"""Lexica Flask entry point.

Thin app shell: builds the Flask app, wires the rate limiter, registers the
domain blueprints (metav, crossref, lsj, kjv, lexicon, library, search, ai), and
runs the three startup steps (schema migration, function-word cache, AI cache
load). All route logic lives in the views_*/ai modules over the shared core.

The function-word classifier (_build_function_strongs_cache + its LSJ POS helpers)
stays here because it's a startup step that populates core._FUNCTION_STRONGS IN
PLACE — keeping it out of the view modules avoids an import cycle.

PA wsgi is UNCHANGED — `app` is still importable from this module.
"""
import os
import re
import sqlite3

from flask import Flask, jsonify, render_template, request, url_for

from core import log, DB, db, limiter, _FUNCTION_STRONGS, ai_cache_drop_legacy

# LSJ part-of-speech detection for function words.
# LSJ def_html has two POS patterns:
#   Short entries: <b>WORD</b>, Conj., …
#   Long entries:  <b>WORD</b>, (many variant forms) … <b>PREP.</b> WITH DAT. …
# We check both: plain-text POS near the headword AND bold POS section headers.
_LSJ_FUNC_WORD_RE = re.compile(
    r'\b(?:'
    r'Prep(?:osition)?[.,\s]|Conj(?:unction)?[.,\s]|Part(?:icle)?[.,\s]|'
    r'Art(?:icle)?[.,\s]|definite\s+article\b|'
    r'preposition\b|conjunction\b|particle\b|article\b'
    r')',
    re.IGNORECASE,
)
_LSJ_FUNC_BOLD_RE = re.compile(
    r'<b>(?:PREP(?:OSITION)?|CONJ(?:UNCTION)?|PART(?:ICLE)?|ART(?:ICLE)?)[.,\s<]',
    re.IGNORECASE,
)


def _is_lsj_function_word(def_html: str) -> bool:
    """Return True if the LSJ entry is a grammatical function word (not a content word)."""
    html = def_html or ''
    # Fast path: bold POS section header anywhere in the entry (e.g. <b>PREP.</b>)
    if _LSJ_FUNC_BOLD_RE.search(html[:3000]):
        return True
    # Slow path: strip the opening headword, then look for POS in plain text
    tail = re.sub(r'^\s*<b>[^<]*</b>', '', html.strip())
    text = re.sub(r'<[^>]+>', ' ', tail[:300]).strip()
    return bool(_LSJ_FUNC_WORD_RE.search(text[:200]))


# Hardcoded function words the LSJ POS detector misses (pronouns, negative particles,
# and common conjunctions/prepositions whose LSJ entries don't join the lsj table).
_FUNCTION_STRONGS_OVERRIDE: frozenset[str] = frozenset({
    # Negative particles
    "3361",   # μή
    "3756",   # οὐ / οὐκ / οὐχ
    "3761",   # οὐδέ
    "3762",   # οὐδείς / οὐδεμία / οὐδέν
    "3763",   # οὐδέποτε
    "3777",   # οὔτε
    "3780",   # οὐχί
    "3364",   # οὐ μή (emphatic negation)
    # Personal pronouns
    "1473",   # ἐγώ
    "4771",   # σύ
    "846",    # αὐτός / αὐτή / αὐτό
    "2249",   # ἡμεῖς
    "5210",   # ὑμεῖς
    "1438",   # ἑαυτοῦ / ἑαυτῆς (reflexive)
    # Demonstrative pronouns
    "3778",   # οὗτος / αὕτη / τοῦτο
    "1565",   # ἐκεῖνος
    "3592",   # ὅδε / ἥδε / τόδε
    # Definite article
    "3588",   # ὁ / ἡ / τό
    # Relative / interrogative / indefinite pronouns
    "3739",   # ὅς / ἥ / ὅ
    "3748",   # ὅστις / ἥτις / ὅτι
    "5101",   # τίς / τί (interrogative)
    "5100",   # τις / τι (indefinite)
    # Common conjunctions / particles (lsj join fails for these)
    "2532",   # καί
    "1161",   # δέ
    "3767",   # οὖν
    "235",    # ἀλλά
    "1063",   # γάρ
    "3754",   # ὅτι
    "2443",   # ἵνα
    "1487",   # εἰ
    "5613",   # ὡς
    "1437",   # ἐάν
    "3303",   # μέν
    "2228",   # ἤ
    "686",    # ἄρα
    "3303",   # μέν
    "1065",   # γε
    "4458",   # πως / πώς
    # Common prepositions (lsj join fails for most)
    "1722",   # ἐν
    "1519",   # εἰς
    "1537",   # ἐκ / ἐξ
    "575",    # ἀπό
    "4314",   # πρός
    "2596",   # κατά
    "3326",   # μετά
    "1223",   # διά
    "1909",   # ἐπί
    "4012",   # περί
    "5228",   # ὑπέρ
    "5259",   # ὑπό
    "4253",   # πρό
    "473",    # ἀντί
    "1722",   # ἐν (dupe, harmless)
    "303",    # ἀνά
    "1537",   # ἐκ (dupe, harmless)
})


def _build_function_strongs_cache() -> None:
    """Classify lexicon entries as content/function using LSJ def_html; runs once at startup.
    Populates core._FUNCTION_STRONGS IN PLACE (clear+update, never reassign) so that
    `from core import _FUNCTION_STRONGS` references in the view modules stay valid."""
    try:
        conn = db()
        rows = conn.execute(
            """SELECT l.strongs, lsj.def_html
               FROM lexicon l
               JOIN lsj ON lsj.plain = lower(strip_accents(l.lemma))"""
        ).fetchall()
        conn.close()
        func: set[str] = set()
        for row in rows:
            if _is_lsj_function_word(row["def_html"]):
                func.add(row["strongs"])
        func |= _FUNCTION_STRONGS_OVERRIDE
        _FUNCTION_STRONGS.clear()
        _FUNCTION_STRONGS.update(func)
        log.info("Function word cache: %d function words identified via LSJ", len(func))
    except Exception as e:
        log.warning("Could not build function word cache (LSJ table may not exist yet): %s", e)


from views_metav import bp as metav_bp, prune_cache as _prune_metav_cache
from views_crossref import bp as crossref_bp, prune_cache as _prune_xref_cache
from views_lsj import bp as lsj_bp
from views_kjv import bp as kjv_bp
from views_bsb import bp as bsb_bp
from views_esv import bp as esv_bp
from views_niv import bp as niv_bp
from views_heb import bp as heb_bp
from views_stats import bp as stats_bp
from views_lexicon import bp as lexicon_bp
from views_library import bp as library_bp
from views_search import bp as search_bp
from views_summary import bp as summary_bp, prune_cache as _prune_summary_cache
from views_notes import bp as notes_bp
from views_study import bp as study_bp
from ai import bp as ai_bp, _load_ai_cache_from_db

app = Flask(__name__)
limiter.init_app(app)


# Static assets (app.js, self-hosted React, CSS) load several per page view —
# exempt them so the site-wide default limit only guards the dynamic DB + AI
# routes and never trips on a normal page load (incl. shared/NAT IPs).
@limiter.request_filter
def _exempt_static():
    return request.endpoint == "static"


app.register_blueprint(metav_bp)
app.register_blueprint(crossref_bp)
app.register_blueprint(lsj_bp)
app.register_blueprint(kjv_bp)
app.register_blueprint(bsb_bp)
app.register_blueprint(esv_bp)
app.register_blueprint(niv_bp)
app.register_blueprint(heb_bp)
app.register_blueprint(stats_bp)
app.register_blueprint(lexicon_bp)
app.register_blueprint(library_bp)
app.register_blueprint(search_bp)
app.register_blueprint(summary_bp)
app.register_blueprint(notes_bp)
app.register_blueprint(study_bp)
app.register_blueprint(ai_bp)


@app.context_processor
def _asset_helpers():
    """Cache-busting static URLs: append each file's mtime as ?v=<mtime> so a
    deploy (git pull bumps the mtime) forces browsers to refetch. Brave/Chrome
    cache app.jsx + styles.css aggressively; a stale app.jsx served against a
    fresh styles.css broke the mobile nav layout (both bars stacked at top)."""
    def asset_url(filename):
        try:
            mtime = int(os.path.getmtime(os.path.join(app.static_folder, filename)))
        except OSError:
            mtime = 0
        return url_for("static", filename=filename, v=mtime)
    return {"asset_url": asset_url}


def _migrate_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    try:
        try:
            conn.execute("ALTER TABLE lsj ADD COLUMN summary_json TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists
        # One-time: clear v1 summaries that contained markdown artifacts.
        # The presence of summary_v column marks this migration as done.
        try:
            conn.execute("ALTER TABLE lsj ADD COLUMN summary_v INTEGER DEFAULT 0")
            conn.execute("UPDATE lsj SET summary_json = NULL WHERE summary_json IS NOT NULL")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # already migrated
        try:
            conn.execute("ALTER TABLE abp_ext ADD COLUMN summary_json TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists
        # One-time: clear any abp_ext summaries generated before the G-prefix OR-clause
        # fix was deployed (they may have been generated from LSJ content instead of ABP).
        # The presence of abp_summary_v column marks this migration as done.
        try:
            conn.execute("ALTER TABLE abp_ext ADD COLUMN abp_summary_v INTEGER DEFAULT 0")
            conn.execute("UPDATE abp_ext SET summary_json = NULL WHERE summary_json IS NOT NULL")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # already migrated
        try:
            conn.execute("ALTER TABLE books ADD COLUMN sort_order INTEGER")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists
        # Persistent AI search result cache (survives restarts).
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS ai_search_cache (
                query      TEXT PRIMARY KEY,
                result_json TEXT NOT NULL,
                ver_key    TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_cache_ver ON ai_search_cache(ver_key);
        """)
        conn.commit()
        # Indexed join key for the lexicon: strongs_g = 'G'||strongs (e.g. 'G4151').
        # Replaces the fragile SUBSTR(strongs_base,2) joins with equality on a real,
        # indexable key that can NEVER shave a digit off a bare number (the 592k
        # break) and inherently won't match a Hebrew H-number. Idempotent.
        try:
            conn.execute("ALTER TABLE lexicon ADD COLUMN strongs_g TEXT")
            conn.execute("UPDATE lexicon SET strongs_g = 'G' || strongs")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_lexicon_strongs_g ON lexicon(strongs_g)")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # already migrated
        # Phase 6 (backlog #5): tipnr.strongs is a PRIMARY KEY, so a name that is
        # BOTH a person AND a place under one Strong's number (e.g. Adam H121)
        # collapsed to whichever row imported LAST → entity_type/pn_type lied.
        # The fix keeps a type-SET per strongs in a new `entity_types` column
        # (e.g. 'person,place'). ONE row per strongs is preserved so the
        # `LEFT JOIN tipnr ON t.strongs = w.strongs_base` stays 1:1 (a composite
        # key would multiply word rows). This ALTER only makes the column EXIST so
        # the deployed code can SELECT it BEFORE import_tipnr.py is re-run on PA —
        # it stays NULL until then, so the frontend falls back to the old heuristic
        # and the deploy order is safe. Re-running import_tipnr.py populates it.
        # Additive + idempotent; never touches the words table / is_pn.
        try:
            conn.execute("ALTER TABLE tipnr ADD COLUMN entity_types TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists, or tipnr not present yet
        # The deployed DB already has kjv_* location/strongs_id indexes (created
        # directly on PA, not in git). Two were genuinely missing and made every
        # KJV/English match a scan: kjv_strongs.word_id (the join key into
        # kjv_words — only strongs_id was indexed) and the word text itself.
        # Idempotent; wrapped in case a partial DB lacks the tables.
        try:
            conn.executescript("""
                CREATE INDEX IF NOT EXISTS idx_kjv_strongs_word ON kjv_strongs(word_id);
                CREATE INDEX IF NOT EXISTS idx_kjv_words_word    ON kjv_words(word COLLATE NOCASE);
            """)
            conn.commit()
        except sqlite3.OperationalError:
            pass  # KJV tables not present in this DB
    finally:
        conn.close()

@app.errorhandler(429)
def rate_limit_handler(e):
    return jsonify({"error": f"Rate limit exceeded — {e.description}"}), 429


_migrate_db()
_build_function_strongs_cache()
# AI result cache (ai_search_cache): one-time sweep of pre-unification rows, then
# each synthesis category loads/prunes only its own. _load_ai_cache_from_db handles
# the 'search' category (bulk preload + prune); the others just prune their stale rows.
ai_cache_drop_legacy()
_load_ai_cache_from_db()
_prune_summary_cache()
_prune_xref_cache()
_prune_metav_cache()


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(debug=True)
