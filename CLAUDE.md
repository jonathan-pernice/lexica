# Lexica — CLAUDE.md

## Overview
Lexica is a Flask-based Greek and Hebrew Bible word study app. ABP (Apostolic Bible Polyglot) interlinear is the primary text; KJV is a fully searchable parallel corpus. The design is scholarly but accessible — no prior Greek training required.

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

## Deployment
- Deploy command: `cd ~/bible-db && git pull && touch /var/www/appssanding720_pythonanywhere_com_wsgi.py`
- PythonAnywhere git is configured: `pull.rebase false`, `merge.autoedit no` (no prompts)
- Database is NOT in git (too large) — managed directly on PythonAnywhere

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
- `words` — ABP word-level interlinear, Strong's tagged. Has `italic` column (live). Planned: add `morph` column (MorphGNT/CATSS)
- `lexicon` — Greek Strong's definitions
- `lsj` — Liddell-Scott-Jones Greek lexicon
- `abp_ext` — extended ABP data
- `books` — book metadata (name, testament, regex)
- `ai_search_cache` — cached AI query results and TSK synthesis
- `kjv_verses` — KJV full verse text (31,102 verses)
- `kjv_words` — KJV word-level tokens with position and italic flag
- `kjv_strongs` — KJV word → Strong's number mapping
- `bdb` — Brown-Driver-Briggs Hebrew lexicon (H-numbers)
- `pericopes` — section headings (book, chapter, verse, heading); populated from bh_scrape.db.bh_headings; display wiring pending

## Key Design Decisions
- ABP is the primary text — all word study anchored in ABP interlinear
- KJV is a full parallel corpus — searchable, with its own strongs, word clicks, and sidebar
- Italic words in KJV (italic=1) are translator additions with no source word
- Strong's G-numbers → lexicon/lsj tables; H-numbers → bdb table
- No systematic theology imported — text speaks first (Berean approach)
- Function words (171-word set) are filtered from search results

## strongs_base inconsistency
- Some rows store bare numbers ('4151'), others store prefixed ('G4151')
- Always match both in SQL: WHERE (w.strongs_base = '4151' OR w.strongs_base = 'G4151')
- The AI system prompt instructs Haiku to do the same
- Search endpoint already handles this with triple-match params (snum, G{snum}, H{snum})

## Book Abbreviations
- ABP verses table uses: Mar (Mark), Joh (John), Php (Philippians), Jas (James), Heb (Hebrews)
- NT_BOOKS, BOOK_ORDER, BOOK_LABELS in app.jsx all use these abbreviations
- _KJV_BOOK_ID in app.py matches the same set

## Responsive Breakpoints
- **Desktop ≥1100px**: navy header, left nav panel (224px), lib-bar toolbar, detail panel as right sidebar
- **Mobile <1100px**: no header, sticky mobile toolbar (lib-toolbar), bottom tab nav, panels as bottom sheets
- JS thresholds: `navVisible >= 1100`, `isMobile < 1100`, `desktopBar` removed (two states only)
- CSS: `@media (max-width: 1099px)` / `@media (min-width: 1100px)` — no other breakpoints except 520px for very small phones

## Library Tab
- Desktop toolbar (lib-bar): [‹ Ch input ›] | [ABP] [KJV] [Parallel] | [Strong's] [Interlinear] | [Chip] [Prose]
- Mobile toolbar (lib-toolbar): [☰] [‹] [Book Ch ▾] [›] [ABP/KJV/Par] — sticky, fixed height 56px
- Chip mode: all words individually clickable with interlinear stack (Greek → English → Strong's)
- Prose mode: clickable inline word spans, no chip borders — reading-first view
- KJV mode locks Prose to English only (no Greek available)
- Word clicks → LSJ sidebar (G-numbers), BDB sidebar (H-numbers), or metaV (proper nouns)
- KJV word clicks correctly route: common words → LSJ, proper nouns → metaV, Hebrew → BDB
- Italic words render muted/italic: KJV (italic=1) and ABP (words.italic=1); ABP bracket words `[word]` are also translator additions
- Verse layout: `lib-verse-row` (flex-start) → `lib-vnum` (fixed, min-width) + `lib-verse-content`
- Clicking a verse number opens the TSK Cross-Reference Panel
- Both word detail panel and xref panel trigger `has-detail` on `.app` → compacts `lib-reading` on desktop (desktop only, scoped to `min-width: 1100px`)

## TSK Cross-Reference Panel
- Endpoint: GET /api/cross-references/curated/<book>/<chapter>/<verse>
- Step 1: Haiku selects 8-10 strongest refs from full TSK list
- Step 2: Haiku generates 3-sentence synthesis anchored in ABP source vocabulary
- Cached in ai_search_cache with key prefix `xref_cur:` and ver_key="xref"
- TSK cache is preserved when _CACHE_CODE_VER bumps (NOT LIKE 'xref%' exclusion)

## Search Tab
- Left input: lexicon/Strong's search; Right input: AI natural language query
- **Lexicon mode**: browse-only, ABP | KJV | All corpus toggle
  - ABP: ABP words table (Greek, dotted strongs e.g. G2321.1)
  - KJV: kjv_strongs/kjv_words (standard strongs, both G and H numbers)
  - All: ABP Greek + KJV Hebrew OT (best cross-testament view)
  - Word groupings and chips reflect the active corpus
- **AI mode**: study mode only, corpus filter All | OT | NT in toolbar alongside Curated | Canonical | ABP | KJV
- Search endpoint (`/api/search`) returns `{abp_results, kjv_results, abp_groupings, kjv_groupings, variants}`
- Search cache key prefix: `v3|`

## AI Search
- Uses Claude Haiku
- Berean system prompt — no imported theology
- key_strongs: up to 10 chips (6 Greek + 4 Hebrew max)
- Empty-result retry: Haiku broadens SQL automatically if first query returns 0 rows
- Hebrew word bridge: BDB → kjv_strongs → ABP verses
- Cached in ai_search_cache; _CACHE_CODE_VER invalidates AI cache but preserves xref cache

## BibleHub ABP Scrape — status
- Scraper: `scripts/scrape_biblehub_abp.py` — captures strongs, greek_pos, italic (last-word heuristic), strips `[ ]` brackets
- Fresh re-scrape running on PA (new `bh_scrape.db` with `greek_pos` column)
- Rebuild script: `scripts/build_words_from_bh.py` — DELETEs words table and rebuilds from bh_scrape.db
- After rebuild: words table will have correct per-word strongs, english, italic, greek_pos, bracket_id
- Do NOT add conjugated manuscript forms — audience are non-Greek readers
- Next planned: integrate MorphGNT (NT) + CATSS/CCAT (LXX OT) for `morph` column; display plain English in sidebar

## cross_references table
- Columns: id, verse_id, verse_ref_id
- Both IDs map to kjv_verses.verse_id
- 386,518 rows loaded from Torrey's TSK
- Join pattern: cross_references cr JOIN kjv_verses kv ON cr.verse_ref_id = kv.verse_id

## Do Not
- Do not add KJV as the sole primary study text — ABP remains the anchor
- Do not touch existing ABP tables when adding unrelated features
- Do not commit bible.db to git
- NEVER run `DELETE FROM words` or `DELETE FROM verses` — OT and NT words are both in the words table; clearing destroys hard-to-recover data. If re-importing, use INSERT OR IGNORE (safe to re-run).
