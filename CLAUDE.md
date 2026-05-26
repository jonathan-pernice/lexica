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

## STOP RULES
- Never use extended thinking
- Never explore more than 2 files per task
- Show code before changing it
- Maximum 5 tool calls per response

## Important
- bible.db lives on PythonAnywhere only, not locally
- Never query or test against a local database
- All db changes must be made on PythonAnywhere

## cross_references table
- Columns: id, verse_id, verse_ref_id
- Both IDs map to kjv_verses.verse_id
- 386,518 rows loaded from Torrey's TSK
- Join pattern: cross_references cr JOIN kjv_verses kv ON cr.verse_ref_id = kv.verse_id

## Stack
- Backend: Flask (Python), SQLite
- Frontend: React 18 + Babel standalone (JSX, no build step), HTML/CSS
- Deployed: PythonAnywhere (free tier)
- Version control: GitHub (repo: jonathan-pernice/lexica)

## Project Structure

/home/appssanding720/
bible-db/
bible.db          # main SQLite database
app.py            # Flask app, all routes
templates/
index.html      # single page app
static/
app.jsx          # all frontend logic
styles.css       # all styles
scripts/          # one-time import/migration scripts (not needed for runtime)

## Database Tables
- `verses` — ABP verse text
- `words` — ABP word-level interlinear, Strong's tagged
- `lexicon` — Greek Strong's definitions
- `lsj` — Liddell-Scott-Jones Greek lexicon
- `abp_ext` — extended ABP data
- `books` — book metadata (name, testament, regex)
- `ai_search_cache` — cached AI query results and TSK synthesis
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

## strongs_base inconsistency
- Some rows store bare numbers ('4151'), others store prefixed ('G4151')
- Always match both in SQL: WHERE (w.strongs_base = '4151' OR w.strongs_base = 'G4151')
- The AI system prompt instructs Haiku to do the same
- Search endpoint already handles this with triple-match params (snum, G{snum}, H{snum})

## Book Abbreviations
- ABP verses table uses: Mar (Mark), Joh (John), Php (Philippians), Jas (James), Heb (Hebrews)
- NT_BOOKS, BOOK_ORDER, BOOK_LABELS in app.jsx all use these abbreviations
- _KJV_BOOK_ID in app.py matches the same set

## Library Tab
- Translation toggle: ABP | KJV | Parallel
- View toggles: English/Greek word order, Strong's badges, Interlinear
- Clicking a word opens LSJ sidebar (G-numbers) or BDB sidebar (H-numbers)
- Italic KJV words render in muted style
- Verse layout: `lib-verse-row` (flex) → `lib-vnum` (fixed) + `lib-verse-content` (flex:1)
- Clicking a verse number opens the TSK Cross-Reference Panel for that verse
- Highlighted verse: gold background + left bar; clears when panel closes
- Cross-ref panel verse text tracks the live translation toggle (ABP/Parallel → ABP, KJV → KJV)

## TSK Cross-Reference Panel
- Endpoint: GET /api/cross-references/curated/<book>/<chapter>/<verse>
- Step 1: Haiku selects 8-10 strongest refs from full TSK list
- Step 2: Haiku generates 3-sentence synthesis anchored in ABP source vocabulary
- Cached in ai_search_cache with key prefix `xref_cur:` and ver_key="xref"
- TSK cache is preserved when _CACHE_CODE_VER bumps (NOT LIKE 'xref%' exclusion)

## Search Tab
- Left input: lexicon/Strong's search (now has submit button for mobile)
- Right input: AI natural language query
- Search matches: English head/gloss, Greek lemma (with/without accents), transliteration LIKE, Strong's number
- Strong's search matches bare number AND G/H prefixed form (triple-match)
- OT/NT corpus filter: All | OT | NT buttons filter results and recompute grouping counts
- Results: word cards with Strong's badge, Greek, transliteration, gloss
- Detail sidebar: LSJ Definition + Full LSJ tabs
- LSJ lookup chain: exact key → accent+hyphen-stripped plain → xref resolution (stubs discarded) → strongs_def fallback (source: "strongs")

## AI Search
- Uses Claude Haiku
- Berean system prompt — no imported theology
- key_strongs: up to 10 chips (6 Greek + 4 Hebrew max); AI instructed to provide both
- Empty-result retry: Haiku broadens SQL automatically if first query returns 0 rows
- Hebrew word bridge: BDB → kjv_strongs → ABP verses
- TSK cross-references available to AI at its own judgment
- Cached in ai_search_cache; _CACHE_CODE_VER invalidates AI cache but preserves xref cache
- Study mode: verse cards lazy-load with IntersectionObserver (300px rootMargin)

## Deployment
- Git push to GitHub → git pull on PythonAnywhere
- Deploy command: `cd ~/bible-db && git pull && touch /var/www/appssanding720_pythonanywhere_com_wsgi.py`
- Database is NOT in git (too large) — managed directly on PythonAnywhere

## Do Not
- Do not add KJV as a primary study text
- Do not touch existing ABP tables when adding features
- Do not commit bible.db to git
- NEVER run `DELETE FROM words` or `DELETE FROM verses` — NT words (abp_nt_texts/) and OT words (abp_texts/) are both in the words table; clearing it destroys NT data that is hard to recover. If re-parsing is needed, run parse_abp.py directly against bible.db without clearing first (it uses INSERT OR IGNORE and is safe to re-run).
