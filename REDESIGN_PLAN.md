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
1. Create `core.py`, move the shared layer, app.py imports it (incl. the `_FUNCTION_STRONGS` in-place fix). Boot + 28/28.
2. Extract leaf domains first (least entangled → confidence): **metav → crossref → lsj/bdb → kjv → lexicon → library → search → ai**. One blueprint per commit, `--compare` each.
- Est: ~8–10 small verified commits; a focused session.
- Why: half of "the jumble"; done after 1+2 so we file away clean code.
- Risk: low logic risk but wide — snapshots + local boot verify every step.

## Phase 4 — Split `app.jsx` + fix detail-panel state  *(backlog #4)*
3,461-line file → per-view files (build step makes this clean). `DetailPanel`'s tangle of flags
→ one computed `{hero, sections[]}` descriptor, rendered dumbly.
- Why: the other half of the jumble; several past UI bugs lived here.
- Risk: medium (UI) — screenshots + click-through verify.

## Phase 5 — Perf polish (the remaining ~748ms first paint)
- [ ] Defer non-critical startup fetches; lazy-load Leaflet (maps only).
- [ ] Stop `LexiconView`/`Search` doing work on load (mounted hidden today).
- [ ] Optional: self-host React to drop the unpkg dependency.
- Risk: low, frontend-only.

## Phase 6 — Schema + tests  *(backlog #5, #6)*
- [ ] Fix `tipnr.strongs` PK collision (person+place sharing one number → composite key/type-set).
- [ ] Extend the test net around build invariants.
- Risk: low (additive).

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
