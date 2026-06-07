# Lexica Redesign — phased plan

Whole-arc plan for the front-end + back-end rework. Started 2026-06-06.
Sequenced by **risk and dependency**: safety net → high-leverage data fixes → structure → perf → schema/tests.
Each phase ships independently on the normal deploy (`git pull && touch wsgi`).

**Honest framing:** the server is already fast (TTFB ~90ms — the speed win was the build step,
see memory `project_frontend_build_step`). This redesign is about **bug density and
maintainability** (faster, safer changes going forward), not a visible speed jump. Phases 1–4
are the substance; 0 enables them; 5–6 are cleanup.

**Constraint that shapes everything:** the DB (`bible.db`) is PA-only; no local app today
(CLAUDE.md: "never query/test against a local DB"). See Phase 0b — whether to relax that for
read-only code testing is a real decision that affects how every later phase is verified.

---

## Phase 0 — Safety net  ⬅ START HERE
Refactoring ~7,000 lines with no tests + deploy-and-eyeball is how regressions slip in.

- [x] **0a — live-endpoint snapshot/diff harness** (`scripts/snapshot_endpoints.py`): DONE
  2026-06-06. 25 deterministic `/api/...` endpoints; `--capture`/`--compare`/`--update`. Golden
  baseline captured from live in `tests/snapshots/` (pre-refactor). `--compare` verified 25/25 OK.
  Pairs with existing `health_check.py` (data) + the browser perf-trace/screenshot (frontend).
  NOTE: with no local server, this verifies POST-deploy (catch + roll back), not pre-deploy.
- [x] **0b — local read-only DB copy** — DONE 2026-06-06. User chose this (safest). bible.db (251MB)
  downloaded to repo root (git-ignored via *.db). Local env: `.venv` (Flask + deps, git-ignored),
  app runs `python app.py` on localhost:5000, boots fine with NO Anthropic key (AI endpoints just
  return 500, not tested). **Loop PROVEN: local app vs live golden = 25/25 byte-identical.** So
  refactors are now verified BEFORE deploy. GUARDRAILS: never upload the local DB; never run
  rebuild/`fix_*` scripts against it; re-download only if PA data changes. (The startup migration
  is an idempotent no-op on a current DB — that's why the file isn't OS-locked.)
- Risk: none (read-only).
- **Pre-deploy verify loop (use for every later phase):** edit code → (app.py auto-reloads in debug)
  → `.venv\Scripts\python scripts/snapshot_endpoints.py --base http://127.0.0.1:5000 --compare`
  → 0 diffs → push → deploy → `--compare` against live to confirm.

## Phase 1 — Centralize Strong's handling  *(backlog #1 — the headline)* — ✅ DONE + LIVE 2026-06-06 (28/28 vs live)
The fragile pattern behind 4+ past bugs: `SUBSTR(strongs_base, 2)` joins + hardcoded `G{...}`.
- [x] Real JOIN KEY: added indexed `lexicon.strongs_g` (= 'G'||strongs) via _migrate_db (idempotent).
- [x] Replaced all 13 real `SUBSTR(...,2)` joins (ABP + KJV families) with `l.strongs_g = w.strongs_base`
  / `lex.strongs_g = ks.strongs_id`. Structurally immune to the digit-shave (592k) AND H→G bugs.
  The 3 copies inside the AI system prompt LEFT AS-IS (still valid; changing them alters AI output +
  busts the prompt cache, unverifiable locally without a key — separate follow-up).
- [x] Frontend: added `strongsBare()`, routed the 3 rogue `G${...}` spots through it / `strongsTag()`.
- [x] Test: `tests/test_strongs_join.py` (in-memory sqlite, no DB dep) locks the invariant + documents
  both old bugs. Passes.
- [x] Verified: local `--compare` 28/28 byte-identical (incl. new /api/search + /api/lexicon/english).
- Why: highest bug-prevention value; also lets the lexicon join use an index.
- Risk: medium (data-read paths) — Phase-0 snapshots made it safe. **Deploy note:** migration runs at
  PA startup (touch wsgi) BEFORE any query, so no missing-column window.

## Phase 2 — DRY word serialization  *(backlog #3)* — ✅ BACKEND DONE (local, 28/28); frontend → Phase 4
`/api/chapter` vs `/api/verse-words` drifted (the `is_pn` bug).
- [x] Backend: `_serialize_word_core(row)` builds the 11 shared fields ONE way; chapter_text /
  verse_words / _fetch_verse_words each spread it + add their own extras. Byte-identical (snapshots
  sort keys, so order is irrelevant; values + key-set unchanged). 28/28 local.
- [ ] Frontend factories (makeEntry / flattenAiResults / renderCorpusWord / kjvEntry) → folded into
  Phase 4 (they take genuinely different inputs + it's UI-risk with no snapshot coverage; the detail
  panel is reworked there anyway).
