# Lexica — CLAUDE.md

## Overview
Lexica is a Flask-based Greek and Hebrew Bible word study app. It is ABP (Apostolic Bible Polyglot) interlinear focused, with KJV as a comparison translation. The design is scholarly but accessible — no prior Greek training required.

## Instructions for Claude Code
- Read only the specific function or section relevant to the task
- Do not read the entire app.py or app.jsx unless explicitly asked
- Do not attempt to access bible.db directly
- Make minimal changes — do not refactor unrelated code
- Ask for clarification before making large changes
- Limit tool calls — do not read files for context unless strictly necessary
- Go straight to the relevant function, do not scan the whole codebase first

## Important
- bible.db lives on PythonAnywhere only, not locally
- Never query or test against a local database
- All db changes must be made on PythonAnywhere

## cross_references table
- Columns: id, verse_id, verse_ref_id
- Both IDs map to kjv_verses.verse_id
- 386,518 rows loaded from MetaV/Torrey's TSK
- Join pattern: cross_references cr JOIN kjv_verses kv ON cr.verse_ref_id = kv.verse_id

## Stack
- Backend: Flask (Python), SQLite
- Frontend: React 18 + Babel standalone (JSX, no build step), HTML/CSS
- Deployed: PythonAnywhere (free tier)
- Version control: GitHub

## Project Structure

/home/appssanding720/
bible-db/
bible.db          # main SQLite database
app.py            # Flask app, all routes
load_kjv.py       # one-time import script (done)
templates/
index.html      # single page app
static/
app.jsx          # all frontend logic
styles.css       # all styles

## Database Tables
- `verses` — ABP verse text
- `words` — ABP word-level interlinear, Strong's tagged
- `lexicon` — Greek Strong's definitions
- `lsj` — Liddell-Scott-Jones Greek lexicon
- `abp_ext` — extended ABP data
- `books` — book metadata (name, testament, regex)
- `ai_search_cache` — cached AI query results
- `kjv_verses` — KJV full verse text (31,102 verses)
- `kjv_words` — KJV word-level tokens with position and italic flag
- `kjv_strongs` — KJV word → Strong's number mapping
- `bdb` — Brown-Driver-Briggs Hebrew lexicon (H-numbers)

## Key Design Decisions
- ABP is the primary text — all word study is anchored in ABP
- KJV is comparison only — never the primary display
- Italic words in KJV (italic=1) are translator additions with no source word
- Strong's G-numbers → lexicon/lsj tables; H-numbers → bdb table
- No systematic theology imported — text speaks first (Berean approach)
- Function words (171-word set) are filtered from search results
- is_function flag on search results controls this

## Library Tab
- Translation toggle: ABP | KJV | Parallel
- View toggles: Greek/English, Strong's dots, Interlinear
- Clicking a word opens LSJ sidebar (G-numbers) or BDB sidebar (H-numbers)
- Italic KJV words render in muted style
- Verse layout: unified two-column structure — `lib-verse-row` (flex) → `lib-vnum` (fixed) + `lib-verse-content` (flex:1); chip mode adds `lib-verse-chips`
- Word label functions (`studyWordLabel`, `chipLabel`): always return full `w.english` gloss — do not truncate to head word

## Search Tab
- Left input: lexicon/Strong's search
- Right input: AI natural language query
- Results: word cards with Strong's badge, Greek, transliteration, gloss
- Detail sidebar: LSJ Definition + Full LSJ tabs
- LSJ lookup chain: exact key → accent+hyphen-stripped plain → xref resolution (stubs discarded) → strongs_def fallback (source: "strongs")
- Groupings corpus filter (`filteredGroupings`): counts by `strongs_raw` only (not per-gloss) — gloss names kept from full-corpus groupings; `GlossGroupings` requires `glosses.length > 1` to render a group

## AI Search
- Uses Claude Haiku
- Berean system prompt — no imported theology, two-step LSJ lookup
- Now aware of KJV tables for cross-corpus comparison queries
- Cached in ai_search_cache table

## Deployment
- Git push to GitHub → git pull on PythonAnywhere
- Deploy command: `cd ~/bible-db && git pull && touch /var/www/appssanding720_pythonanywhere_com_wsgi.py`
- Database is NOT in git (too large) — managed directly on PythonAnywhere

## Do Not
- Do not add KJV as a primary study text
- Do not touch existing ABP tables when adding features
- Do not commit bible.db to git
- NEVER run `DELETE FROM words` or `DELETE FROM verses` — NT words (abp_nt_texts/) and OT words (abp_texts/) are both in the words table; clearing it destroys NT data that is hard to recover. If re-parsing is needed, run parse_abp.py directly against bible.db without clearing first (it uses INSERT OR IGNORE and is safe to re-run).