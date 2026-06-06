# Lexica — CLAUDE.md

## Overview
Lexica is a Flask-based Greek and Hebrew Bible word study app. ABP (Apostolic Bible Polyglot) interlinear is the primary text; KJV is a fully searchable parallel corpus. The design is scholarly but accessible — no prior Greek training required.

## Instructions for Claude Code
(Account: user is on the Max 20x plan — ample headroom. Bias to being THOROUGH and
CORRECT over conserving tool calls. The notes below are about staying focused and
keeping context sharp, NOT about rationing usage.)
- Target the specific function/section relevant to the task — for focus, not frugality
- Prefer not to read all of app.py / app.jsx in one shot (they're huge — it dilutes
  context); read the relevant region(s), but read as many as correctness needs
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
- `words` — ABP word-level interlinear, Strong's tagged. Columns: english, english_head, strongs, strongs_base, greek_pos, bracket_id, italic, italic_words, smcap_words, is_pn. NO greek/lemma column — the Greek lemma is joined live from `lexicon` via `LEFT JOIN lexicon l ON l.strongs = SUBSTR(w.strongs_base, 2)` (this is why strongs_base MUST stay G/H-prefixed). `is_pn=1` marks proper nouns (set by import_tipnr.py). Planned: add `morph` column (MorphGNT/CATSS)
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

## strongs_base format — CRITICAL INVARIANT
- `words.strongs_base` is fully G/H prefixed ('G4151', 'H7307') — normalized 2026-06-01
- This is NOT cosmetic: the lexicon join does `SUBSTR(w.strongs_base, 2)` to strip the
  prefix. A BARE strongs_base ('4151') makes SUBSTR shave a DIGIT instead → wrong lemma.
  (2026-06-03: a rebuild left 592k bare → G2206 ζηλόω rendered as ἄκρον/G206. Fixed by
  `UPDATE words SET strongs_base='G'||strongs_base WHERE strongs_base GLOB '[0-9]*'`.)
- `words.strongs` (the other column) is intentionally LEFT BARE ('2206', dotted '2321.1');
  the frontend renders it as `G{strongs}`. Only strongs_base carries the prefix.
- `kjv_strongs.strongs_id` is also fully prefixed (was always so)
- Always use single-match in SQL: WHERE w.strongs_base = 'G4151'
- After ANY words-table rebuild, verify: `SELECT count(*) FROM words WHERE strongs_base GLOB '[0-9]*'` must be 0
- AI system prompt may still reference old triple-match — update if issues arise

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

## MetaV (person/place sidebar)
- Tables: `metav_people` (+_aliases, _groups, _relationships), `metav_places` (+_aliases; has lat/lon, strongs_g)
- Looked up by NAME (not strongs). Frontend fetches person + place in parallel; toggle shown when both exist
- Hebrew proper nouns: route to metaV (person/place) with BDB stacked BELOW (KJV-style). `isHebrewWord` (any H#)
  drives BDB; `isHebrew = isHebrewWord && !isPN` drives the Hebrew hero/LSJ suppression
- Default tab = Person; flips to Place only on a prefix-exact match of the word's strongs_base to the place's
  strongs_g. **Do NOT trust `tipnr.entity_type`/pn_type** — tipnr.strongs is a PK, so person+place sharing one
  strongs (Adam H121='place') stores the last-imported type
- Gentilics (`/ites?$/`: Hivite, Sinite…): card labeled "People / Clan", place header "Homeland", AI summary
  fires on the clan tab. Kept as persons (Table-of-Nations genealogy is the value; only Jebusite has map coords)
- AI curation: `/api/metav/ai-description/<name>` — Haiku, 1-2 sentences, text-first prompt, cached in
  ai_search_cache (`pn:` key). Fills entries with no metaV/BDB data
- CRITICAL: the lexicon join is `LEFT JOIN lexicon l ON l.strongs = SUBSTR(w.strongs_base,2) AND w.strongs_base
  LIKE 'G%'`. The `LIKE 'G%'` guard is REQUIRED — without it a Hebrew H121 matches Greek G121 and gets a bogus
  Greek lemma (which made the metaV effect early-return and broke Hebrew-PN metaV). Applies to BOTH chapter_text
  and verse_words

## Maintenance / data-quality scripts
- `scripts/health_check.py <db>` — READ-ONLY scanner; run after ANY import/rebuild. ~14 checks (strongs_base
  invariant, dups, misalignment, fragmented brackets, missing/orphan greek_pos, strongs range, lexicon/bdb
  coverage) + person/place overlap report. Should be 0 warnings
- `fix_greek_pos_gaps.py` / `fix_bracket_gaps_absorb.py` / `fix_orphan_greek_pos.py` / `dedup_words.py` —
  targeted data repairs, all with `--dry-run`. Touch only the named column; never blanket DELETE

## Refactor backlog
- See memory `project_architecture_rework.md` and TODO.md "Code Health" section. #1 (centralize Strong's-number
  handling — kill `SUBSTR(strongs_base,2)` joins + hardcoded `G{...}`) is the highest-leverage rework

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
COPY-FIRST: validate on a `cp bible.db bible_test.db` build + `audit_bracket_order.py` BEFORE
the real rebuild. The build also makes its own `bible.db.bak`. Keep a dated rollback copy.
1. Rollback copy: `cp bible.db bible_pre_<reason>_<date>.db`
2. Rebuild: `python3 scripts/build_words_from_abp.py bible.db bh_scrape.db` (type 'rebuild';
   re-applies the 'G' prefix at INSERT). Needs Rahlfs + TAGNT present for pronoun correction.
   Confirm `Words inserted: ~624,591`, `Verses skipped: 0`.