- KNOWN drift left byte-identical (deliberate, surface in Phase 4): `italic` is a raw int in
  chapter_text but bool in the other two; `is_content` (verse_words) vs `is_function` (_fetch) are the
  same data, opposite polarity. Normalizing these changes the contract → do it with the frontend.
- Why: pairs with Phase 1 (same paths); kills a bug class.
- Risk: low (byte-identical).

## Phase 3 — Split `app.py` into modules  *(DESIGNED 2026-06-06, not yet executed)*
3,660-line monolith → domain modules over a shared core. **Pure move, no behavior change** —
every step gated by local `--compare` 0 diffs + the app still booting.

### Approach: Flask Blueprints + a shared `core.py`
- `core.py` — app-independent shared layer: `db()`, `db_ro()`, `_migrate_db()`, `_strip_accents`,
  `_word_boundary_match`, `_strongs_num`, `_serialize_word_core`, `_clean_gloss`, the `_anthropic`
  client, `_FUNCTION_STRONGS` (+ builder), and `limiter = Limiter(... )` created WITHOUT an app
  (wired later via `limiter.init_app(app)`). No imports of any view module → no circular imports.
- One module per domain, each a `Blueprint` (`@bp.route`, `@limiter.limit` import limiter from core):
  - `views_library.py` — chapter_text, verse_text, verse_words, books_list
  - `views_kjv.py` — kjv_* routes + `_kjv_strongs_search`, `_kjv_word_search`
  - `views_lexicon.py` — lexicon_* + `_normalize_gloss` (+ `_hebrew_search`*)
  - `views_lsj.py` — lsj_lookup, lsj_summary, bdb_lookup + LSJ helpers (`_resolve_lsj_xref`,
    `_SectionParser`, `_format_lsj_context`, `_is_lsj_*`, `_lsj_concept_lookup`)
  - `views_search.py` — search()  (*shares `_hebrew_search`/`_kjv_strongs_search` → put shared
    search helpers in core or a small `search_util.py`)
  - `views_crossref.py` — cross_references_route, cross_ref_synthesis, cross_refs_curated
  - `views_metav.py` — metav_*, pn_count, strongs_count_route
  - `ai.py` — ai_search + `_get_ai_system`, `_curate_primary_verses`, `_enrich_*`,
    `_normalize_union_sql`, the AI cache (`_ai_cache`, load/persist/ver), `_AI_SYSTEM_TMPL`,
    `_CURATION_SYSTEM`, `_extract_proper_nouns`
- `app.py` becomes a THIN entry: `from core import ...`; `app = Flask(__name__)`;
  `limiter.init_app(app)`; register all blueprints; run startup (`_migrate_db()`,
  `_build_function_strongs_cache()`, `_load_ai_cache_from_db()`); keep index route + asset
  context_processor + 429 handler. **PA wsgi is UNCHANGED** — `app` is still importable from app.py.

