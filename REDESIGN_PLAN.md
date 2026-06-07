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

## Phase 2 — DRY word serialization  *(backlog #3)*
`/api/chapter` vs `/api/verse-words` drifted (the `is_pn` bug). Frontend mirrors it.
- [ ] One `_serialize_word()` backend; one `makeWordEntry()` frontend.
- Why: pairs with Phase 1 (same paths); kills a bug class.
- Risk: low-medium.

## Phase 3 — Split `app.py` into modules
3,660-line monolith → domain modules/blueprints (library, lexicon, search/ai, metav, crossref,
kjv) over a shared `db` + `strongs` core. **Pure move, no behavior change.**
- Why: half of "the jumble"; done after 1+2 so we file away clean code.
- Risk: low logic risk but wide — snapshots verify.

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