3. Restore proper nouns (rebuild CLEARS is_pn + PN Strong's): `import_tipnr.py bible.db` (~94%)
4. Repair chain — ORDER MATTERS (these WRITE by default; `--dry-run` previews):
   `fix_bracket_punct` → `fix_subject_reorder` → `fix_mat25_37` → `fix_supplied_attach` →
   `fix_g1473_gloss bible.db --apply` (note: this one needs `--apply`) →
   `fix_lord_subject` (dual-ordering pilot #1; runs LAST so it sees clean data + bracket_punct
   has already run on source brackets). Sanity counts: bracket_punct ~331v, subject_reorder 20,
   supplied_attach 5, g1473 ~1724, lord_subject ~795. After lord_subject, verify
   `audit_lord_strongs.py bible.db` shows WRONG-SLOT REPAIRABLE = 0 (was ~795).
5. Gap-fixers (clear the standard post-rebuild health warnings; `--dry-run` first):
   `dedup_words` (exact-dup rows) → `fix_greek_pos_gaps` (bracketed NULL greek_pos).
6. Invariant (MUST be 0): `SELECT count(*) FROM words WHERE strongs_base GLOB '[0-9]*'`
7. Audits (the gates): `health_check.py` (≤ minor warnings) → `audit_bracket_order.py`
   (CHIP genuine ≈ 0; ~8 twin-bracket WORDSET false positives are a KNOWN audit-matcher
   limitation, not garbles) → `audit_corpus_tier1.py` (A1 ≈ 176 baseline) →
   `audit_corpus_tier2.py bible.db --rahlfs ~/LXX-Rahlfs-1935 --tagnt ~/TAGNT_*.txt` (~92%).
8. Spot-check: Greek (Eze 31:9 "were jealous of" → ζηλόω), proper noun (1Chr 1:1 "Adam" →
   H121, opens metaV), bracket order (1Ch 15:13 chip → "cut through · and the LORD · our God").
9. Deploy (touch wsgi).
FIXED (2026-06-05): Hab 3:14 double-insert. ROOT CAUSE was the ABP source — two byte-identical
`(Hab 3:14)` lines in `abp_texts/abp_ot_texts/abp_habakkuk.txt` (the ONLY duplicated verse marker
in the whole corpus); `iter_verses()`/the build have no per-verse-key dedup, so every rebuild
inserted it twice. Duplicate source line removed → future rebuilds insert it once. Existing live DB
cleaned (without a rebuild) by `scripts/fix_hab314_dupes.py` (scoped to Hab 3:14's verse_id;
collapses dup (verse_id,position) rows to the lowest id). This cleared the lone `misalignment:1`/
`fragmented:1` health warnings + the audit_bracket_order WORDSET hit.