### Gotchas to handle (these are the real risk, not the moving)
1. **`_FUNCTION_STRONGS` is REASSIGNED at startup** (`global _FUNCTION_STRONGS; ... = func`, line ~1010).
   After a split, `from core import _FUNCTION_STRONGS` binds the empty set at import time and never sees
   the reassignment → function-word filtering silently breaks across search/lexicon. FIX: mutate in
   place (`_FUNCTION_STRONGS.clear(); _FUNCTION_STRONGS.update(func)`). (`_ai_cache` is already
   in-place-mutated, so it's fine.) The snapshot loop WOULD catch this (search results would differ).
2. **Startup order** — migrate/build-cache/load-cache must run in app.py AFTER blueprints register.
3. **limiter** decoupled from app (init_app) so view modules can import it without importing app.
4. **Shared helpers** used by 2 domains (`_hebrew_search`, `_kjv_strongs_search`) → live in core/shared.
5. The 3 leftover `SUBSTR` examples in the AI prompt move with `ai.py` (still the Phase-1 follow-up).

### Execution order (incremental — commit + `--compare` 0-diff after EACH)
1. [x] **DONE 2026-06-06** — Created `core.py` (DB, db/db_ro, limiter [init_app], _anthropic, log,
   _strip_accents, _word_boundary_match, _strongs_num + _STRONGS_RE, _serialize_word_core, _clean_gloss,
   _FUNCTION_STRONGS set). app.py imports from core; `_build_function_strongs_cache` now mutates the
   set IN PLACE (clear+update). Booted + 28/28 byte-identical. (Startup fns _migrate_db /
   _build_function_strongs_cache / _load_ai_cache_from_db kept in app.py — only primitives moved.)
2. [x] **DONE 2026-06-06** — Extracted all 8 leaf-first domains, one blueprint per commit, local
   `--compare` 28/28 after each: **metav → crossref → lsj/bdb → kjv → lexicon → library → search → ai**
   (commits cb98724 → 473fb1d). `core.py` also gained the shared `_KJV_BOOK_ID/_REV` + `_ai_cache`.
   `app.py` is now a ~260-line thin shell (was 3,577): imports core, registers the 8 blueprints, runs
   the 3 startup steps, keeps index + asset processor + 429 handler. The function-word classifier stays
   in app.py (startup-populates core._FUNCTION_STRONGS in place). Dead code (`_enrich_*`, `_SectionParser`,
   `_hebrew_search`) moved with its domain per plan. Pushed to origin; **awaiting PA deploy + live --compare**.
- Est: ~8–10 small verified commits; a focused session.
- Why: half of "the jumble"; done after 1+2 so we file away clean code.
- Risk: low logic risk but wide — snapshots + local boot verify every step.

## Phase 4 — Split `app.jsx` + fix detail-panel state  *(backlog #4)* — ✅ DONE 2026-06-06 (pushed; deploy pending)
3,461-line file → per-view files (build step makes this clean). `DetailPanel`'s tangle of flags
→ one computed `{hero, sections[]}` descriptor, rendered dumbly.
- [x] **4.1 — split** (commit 2246bda): `static/app.jsx` → 10 files in `static/src/`
  (00-core, 10-icons, 20-shared-components, 30-detail-panel, 40-crossref-panel,
  50-corpus-results, 60-library, 70-search, 80-lexicon, 90-app). Build is now
  `npm run build` → `scripts/build-frontend.js` (Node): concat src/*.jsx (filename order)
  into ONE unit → Babel → static/app.js. Concat-before-compile emits the spread helper once
  and rebuilt app.js BYTE-IDENTICAL to committed (one stray CRLF-in-comment → LF). Old
  app.jsx removed. Verified visually: Genesis 1 identical, word click → panel ok.
- [x] **4.2 — DetailPanel descriptor** (commit 79170d1): render from `hero` (resolved fields)
  + ordered `sections[]` (→ `sections.map(renderSection)`) + `useKjvText`, all computed once.
  JSX bodies verbatim; hooks/effects byte-identical (lines 1-230 unchanged). Verified visually
  (no frontend diff-gate): θεός (person+morph+LSJ-suppressed+occ+verse), ποιέω (LSJ+tabs+AI),
  bârâ/KJV (RTL hero+BDB+kjvOcc+KJV verse), Eden (Hebrew-PN place: name hero + metaV place map
  + AI desc + BDB stacked), Lexicon search, Library prose. No console/key warnings.
- Why: the other half of the jumble; several past UI bugs lived here.
- Risk: medium (UI) — screenshots + click-through verified.

## Phase 5 — Perf polish (the remaining ~748ms first paint) — ✅ DONE 2026-06-06 (pushed; deploy pending)
Measured first (Chrome DevTools trace, local app serving committed app.js). The
cache-independent finding: the first-paint critical path had **7 render-blocking
requests, 4 of them cross-origin unpkg** (leaflet.js, leaflet.css, react,
react-dom). Locally those are warm/fast (~25ms each) so warm-local LCP barely
moves (chapter render dominates); the real cold-visitor cost is the cross-origin
handshakes + Leaflet parse — that's the bulk of the live ~748ms render delay.
- [x] **Defer non-critical startup fetches — ALREADY SATISFIED (confirmed by trace).** The
  only mount fetches are `/api/books` + `/api/chapter/Gen/1` (LibraryView) — exactly the
  default view. Nothing else fires; no deferral needed.
- [x] **Lazy-load Leaflet** (commit 0a804d2): removed leaflet.css/js from `<head>`; added
  `loadLeaflet()` in `static/src/20-shared-components.jsx` that injects them on first
  `LeafletMap` mount (cached on `window.L`). Verified: absent on load, loads on first place
  card (Eden), map renders with tiles + marker.
- [x] **Self-host React/ReactDOM** (commit 2c0c26c): vendored React 18.3.1 prod UMD into
  `static/` (SHA-384 verified identical to the old unpkg SRI), loaded same-origin via
  `asset_url`. Critical path no longer touches unpkg at all. Verified: app mounts, panels work.
- [x] **`LexiconView`/`Search` on load — measured cheap, intentionally NOT changed.** Both
  mount hidden but run ZERO fetches on mount (effects all guarded) and render trivial empty
  states; the expensive views (CorpusResults, DetailPanel) aren't mounted at start. Lazy-mounting
  would risk the state-survival caveat (CLAUDE.md) for negligible gain. Left as-is by design.
- Verified: local snapshot 28/28; visual click-through (Eden place card map, θεός LSJ panel) clean,
  no new console errors (the H5731 LSJ 404 is pre-existing Hebrew-PN BDB-fallback behavior).
- Risk: low, frontend-only. **DEPLOYED + LIVE 2026-06-06.** Live traces confirmed the structural win:
  critical-path render-blocking cross-origin unpkg requests **4 → 0** (react/react-dom now same-origin,
  leaflet gone). Head-to-head fetch shows PA ≈ unpkg for transfer (self-host saves a cold cross-origin
  handshake + drops the third-party-CDN dependency). FCP (first paint) ~410–540ms cold post-deploy.
  NOTE: the LCP element is the Gen-1 chapter text, gated by `/api/chapter/Gen/1`, whose PA server time
  swings wildly (cold worker post-`touch wsgi` ~1006ms; warm ~240ms) — so single-trace LCP is
  server-bound noise, NOT the frontend. The next *speed* lever is the chapter API / PA tier.

## Phase 6 — Schema + tests  *(backlog #5, #6)* — ✅ CODE DONE (pushed); needs PA re-import to activate
- [x] **Fix `tipnr.strongs` PK collision** (backlog #5). `tipnr.strongs` is a PK +
  `INSERT OR REPLACE`, so a name that is BOTH person AND place under one Strong's number
  (Adam H121) collapsed to whichever row imported LAST → `entity_type`/`pn_type` lied.
  - **Chose a type-SET column, NOT a composite key:** `views_library` does
    `LEFT JOIN tipnr ON t.strongs = w.strongs_base`; a composite `(strongs,entity_type)`
    would make that join one-to-many and DUPLICATE every Adam word row in the chapter
    render. New `tipnr.entity_types` keeps ONE row per strongs with the set ('person,place').
  - **Migration** (`_migrate_db`, commit): idempotent `ALTER TABLE tipnr ADD COLUMN
    entity_types`. Additive, never touches `words`/`is_pn`. Makes the column EXIST so the
    deployed code can `SELECT` it BEFORE the PA re-import runs (NULL until then → frontend
    falls back to the old heuristic → **deploy order is safe, no regression window**).
  - **`import_tipnr.py`**: `parse_tipnr` aggregates per-strongs into a type set
    (`entity_types` = sorted set; `entity_type` = single primary token person>place>other).
  - **API**: `chapter_text`/`verse_words` expose `pn_types` alongside legacy `pn_type`.
  - **MetaV frontend**: default person/place tab now prefers the word's OWN `pn_types` (a
    clean single type is authoritative); falls back to the `strongs_g` heuristic for
    ambiguous `person,place` (which strongs alone can't disambiguate — Adam, Dan) or absent
    `pn_types`. *Honest outcome:* `entity_types` REFINES the decision, it doesn't fully
    replace the heuristic — the shared-strongs cases are irreducibly ambiguous.
  - **Data finding that shaped this:** `metav_places.strongs_g` only ever holds G-numbers,
    so the old heuristic could never match an OT word's H-number → OT proper nouns always
    defaulted to Person. The `pn_types` signal is what lets a place-only OT strongs pick Place.
- [x] **Test net** (backlog #6): `tests/test_build_invariants.py` (in-memory sqlite, no DB
  dep) — strongs_base prefix invariant + gate-catches-a-bare-base, kjv_strongs prefix,
  tipnr type-set keeps both types & 1:1 join, and the real `parse_tipnr` aggregation.
- **Local verify:** snapshot 28/28 (the 7 ABP word goldens re-baselined with the additive
  `pn_types`; metav person/place snapshots UNCHANGED — views_metav not touched);
  `health_check.py` 0/0; both test files pass.
- Risk: low (additive). **PA STEPS (run after `git pull && touch wsgi`):**
  1. Rollback copy: `cp bible.db bible_pre_tipnr_typeset_20260607.db`
  2. Re-run the proper-noun import to populate `entity_types`:
     `python3 scripts/import_tipnr.py bible.db` (rebuilds tipnr from source; the migration
     already added the column at startup). It prints the MULTI-type collision count.
  3. `python3 scripts/health_check.py bible.db` — overlap report; expect 0 warnings.
  4. Spot-check live: an OT word that is a place but also a person name should now default
     to the correct tab; Adam (shared H121) still defaults to Person via the heuristic.

---

### Phase 0b decision detail — local read-only DB copy
- **For:** the only way to catch a backend regression BEFORE it hits the live site; makes every
  later phase dramatically safer; trivial for the user (DC/Linux) to copy a DB file down.
- **Against / why the rule exists:** risk of accidentally making DATA changes locally, or trusting
  a stale copy and missing PA-only indexes. Mitigation: treat the local copy as STRICTLY read-only
  (open `mode=ro`), refresh it from PA before each refactor session, and keep all DATA changes
  PA-only as today. Code-only testing, never data writes.
- **Relation to WSL:** a local app would run fine on native Windows (Flask + Python); WSL only
  matters if we want a Linux-identical runtime — not required for this.
