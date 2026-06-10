# Lexica — CLAUDE.md

## Overview
Lexica is a Flask-based Greek and Hebrew Bible word study app. ABP (Apostolic Bible Polyglot) interlinear is the primary text; KJV is a fully searchable parallel corpus. The design is scholarly but accessible — no prior Greek training required.

## HOW TO TALK TO THE USER — read every session, no exceptions
Plain, concise English — like a colleague, not a textbook. The user is a data-center engineer
(CCNA, Linux, lots of hands-on) — NOT a programmer. Assume infra/CLI/networking fluency (don't
explain basic console steps), but use NO developer jargon. Avoid words like *idempotent,
transaction, schema, query/SELECT, commit, null, boolean, lock/read-lock, upsert, snapshot* —
translate them into plain terms ("running it again just redoes the same work, no harm"; "that
command only reads the database, it never changes it"). Short answers; skip heading-heavy formal
reports unless he asks for depth; skip "want me to walk you through it?" offers — just give the
answer. He has flagged this MORE THAN ONCE — treat it as a hard rule, not a preference. Full
detail + the exact words I've slipped on before: memory `feedback_communication_style`.

## Instructions for Claude Code
(Account: user is on the Max 20x plan — ample headroom. Bias to being THOROUGH and
CORRECT over conserving tool calls. The notes below are about staying focused and
keeping context sharp, NOT about rationing usage.)
- Target the specific function/section relevant to the task — for focus, not frugality
- app.py and the frontend are now split into modules (app.py → core.py + ai.py +
  views_*.py; the old app.jsx → static/src/*.jsx). Read the relevant module/region, not
  everything — for focus, but read as many as correctness needs
- Read as much as you need to get it right — do not starve a task of context to save calls
- Do not attempt to access bible.db directly
- Make minimal changes — do not refactor unrelated code
- Ask for clarification before making large changes
- Go straight to the relevant function; don't scan the whole codebase out of habit

## Effort mode (Opus 4.8) — on the Max 20x plan, headroom is ample
Pick effort by task TYPE. When in doubt, lean higher — the plan affords it.
- **Routine work** (known edits, data scripts, config tweaks, one-line fixes):
  medium effort is plenty; stay efficient but don't cut corners on correctness.
- **Diagnosis / root-cause / data-integrity work** (a symptom several hops from
  its cause, anything touching the words table or Strong's invariants): HIGH
  effort — read as many spots as the trace needs and reason it through. A wrong
  guess on data is expensive (see the 2026-06-03 strongs_base regression — one
  wrong word hid a 592k-row break).
- When unsure which mode you're in, ask the user, or state your assumption.

## Working style (not hard caps — 20x plan, optimize for correctness)
- Show code before changing it (ALWAYS — every mode, no exceptions)
- WORD-ORDER / Strong's-order / proper-noun-slot swaps: confirm the layout against
  the SOURCE (eSword/ABP) ONLY — NEVER guess "what eSword probably shows." If the
  source isn't in front of you, ask the user to check. Read-only dry-run is the
  source of truth before any --apply. (2026-06-07 Act 19:4 lesson.)
- Prefer focused reads over broad scans — for context quality, not call-rationing
- No artificial tool-call or file-count ceiling; use what the task genuinely needs.
  For diagnosis, that may be many reads — that's expected and fine.
- Still avoid genuinely wasteful moves (re-reading a file you just edited, scanning
  the whole repo when you know the target)

## Important
- bible.db lives on PythonAnywhere only, not locally
- Never query or test against a local database
- All db changes must be made on PythonAnywhere

## Deployment
- Preferred deploy (added 2026-06-07): `bash ~/bible-db/scripts/deploy.sh` — one command that
  pulls, runs the invariant tests, loads any non-canonical books WHOSE FILES THE PULL CHANGED
  (it diffs old..new HEAD and runs only the loaders for touched folders — a plain code deploy
  loads nothing), and reloads the site ONLY if the tests pass. A loader hiccup warns but never
  blocks the reload. So adding a new book just needs a normal deploy — no loader to run by hand.
- Manual fallback (still valid): `cd ~/bible-db && git pull && touch /var/www/appssanding720_pythonanywhere_com_wsgi.py`
- PythonAnywhere git is configured: `pull.rebase false`, `merge.autoedit no` (no prompts)
- Database is NOT in git (too large) — managed directly on PythonAnywhere
- After a `requirements.txt` change: on PA, `workon bible-env` THEN `pip install -r requirements.txt`
  (NO `--user` inside the venv — the venv is `/home/appssanding720/.virtualenvs/bible-env`, Python 3.11).
  Then reload. A `--user` install lands in the wrong place (system 3.13 user dir) and the site ignores it.
- **Env vars / secrets live in the WSGI file, NOT a `.env`.** `/var/www/appssanding720_pythonanywhere_com_wsgi.py`
  sets them with `os.environ['KEY'] = '...'` (ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID). `core.load_dotenv()`
  does NOT reliably find a `.env` under the PA web app, so a `.env` there is empty/ignored — don't rely on it.
  The `os.environ[...]` lines MUST sit ABOVE the app import in the WSGI (module-level reads like
  `GOOGLE_CLIENT_ID = os.environ.get(...)` happen at import). Edit the WSGI, then reload (touch it).
- **Notes accounts (`google-auth`) — DONE + LIVE 2026-06-09:** `pip install -r requirements.txt` (adds
  `google-auth`) + `GOOGLE_CLIENT_ID` in the WSGI + the Google consent screen Published. Google sign-in
  degrades safely (button hidden) if any piece is missing, so a code-only deploy never breaks.
  `notes.db` is gitignored (`*.db`) like bible.db — it holds user accounts/notes, managed on PA.
- **Owner-only features (ESV text + audio, visitor stats) — code LIVE 2026-06-10.** ONE site-owner
  gate: `views_notes.is_owner()` checks the login bearer token's email against `OWNER_EMAIL` (WSGI
  env; falls back to the older `ESV_OWNER_EMAIL`). Set `OWNER_EMAIL = '<your-owner-email>'` in the
  WSGI (above the import) + reload — that one var gates BOTH the ESV reader and the Stats dashboard.
  Owner sign-in shows: a private **Stats** view (About → About|Stats toggle; counter in `notes.db`,
  no 3rd party) and the **ESV + NIV** reading texts. ESV text is **LOADED + LIVE 2026-06-10** (`scripts/load_esv.py`
  from github.com/lguenth/mdbible → `esv.db` = 31,104 verses, all 66 books; `esv.db` gitignored, PA-only).
  **NIV = a 2nd owner-only text mirroring ESV exactly (LIVE 2026-06-10): `views_niv.py`, own `niv.db`,
  NIV toggle next to ESV; TEXT-ONLY (no NIV audio — FCBH doesn't carry it). Loaded by
  `scripts/load_niv.py ~/Bible-niv ~/bible-db/niv.db` from the aruljohn/Bible-niv repo (66 JSON files,
  ~31,104 verses). No WSGI change — `OWNER_EMAIL` already gates it.**
  ESV AUDIO still needs `FCBH_API_KEY` in the WSGI (Bible Brain key, pending as of 2026-06-10); **BSB
  audio is public-domain and needs no setup**. Memory `project_esv_audio` + `project_visitor_stats`.

## CI / automation (added 2026-06-07)
- **GitHub Actions** (`.github/workflows/ci.yml`) — runs on every push/PR: (1) the invariant tests
  (`tests/test_strongs_join.py` + `test_build_invariants.py`; they build their own in-memory data, no
  bible.db needed), (2) rebuilds `app.js` and FAILS if the committed copy is stale. Repo is public; check
  the Actions tab or query `api.github.com/repos/jonathan-pernice/lexica/actions/runs`. `gh` CLI NOT installed locally.
- **Pre-commit hook** (`scripts/githooks/pre-commit`, wired via `git config core.hooksPath scripts/githooks`)
  — local twin of CI: rebuilds+stages app.js if a `static/src/*.jsx` is staged, then runs the tests and
  blocks the commit on failure. LOCAL DEV MACHINE ONLY — on PA it was unset (`git config --unset
  core.hooksPath`) because PA has no Node. Bypass once with `git commit --no-verify`.
- **Dependabot** (`.github/dependabot.yml`) — weekly; opens PRs for pip/npm/actions updates. They're
  suggestions, not auto-applied; merge on GitHub, then `pip install` on PA for pip ones.
- PENDING (not done): nightly `health_check.py` email on PA — needs PA scheduled task + email creds.

## Frontend build step (added 2026-06-06)
- The SOURCE is `static/src/*.jsx` — per-view files, concatenated (filename order;
  numeric prefixes set it) into ONE compilation unit. `static/app.js` is the COMPILED
  output the browser loads (index.html points at `app.js`). The compiled `app.js` IS
  committed to git; `node_modules/` is git-ignored. (Phase 4, 2026-06-06: the old
  3,461-line `static/app.jsx` monolith was split into `static/src/` — see the file
  headers there for what each holds. Same split spirit as the app.py blueprints.)
- After ANY edit to a `static/src/*.jsx` file you MUST rebuild before committing:
  `npm run build` (runs `scripts/build-frontend.js`: concat src -> Babel -> static/app.js).
  One-time setup: `npm install`. Commit BOTH the .jsx source AND the rebuilt app.js.
- The build runs LOCALLY (Node is on the dev machine, not needed on PA). PA deploy is
  unchanged — it just `git pull`s the already-compiled app.js.
- Why concat-then-compile (not `babel <dir>`): one unit emits Babel's spread helper
  once and reproduces the old single-file output exactly (the src files joined by "\n"
  reconstruct the original app.jsx).
- Why the build step at all: in-browser Babel was recompiling all the JSX on every page
  load (~2.5s render delay; server TTFB was only 96ms). Precompiling + production React
  builds removes that tax. Babel-standalone and dev React were dropped from index.html.

## Stack
- Backend: Flask (Python), SQLite
- Frontend: React 18 (production UMD), JSX in static/src/*.jsx precompiled via Babel to
  static/app.js (build step — see "Frontend build step" above), HTML/CSS
- Deployed: PythonAnywhere ($10 Dev tier)
- Version control: GitHub (repo: jonathan-pernice/lexica)

## Project Structure

/home/appssanding720/
bible-db/
bible.db          # main SQLite database
app.py            # Flask app, all routes
templates/
index.html      # single page app
static/
src/             # frontend SOURCE — per-view *.jsx (00-core … 90-app)
app.js           # COMPILED bundle the browser loads (built from src/, committed)
styles.css       # all styles
scripts/          # build-frontend.js + one-time import/migration scripts

## Database Tables
- `verses` — ABP verse text
- `words` — ABP word-level interlinear, Strong's tagged. Columns: english, english_head, strongs, strongs_base, greek_pos, bracket_id, italic, italic_words, smcap_words, is_pn, morph, lemma. The displayed Greek lemma is joined live from `lexicon` via `LEFT JOIN lexicon l ON l.strongs_g = w.strongs_base` (the indexed G-prefixed key added in Phase 1; replaced the old `SUBSTR(strongs_base,2)` join — this is why strongs_base MUST stay G/H-prefixed). `is_pn=1` marks proper nouns (set by import_tipnr.py). `morph`/`lemma` columns added rebuild #6 (~78% populated).
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
- `bsb_verses` — Berean Standard Bible verse text (public domain), mirrors kjv_verses on 1-66 book ids
- **Separate DB files (NOT bible.db, both gitignored + PA-only):** `notes.db` — user accounts/notes/
  highlights/journals + a `visits` table (owner-only visitor stats: day + daily IP+UA hash + referrer).
  `esv.db` — owner-only ESV text (`esv_verses`), loaded by `scripts/load_esv.py`. `niv.db` — owner-only
  NIV text (`niv_verses`), loaded by `scripts/load_niv.py`. Both See "Owner-only features".
- `<book>_words` / `<book>_verses` — non-canonical texts, each in its OWN two tables, walled off
  from the Bible's tables and from search/word counts. Built by `scripts/load_extra.py`; served by
  `/api/extra/<book>/chapter/<n>`. English-only texts (no Greek) load with an empty words table.
  Now LIVE (built by the per-group loaders under `scripts/`; all wired in the `NONCANON` array in
  static/src/60-library.jsx and auto-loaded by deploy.sh):
    * Septuagint Apocrypha — 16 Brenton books, English-only (`scripts/apocrypha/load_apocrypha.py`)
    * Pseudepigrapha — 1 Enoch, 2 Enoch, Jubilees, 2 Baruch, Apocalypse of Abraham, Assumption of
      Moses, all English-only (`scripts/apocrypha/load_pseudepigrapha.py` + `scripts/enoch/`)
    * Testaments of the Twelve Patriarchs — 12 separate English-only books (load_pseudepigrapha.py)
    * Apostolic Fathers — 14 books with FULL GREEK INTERLINEAR (not englishOnly): Didache,
      1-2 Clement, 7 Ignatian letters, Polycarp, Martyrdom of Polycarp, Barnabas, Diognetus,
      Shepherd of Hermas. Built by `scripts/apfathers/build_af.py` (+ `build_hermas.py` for Hermas)
      and loaded by `scripts/apfathers/load_apfathers.py`. Greek+lemma from Brannan/Lake (CC-BY-SA),
      Strong's mapped via openscriptures + Dodson glosses, English from Lightfoot. See memory
      `project_noncanonical_texts` for the pipeline + the build_af raw/ inputs (gitignored).
  See TODO.md "Non-canonical texts" + memory
  `project_noncanonical_texts`.

## Key Design Decisions
- ABP is the primary text — all word study anchored in ABP interlinear
- KJV is a full parallel corpus — searchable, with its own strongs, word clicks, and sidebar
- Italic words in KJV (italic=1) are translator additions with no source word
- Strong's G-numbers → lexicon/lsj tables; H-numbers → bdb table
- No systematic theology imported — text speaks first (Berean approach)
- Function words (171-word set) are filtered from search results

## strongs_base format — CRITICAL INVARIANT
- `words.strongs_base` is fully G/H prefixed ('G4151', 'H7307') — normalized 2026-06-01
- This is NOT cosmetic: the lexicon join matches `l.strongs_g = w.strongs_base` (strongs_g =
  'G'||strongs). A BARE strongs_base ('4151') won't equal 'G4151' → NULL lemma (missing, not
  wrong). Under the OLD `SUBSTR(strongs_base,2)` join it was worse — a bare base shaved a DIGIT →
  WRONG lemma. (2026-06-03, pre-Phase-1: a rebuild left 592k bare → G2206 ζηλόω rendered as
  ἄκρον/G206. Fixed by `UPDATE words SET strongs_base='G'||strongs_base WHERE strongs_base GLOB
  '[0-9]*'`.) tests/test_strongs_join.py + test_build_invariants.py lock this invariant.
- `words.strongs` (the other column) is intentionally LEFT BARE ('2206', dotted '2321.1');
  the frontend renders it as `G{strongs}`. Only strongs_base carries the prefix.
- `kjv_strongs.strongs_id` is also fully prefixed (was always so)
- Always use single-match in SQL: WHERE w.strongs_base = 'G4151'
- After ANY words-table rebuild, verify: `SELECT count(*) FROM words WHERE strongs_base GLOB '[0-9]*'` must be 0
- AI system prompt may still reference old triple-match — update if issues arise

## Book Abbreviations
- ABP verses table uses: Mar (Mark), Joh (John), Php (Philippians), Jas (James), Heb (Hebrews)
- NT_BOOKS, BOOK_ORDER, BOOK_LABELS in static/src/00-core.jsx all use these abbreviations
- _KJV_BOOK_ID in app.py matches the same set

## Responsive Breakpoints
- **Desktop ≥1100px**: navy header, left nav panel (224px), lib-bar toolbar, detail panel as right sidebar
- **Mobile <1100px**: no header, sticky mobile toolbar (lib-toolbar), bottom tab nav, panels as bottom sheets
- JS thresholds: `navVisible >= 1100`, `isMobile < 1100`, `desktopBar` removed (two states only)
- CSS: `@media (max-width: 1099px)` / `@media (min-width: 1100px)` — no other breakpoints except 520px for very small phones

## Library Tab
- Desktop toolbar (lib-bar): [‹ Ch input ›] | [Compare ▾] | [Strong's] [Interlinear] | [Chip] [Prose]
  (text source — ABP/KJV/BSB/ESV*/NIV* — lives in the LEFT NAV's nav-source seg, not the toolbar; * = owner only.
  The seg goes full-width via `nav-source-seg--wide` when the owner's ESV/NIV are present so 6 buttons don't crowd.)
- Mobile toolbar (lib-toolbar): [☰] [‹] [Book Ch ▾] [›] [ABP/KJV/Par] — sticky, fixed height 56px
- **Compare (was "Parallel"): pick 2–4 of ABP/KJV/BSB/ESV/NIV to read side by side.** `translation === "parallel"`
  is the mode; `compareSel` (array) = which texts. Desktop = N columns (`.lib-cmp-2/3/4`); mobile = stacked,
  one labeled line per text. Rows are the ordered UNION of every selected text's verses (keyed chapter+verse),
  so a missing verse leaves a blank cell. Notes/highlights are SHARED across columns (whole-verse paint in compare).
  - **Desktop picker** = checkbox dropdown on the Compare button.
  - **MOBILE picker (rebuilt 2026-06-10): the separate Compare row is GONE — the Reading sheet's single Text
    picker IS the compare control.** TAP a text = read just it (single swap); LONG-PRESS (or right-click) = tick
    it into/out of the 2–4 side-by-side set. A ✓ marks each shown text; a line below reads "Reading X" /
    "Comparing N — … side by side". All driven by `compareActive`/`toggleCompare` (which already flip
    single↔parallel and floor at 1). Gesture handler = `pickHandlers` in `ModesSheet` (500ms timer + a `fired`
    flag so a long-press doesn't also fire the tap). Hint: "Tap to read · long-press to compare". A non-canon
    reader falls back to the plain single picker (taps jump back to the Bible).
- Chip mode: all words individually clickable with interlinear stack (Greek → English → Strong's)
- Prose mode: clickable inline word spans, no chip borders — reading-first view
- KJV mode locks Prose to English only (no Greek available)
- English-only "other books" (Apocrypha/Enoch/etc.): the Chip toggle gives a VERSE-PER-LINE reading layout
  (`renderExtraLines`, `extraLineMode`) — plain text, one verse per row, no clickable chips (no Greek). Prose =
  the old flowing run-together text. Strong's/Interlinear stay locked. (2026-06-10)
- **Library remembers your reading spot across reloads:** `localStorage` `lexica.lib.v1` saves
  book/chapter/translation (+ an open non-canon text) and restores it on load instead of opening at Genesis 1.
  An explicit verse jump (`nav.book`, e.g. a Search/cross-ref click) overrides it. Compare/chronological are NOT
  restored (fall back to single/canonical). (2026-06-10)
- Word clicks → LSJ sidebar (G-numbers), BDB sidebar (H-numbers), or metaV (proper nouns)
- KJV word clicks correctly route: common words → LSJ, proper nouns → metaV, Hebrew → BDB
- Italic words render muted/italic: KJV (italic=1) and ABP (words.italic=1); ABP bracket words `[word]` are also translator additions
- Verse layout: `lib-verse-row` (flex-start) → `lib-vnum` (fixed, min-width) + `lib-verse-content`
- Clicking a verse number opens the TSK Cross-Reference Panel
- Both word detail panel and xref panel trigger `has-detail` on `.app` → compacts `lib-reading` on desktop (desktop only, scoped to `min-width: 1100px`)

## Notes, Highlights, Bookmarks + Accounts (study notes — LIVE 2026-06-09)
Full detail: memory `project_notes_highlights`. The headline facts:
- **Browser-local first; accounts are OPT-IN.** Notes live in the browser (`localStorage`
  `lexica.notes.v1`) and the app is fully usable with NO account. Signing in (below) syncs them
  across devices. One record = a word-position anchor + optional text + optional color + optional
  bookmark flag — a note, highlight, and bookmark are the SAME record:
  `{id, device, corpus, translation, book, bookName, chapter, start:{verse,pos}, end:{verse,pos},
  snippet, body, color, bookmark, deleted, created, updated}`. `id` minted AT CREATION. Delete is a
  SOFT delete (`deleted:true` tombstone) so deletes propagate through sync/import.
- **Accounts / sync — `notes.db`, the FIRST + ONLY visitor-write path on the site.** Kept OUT of
  bible.db (corpus is rebuilt; user data must survive). `core.notes_db()`; tables `users`, `tokens`,
  `notes` (one row per note, keyed by `code = "u<user_id>"`). `views_notes.py` blueprint:
  `/api/auth/signup|login|logout|me|config|google` + `/api/notes/sync` (Bearer token). Passwords
  one-way hashed (werkzeug, ships with Flask). Stay-logged-in = random bearer token in `tokens` +
  browser `localStorage` `lexica.auth.v1`; logout deletes it. Sync = two-way last-write-wins by id.
  Guards: rate limits, size/count caps, parameterized SQL. Tables auto-create (deploy is a normal pull).
  NO email verification, NO password reset yet (reset needs SMTP on PA — not set up).
- **Google sign-in (optional).** `/api/auth/google` verifies Google's signed token (`google-auth`)
  and finds-or-creates the account by email. Shows only when `GOOGLE_CLIENT_ID` is set AND
  `google-auth` is importable — both checked LAZILY in `_google_ready()` so a deploy before setup
  can't break the site (button just stays hidden). See Deployment for the PA setup (it's done + live).
- Gestures (do NOT fight word-click=lexicon / verse-number=TSK): drag-select text → bar with 5 color
  swatches + "Note"; right-click (desktop) / long-press (mobile) a verse number → menu
  (Bookmark · Note · 5 colors). Mobile "Add note" bar pins to screen bottom (clear of the OS
  copy/share toolbar); `selectionchange` backstop. Inline bookmark marker at the start of any verse
  with a record (indents first line only).
- Anchoring is PER READING TEXT and covers non-canon texts too. ABP captures exact word-spots
  (`data-note-pos` on spans, `data-note-verse` on rows); KJV/BSB anchor at the whole verse. Square
  corners + flush chips make a multi-word highlight one continuous bar. Same-anchor reuse (no dupes)
  via `NotesStore.findAnchor`.
- **Highlights paint across ALL translations (verse-level), 2026-06-09.** A highlight shows in ABP,
  KJV, and BSB alike — `chapterNotes` (`forChapter`) gathers every translation's records for the
  book+chapter; `hiForWord` paints EXACT words only in the text it was made in (`n.translation ===
  translation`) and ROUNDS UP to the whole verse in any other translation (words don't line up
  cross-text). The old same-`translation`-only wall is gone. Word-level paint INSIDE KJV/BSB is still
  not a thing (those two only ever paint whole verses) — that's the one open piece.
- **Journal — free-form second note mode (LIVE 2026-06-09).** "Verse notes | Journal" toggle in the
  Notes tab. A journal page is the SAME record shape with `kind:"journal"` + `title` + `body` and NO
  anchor (no `.start`) — plain text, autosaving full-page editor, rides the same store/sync/Export-
  Import. Store: `journals()`, `createJournal()`, `getActiveJournal()`/`setActiveJournal()` (the page
  you last opened, in `localStorage` `lexica.journal.active.v1`), `appendToJournal()`. The merge guard
  lets `kind:"journal"` through without an anchor; `all()` keeps journals OUT of the verse-note list.
  Server per-page cap is bigger for journals (`_MAX_JOURNAL_BYTES` 64KB vs notes' 8KB).
- **Copy + send-verse-to-journal from the reader.** The drag-select bar AND the verse-number menu both
  carry Copy (verse text to clipboard) + Journal (appends `Genesis 1:8 (ABP) — text` — full book name +
  the reading text tagged; parallel reads `ABP/KJV`, non-canon gets no tag — via `journalLine()` in
  60-library.jsx, to the OPEN journal page; if none is open it flashes "Open a journal page first").
  A small `lib-flash` toast confirms. Both menus share ONE left-to-right order — colors · Note · Journal ·
  Copy (· Bookmark on the verse menu only) — keep them aligned if you touch either.
- Files: `static/src/12-notes-store.jsx` (`NotesStore` + sync/auth + journal helpers + `NOTE_COLORS`/
  `NOTE_COLOR_CSS` + `useNotesVersion`), `static/src/35-notes.jsx` (`NoteAddPopover`, `VerseNoteMenu`,
  `NoteColorRow`, `NotesPanel` editor, `JournalView`/`JournalEditor`, `NotesView` tab, `AuthModal`).
  Wiring in `60-library.jsx` (selection, paint, markers, verse menu, copy/journal, `flash`) + `90-app.jsx`
  (`activeNote` + panel + Notes tab). Notes tab: text search + filters (All/Bookmarks/Highlights/Notes)
  + sort (Recent/Reference) + collapsible group-by-book + Export/Import (JSON backup; merge-by-id) +
  the sign-in / sync row + the Journal toggle.

## TSK Cross-Reference Panel
- Endpoint: GET /api/cross-references/curated/<book>/<chapter>/<verse>
- Step 1: Haiku selects 8-10 strongest refs from full TSK list
- Step 2: Sonnet (claude-sonnet-4-6) writes the synthesis — adaptive length (~100-word soft
  ceiling, runs longer for a rich link), anchored in ABP source vocabulary. Prompt carries a
  worked example. (Moved off Haiku 2026-06-09 — ONLY the synthesis is Sonnet; the Step-1 picker
  and every other AI feature stay on Haiku.)
- Cached in ai_search_cache, key prefix `xref_cur:`/`xref_synth:`, ver_key=`xref:<hash>`
  (fingerprint of the two xref prompts — see "AI result cache" below)

## Lexicon Tab
- Dedicated word study tab — separate from AI Search
- Flow: search box → word profile → gloss chips → book distribution → verse list
- Smart search: detects Strong's (G4151, H7307), Greek, Hebrew, English
- Endpoints: `/api/lexicon/lookup`, `/api/lexicon/profile/<strongs>`, `/api/lexicon/verses/<strongs>/<book>`
- `lexicon_verses` response: `{verses: [{chapter, verse, words: [{w, h, i?}]}], glosses: [{gloss, count}]}`
  - `h=true` marks the target word in each verse (rendered highlighted in gold)
  - `glosses` = per-book rendering breakdown (chips update when a book is selected)
  - Optional `?gloss=spirit` param filters verse list to a specific rendering
- Corpus toggle: ABP (LXX OT+NT, G-numbers) | KJV (NT G-numbers, OT H-numbers)
- LexiconView is always-mounted (display:none) so state survives tab switches

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
- Cached in ai_search_cache, ver_key=`search:<hash>` (fingerprint of system prompt + book list +
  `_CACHE_CODE_VER` salt). See "AI result cache" below.

## AI result cache (ai_search_cache) — unified prompt-fingerprint scheme (2026-06-09)
- ALL four AI syntheses cache here (the xref write-up + chapter summary run on Sonnet; book blurb, search, pn stay Haiku) with `ver_key = "<category>:<sha1-of-its-own-prompt>"`:
  `search:` (ai.py), `summary:` (views_summary.py), `xref:` (views_crossref.py), `pn:` (views_metav.py).
  Editing a prompt changes only its category's hash, so just that cache lazily refreshes — no manual
  version bump. (Replaced the old hand-bumped `_SUMMARY_VER` + fixed `"xref"`/`"pn"` literal tags.)
- Shared helpers in core.py: `ai_fingerprint(category, *prompt_parts)`, `ai_cache_get(query, ver_key)`
  (matches on ver_key, so an old-prompt row misses → regenerates), `ai_cache_put`, and
  `ai_cache_prune(category, keep_prefix)` (deletes ONLY that category's stale rows). Each category
  prunes its own at startup (app.py, next to `_load_ai_cache_from_db`).
- The row KEY (`query`) is stable and unique (it's the table's primary key), so regenerating OVERWRITES
  the stale row in place — no parallel old/new rows pile up.
- LANDMINE (fixed): search's startup cleanup used to delete every non-search row except xref/summary BY
  NAME. It's now scoped to `search:%` only — it never touches the other caches. If you add a new AI
  cache category, give it its own `<category>:<hash>` tag + its own startup prune; don't widen another
  category's delete.
- summary rows carry a per-book author suffix: `summary:<tpl-hash>:<author-hash>`. Editing the prompt
  wording refreshes all summaries; editing one book's author in `_BOOK_AUTHORS` refreshes only that book.
- LSJ summaries are NOT in this table (they live in `lsj.summary_json`/`abp_ext.summary_json`), so the
  scheme deliberately skips them.
- One-time deploy note: the first run after this change sweeps the old-format (colon-less) rows via
  `ai_cache_drop_legacy()`, so all previously cached summaries/xrefs/pn/search lazily regenerate once.

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

## MetaV (person/place sidebar)
- Tables: `metav_people` (+_aliases, _groups, _relationships), `metav_places` (+_aliases; has lat/lon, strongs_g)
- Looked up by NAME (not strongs). Frontend fetches person + place in parallel; toggle shown when both exist
- Hebrew proper nouns: route to metaV (person/place) with BDB stacked BELOW (KJV-style). `isHebrewWord` (any H#)
  drives BDB; `isHebrew = isHebrewWord && !isPN` drives the Hebrew hero/LSJ suppression
- Default tab (Phase 6): trusts the word's OWN tipnr type via `pn_types` (a SET — 'person'/'place'/
  'person,place'). A clean single type is authoritative; ambiguous ('person,place', a genuinely shared
  number like Adam H121) or absent pn_types falls back to the strongs_g heuristic (place's G-number
  matching the word's strongs_base — note metav_places.strongs_g only holds G-numbers, so OT/H words
  always fall through to Person unless pn_types pins them). The Person/Place toggle is SUPPRESSED when
  pn_types is a clean single type (the other metaV card is a name-coincidence).
- tipnr schema (Phase 6, backlog #5): `entity_types` column holds the type SET so a strongs shared by a
  person AND a place keeps BOTH (was a PK collision: last-imported type won → Adam H121 read 'place').
  `entity_type` = single primary token (legacy). Migration adds the column at PA startup; re-run
  import_tipnr.py after any rebuild to populate. Old "do NOT trust entity_type" rule is now obsolete —
  pn_types (the set) is trustworthy.
- Gentilics (`/ites?$/`: Hivite, Sinite…): card labeled "People / Clan", place header "Homeland", AI summary
  fires on the clan tab. Kept as persons (Table-of-Nations genealogy is the value; only Jebusite has map coords)
- AI curation: `/api/metav/ai-description/<name>` — Haiku, 1-2 sentences, text-first prompt, cached in
  ai_search_cache (`pn:` key). Fills entries with no metaV/BDB data
- CRITICAL: the lexicon join is `LEFT JOIN lexicon l ON l.strongs_g = w.strongs_base` (Phase 1 indexed key).
  strongs_g only ever holds 'G…', so a Hebrew H-number can never match — this STRUCTURALLY replaced the old
  `SUBSTR(strongs_base,2) ... LIKE 'G%'` guard that a Hebrew H121 used to slip past (bogus Greek G121 lemma
  made the metaV effect early-return and broke Hebrew-PN metaV). Applies to BOTH chapter_text and verse_words

## Maintenance / data-quality scripts
- `scripts/health_check.py <db>` — READ-ONLY scanner; run after ANY import/rebuild. ~14 checks (strongs_base
  invariant, dups, misalignment, fragmented brackets, missing/orphan greek_pos, strongs range, lexicon/bdb
  coverage) + person/place overlap report. Should be 0 warnings
- `fix_greek_pos_gaps.py` / `fix_bracket_gaps_absorb.py` / `fix_orphan_greek_pos.py` / `dedup_words.py` —
  targeted data repairs, all with `--dry-run`. Touch only the named column; never blanket DELETE

## Rate limiting / security (2026-06-07 security pass)
- `core.limiter` (flask-limiter, memory storage): site-wide default `300/min` per endpoint per IP
  (flood backstop on the DB routes); paid AI endpoints set tighter `@limiter.limit("200 per hour")`
  which overrides the default. Static assets exempted via a `request_filter` in app.py (page loads
  never trip it). 429s handled by the errorhandler in app.py.
- AI-generated SQL runs on a READ-ONLY connection (`db_ro`), single-statement, SELECT-only guard;
  failures log the SQL/error server-side ONLY (never returned to the client — info disclosure).
- Verdict: read-only, no-auth, no-PII public app; all user input is parameterized; secrets via .env
  (gitignored); Flask debug off in prod (app.run(debug=True) is local-only). No critical findings.

## Refactor backlog (status 2026-06-07 — redesign Phases 0–6 done)
- See memory `project_architecture_rework.md` and TODO.md. DONE: #1 centralize Strong's handling (Phase 1 —
  `lexicon.strongs_g` join key + frontend `strongsBare`/`strongsTag`); #2 patch-fold (2026-06-09 — the six
  shape-keyed cleanup scripts now run INSIDE build_words_from_abp.py as one self-correcting pass; proven
  byte-identical to the old build+14-patch chain via compare_words.py; see "Words rebuild checklist"); #3
  backend DRY serialization (Phase 2, `_serialize_word_core`); #4 detail-panel state (Phase 4,
  `{hero, sections[]}`); #5 tipnr PK collision (Phase 6, `entity_types` type-set). REMAINING: the
  destructive-DELETE half of #2 stays (copy-first neutralises it — user's call 2026-06-09) and the frontend
  half of #3 (makeEntry/flattenAiResults dedup).

## Do Not
- Do not add KJV as the sole primary study text — ABP remains the anchor
- Do not touch existing ABP tables when adding unrelated features
- Do not commit bible.db to git
- NEVER run `DELETE FROM words` or `DELETE FROM verses` — OT and NT words are both in the words table; clearing destroys hard-to-recover data. If re-importing, use INSERT OR IGNORE (safe to re-run).
- Avoid the full DELETE+rebuild in `build_words_from_abp.py` unless truly necessary. It
  (a) clears `is_pn` and proper-noun Strong's, and (b) historically stripped the G prefix
  off strongs_base. The script is now patched (prefixes at INSERT, prints a reminder), but
  after ANY run you MUST re-run `import_tipnr.py` and verify the strongs_base invariant above.

## Words rebuild checklist (if you ever rebuild the words table)
THE REBUILD IS A SINGLE SELF-CORRECTING PASS (2026-06-09, refactor backlog #2). The build now
applies the six former cleanup scripts ITSELF, per verse, inside build_words_from_abp.py —
bracket_punct → g1473_gloss → lord_subject → funcword_subject → lord_oath → greek_pos backfill
(same relative order the old chain used). On a fresh build those six standalone scripts find 0 to
do. Only the fixes that CAN'T fold (per-verse corrections a global rule would regress, or pinned
source mistags) remain, and they run from ONE tail script. PROVEN: an old-way rebuild (build + the
full 14-patch chain) and the new single pass produced a BYTE-IDENTICAL words table
(`compare_words.py`), validated locally on a copy of live 2026-06-09. See memory
`project_architecture_rework`.

COPY-FIRST, ALWAYS — build on a `cp bible.db bible_test.db` copy; the live bible.db is never the
one rebuilt (DELETE only ever hits the copy). The build also makes its own `bible.db.bak`.

1. Rollback copy: `cp bible.db bible_pre_<reason>_<date>.db`; `cp bible.db bible_test.db`.
2. Rebuild (self-correcting): `python3 scripts/build_words_from_abp.py bible_test.db bh_scrape.db`
   (type 'rebuild'; re-applies the 'G' prefix at INSERT). Needs Rahlfs + TAGNT for pronoun
   correction + morph. Confirm `Words inserted: ~624,575`, `Verses skipped: 0`, ~6,872 flagged.
   FOLDED INTO THIS PASS (no longer separate): bracket_punct (~331v), g1473_gloss (~1,724),
   lord_subject (~795), funcword_subject (~108), lord_oath (29), greek_pos backfill. Already at
   build from before: pronoun correction (Rahlfs/TAGNT), _redistribute_pronoun_compounds,
   _split_compounds, _fix_backwards_pairing (7 number-reversal verses), _split_pn_article_lump
   (Act 19:4). RETIRED long ago: fix_article_noun_swaps.py (deleted).
3. Tail — one command: `bash scripts/finish_rebuild.sh bible_test.db`. Restores proper nouns
   (import_tipnr, ~27,965 matched — the build CLEARS is_pn + PN Strong's) then the PINNED
   data-patches that can't fold, then a final punctuation float. Each only touches its own named
   verses, safe to re-run:
   - fix_subject_reorder (20) / fix_mat25_37 (1) / fix_supplied_attach (5): hand-listed
     synthetic-bracket verses needing per-verse English rewrites no general rule produces.
   - fix_theos_filler_tags (2): Lam 3:16 "and"→καί, 1Pe 1:23 "of God living" split. Pinned.
   - fix_split_merges (237): reorder-MERGE garbles. STAYS A PATCH — the general splitter
     (carry=True in _split_compounds) regresses ~85 other verses, so the provably-clean subset is
     frozen in scripts/split_merge_fixes.json. Regenerate with `_gen_split_candidates.py` ONLY if
     _split_compounds itself changes (it didn't → committed json applies 237/0-skipped).
     (Retiring this via the Rahlfs/TAGNT alignment was viability-checked 2026-06-09 and DECLINED: the
     alignment is Greek-only so it can't replace the English-pairing guess, and a morph filter
     over-blocks 53% of the good fixes — see memory project_architecture_rework #2. Don't re-investigate.)
   - fix_kyrios_mistags (3): Dan 4:19 "and"→καί; "of Cyrus" Dan 11:1/Ezr 5:13 → H3566. Pinned.
   - fix_merge_misses (1): Dan 9:10 hand-verified merge the auto generator misses. Pinned.
   - dedup_words (0 now — Hab 3:14 fixed at source) → fix_bracket_punct ONCE MORE (~202 cells):
     floats a trailing comma left on the verb onto the last chip of the LORD-subject brackets made
     in the pass (e.g. "said · the LORD,"). Runs LAST so it tidies brackets created above; re-run
     settles to 0.
4. PROVE IT (the gate): `python3 scripts/compare_words.py bible.db --compare bible_test.db`.
   Keyed by verse+position over all display columns, bracket-numbering normalised. Expect a small,
   EXPLAINABLE diff vs live (live is older code/data: ~17k english_head head-word drift +
   ~32 newer-TIPNR proper-noun numbers + the 3 Cyrus fixes live lacks — none are errors). For a
   clean [IDENTICAL] readout, compare against an OLD-WAY rebuild instead (stash the build edits,
   rebuild + run the full chain) — that isolates any genuine change introduced by a code edit.
5. Invariant (MUST be 0): `SELECT count(*) FROM words WHERE strongs_base GLOB '[0-9]*'`
6. Audits (the gates), all on bible_test.db: `health_check.py` (0 warnings) → `audit_bracket_order.py`
   (CHIP genuine ≈ 2 = the known Jon 4:9 twin-bracket FPs, not garbles) → `scan_strongs_cross.py`
   (FUNCTION-anchor 0) → `audit_lord_strongs.py` (WRONG-SLOT REPAIRABLE 0) →
   `audit_funcword_wrongslot.py --preps` (REPAIRABLE-NOUN ≈ 0) → `scan_content_filler_tags.py`
   (G2316 0) → `audit_corpus_tier1.py` (A1 ≈ 176) → `audit_corpus_tier2.py bible_test.db --rahlfs
   ~/LXX-Rahlfs-1935 --tagnt ~/TAGNT_*.txt` (~92%).
7. Spot-check: Greek (Eze 31:9 "were jealous of" → ζηλόω), proper noun (1Chr 1:1 "Adam" → H121,
   opens metaV), LORD dual-order (1Ch 13:10 chip → "<verb> · the LORD").
8. Swap + deploy: `mv bible.db bible_pre_<reason>_<date>.db; mv bible_test.db bible.db`; touch wsgi.
LOCAL HARNESS (no PA / no live DB): `tests/test_folded_fixes.py` exercises the six folds on synthetic
rows; `test_build_invariants.py` + `test_strongs_join.py` lock the Strong's invariants (all in CI +
the pre-commit hook). The full rebuild + both-way compare ran locally on a copy 2026-06-09.
FIXED (2026-06-05): Hab 3:14 double-insert. ROOT CAUSE was the ABP source — two byte-identical
`(Hab 3:14)` lines in `abp_texts/abp_ot_texts/abp_habakkuk.txt` (the ONLY duplicated verse marker
in the whole corpus); `iter_verses()`/the build have no per-verse-key dedup, so every rebuild
inserted it twice. Duplicate source line removed → future rebuilds insert it once. Existing live DB
cleaned (without a rebuild) by `scripts/fix_hab314_dupes.py` (scoped to Hab 3:14's verse_id;
collapses dup (verse_id,position) rows to the lowest id). This cleared the lone `misalignment:1`/
`fragmented:1` health warnings + the audit_bracket_order WORDSET hit.
