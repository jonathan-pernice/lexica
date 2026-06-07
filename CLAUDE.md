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
- Deploy command (UNCHANGED): `cd ~/bible-db && git pull && touch /var/www/appssanding720_pythonanywhere_com_wsgi.py`
- PythonAnywhere git is configured: `pull.rebase false`, `merge.autoedit no` (no prompts)
- Database is NOT in git (too large) — managed directly on PythonAnywhere

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
  `lexicon.strongs_g` join key + frontend `strongsBare`/`strongsTag`); #3 backend DRY serialization (Phase 2,
  `_serialize_word_core`); #4 detail-panel state (Phase 4, `{hero, sections[]}`); #5 tipnr PK collision
  (Phase 6, `entity_types` type-set). REMAINING: #2 destructive-rebuild→patch pipeline → idempotent single
  pass (only the CI-lock slice done — `_prefix_base` lifted + tested; the upsert/patch-fold needs a copy-first
  PA rebuild to validate) and the frontend half of #3 (makeEntry/flattenAiResults dedup).

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
   `fix_lord_subject` (dual-ordering pilot #1) →
   `fix_funcword_subject bible.db --include-idioms --include-bracketed` (dual-ordering #2 rounds
   1+2+3; both run LAST so they see clean data + bracket_punct has already run on source brackets).
   RETIRED: `fix_article_noun_swaps.py` (deleted) — both jobs are now done AT BUILD inside
   build_words_from_abp.py: `_fix_backwards_pairing()` self-corrects the 7 number-reversal verses
   (God↔θεός 1Sa 5:2/Rom 8:34 + 5 "a <noun>" prep cases 1Pe 5:12/2Co 8:10/Eph 3:3/Mat 26:44/Zec 8:13;
   evidence-driven over the scan_strongs_cross fingerprint), and `_split_pn_article_lump()` splits the
   Act 19:4 "Jesus the" lump into two chips ("Jesus" on the `*` slot + "the" on G3588, dual-order
   bracket). Both validated to touch exactly their target verses corpus-wide and nothing else; no manual
   step needed. Verify with `scan_strongs_cross.py bible.db` (FUNCTION-anchor 0) and
   `preview_split.py Act 19 4`.
   Sanity counts: bracket_punct ~331v, subject_reorder 20, supplied_attach 5, g1473 ~1724,
   lord_subject ~795, funcword_subject ~108 (21 nouns + 75 idiom + 12 plural/in-bracket; without the
   flags it's just the 21). After lord_subject, verify `audit_lord_strongs.py bible.db` shows
   WRONG-SLOT REPAIRABLE = 0 (was ~795). After funcword_subject, `audit_funcword_wrongslot.py bible.db
   --preps` REPAIRABLE-NOUN drops to ~0 (only the REPAIRABLE-OTHER adj/particle gray zone remains by
   design). The in-bracket relocations carry greek_pos → audit_bracket_order stays at baseline.
   Then `fix_theos_filler_tags bible.db --apply` — repairs 2 rows where θεός/G2316
   landed on a filler word in the ABP source (Lam 3:16 "and" → καί/G2532; 1Pe 1:23
   genitive split "of God living" → move "God" onto the θεός chip). Pinned to exact
   verse+position+value, so safe to re-run. Verify with
   `scan_content_filler_tags.py bible.db` (G2316 → 0 rows).
   Then `fix_split_merges bible.db --apply` — repairs ~237 reorder-MERGE garbles
   where two source words got crammed on one chip and the verb's chip left blank
   ("I see magistrates" with ὁράω/G3708 empty → "I see"|"magistrates"; "they know
   not" → verb freed). Applies the VETTED list in scripts/split_merge_fixes.json,
   each pinned to verse+position+strongs+english (safe to re-run). WHY a data-patch
   not a build fix: the splitter assigns English by lexicon-text match, too leaky to
   fix this class globally without regressing ~85 verses (article/copula). The fix
   logic exists in _split_compounds behind `carry=` (DEFAULT False — a rebuild is
   unchanged); only scripts/_gen_split_candidates.py runs it with carry=True to
   REGENERATE the json (then keeps only provably-clean results). Regenerate the json
   after a rebuild, then apply.
   Then `fix_lord_oath bible.db --apply` — repairs the 29 "As the LORD lives" oath
   verses (chay-YHWH) where the reorder put "As" on κύριος/G2962 and "the LORD
   lives" on ζάω/G2198. Moves "the LORD" onto κύριος (→ "As the LORD" | "lives,").
   Detects the pattern in-DB (no list), pinned to it, safe to re-run.
   Then `fix_kyrios_mistags bible.db --apply` — 3 stray κύριος/G2962 source mistags:
   Dan 4:19 "and" → καί/G2532; "of Cyrus" (Dan 11:1, Ezr 5:13) → H3566 proper noun
   (Κύρου looks like κυρίου). Pinned, safe to re-run.
   Then `fix_merge_misses bible.db --apply` — hand-verified merge fixes the auto
   generator can't catch (verb in a word-FORM the lexicon match misses, e.g. Dan
   9:10 "hearkened" vs dict "hearken"). Embedded list, added one at a time, pinned.
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
