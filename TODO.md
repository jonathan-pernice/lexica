# TODO

Open work only. Finished and scrapped items (with the gory details) are in [TODO_ARCHIVE.md](TODO_ARCHIVE.md).

Each item ends with a small `code:` line — that's just a pointer for Claude to find the right
spot. You can skip those lines.

---

## Code health / cleanup

The big rework is finished — all six phases are done and live (see
[REDESIGN_PLAN.md](REDESIGN_PLAN.md) and the memory notes). Done: Strong's plumbing centralized +
the fragile join gone (Phase 1); shared word-building code de-duplicated (Phase 2); the giant
`app.py` split into one tidy file per feature (Phase 3); the front end split up and the word pop-up's
tangle of on/off switches replaced with a "decide once, render simply" model (Phase 4); first-paint
speed-ups (Phase 5); and the person/place database quirk fixed so a shared name keeps both types
(Phase 6). A security pass and a code-health pass also ran (2026-06-07): flood protection added, a
minor info leak closed, dead code removed, an unbounded cache capped, an endpoint hardened.

Still open:

1. **Rebuild script is messy.** When the word table is rebuilt, the script wipes everything and
   then runs a long chain of patch scripts to fix it back up. It should be one clean pass that
   gets it right the first time. This is the riskiest part of the codebase to run. (Partly done: the
   safety-check slice is in — the build's own guards are now unit-tested — but the actual one-clean-
   pass rewrite remains. Best done the next time a rebuild is genuinely needed, copy-first.)
   `code: scripts/build_words_from_abp.py + the fix_*.py chain (checklist in CLAUDE.md)`
2. **Two near-identical "build a word entry" functions on the front end.** Leftover from the Phase-4
   rework. They do almost the same thing slightly differently — the kind of drift that caused a
   couple of past bugs. Not broken; worth merging in a dedicated tidy-up.
   `code: makeEntry / flattenAiResults in static/src/00-core.jsx + the inline makeEntry in 60-library.jsx`
3. **More automated checks (optional).** The test net now covers broken pages (snapshot harness) and
   the dangerous data invariants (strongs prefix, tipnr type-set, the build's guards). More rebuild
   guardrails could still be added. `code: scripts/health_check.py, scripts/snapshot_endpoints.py, tests/`

---

## Word click-targets — the article wrong-slot cleanup

Background: this is a precision upgrade, **not a bug** — every verse reads correctly. The issue is
purely about which word you land on when you click. Most of this project is already done and live
(see the archive). One sizeable piece is left:

- **Some nouns are "hidden behind" the word "the".** The Greek word for "the" (the commonest word
  in the text) sometimes carries a real noun's English onto its own slot when that noun's slot was
  left empty — so clicking "son" can open the entry for "the" instead of the entry for "son". The
  catch: "the" legitimately renders as lots of English words too, so a blunt fix would wreck good
  data. Any fix has to carefully separate the genuine cases from the leaked ones first, read-only,
  before changing anything. Highest-volume remaining case. `code: audit "the"/G3588 + preposition
  slots whose word is a concrete/proper noun with an empty slot next to it; method in the archive`
- **A small gray-zone leftover** (~90 adjective/particle cases) and a cosmetic possessive split
  ("your rod" — "your" sits on the noun's slot). Low value, not urgent.

---

## Lexicon tab — finish & polish

You flagged this as under-attended. Start by reading the current code before planning anything.
- Tighten the flow: search → word profile → gloss chips → book distribution → verse list.
- Visual polish — spacing, hierarchy, match the Library reading view; it currently looks unfinished.
- Hunt for dead ends and missing states; decide what "done" looks like.
- `code: LexiconView in static/src/80-lexicon.jsx; /api/lexicon/* in views_lexicon.py; memory project_lexicon_tab`

## AI search — needs a real pass

Also flagged, and a bit orphaned. Revisit the whole thing end to end: are results good, does the
two-box layout (plain search on the left, AI on the right) still make sense, do the result cards
look right? Audit first, then propose.
`code: Search tab in static/src/70-search.jsx; /api/search (views_search.py) + /api/ai-search (ai.py); memory project_ai_search_architecture`

> Note: you revisit these two on your own schedule — Claude shouldn't keep pitching them as "next steps."

## Search results — make them look like the Library

The search result verses don't match the polished Library look. Target: plain word chips in reading
order, no Strong's clutter, brackets kept, gold highlights kept — same as Library's chip mode. Also
stop re-fetching verse words one-by-one; the AI search response can include them since the server
already builds them. (Strong's numbers are already hidden on AI results — that part's done.)

---

## Non-canonical texts (Didache live) — generic "extra texts" plumbing DONE 2026-06-07

The Library can now carry non-canonical texts (Didache first) as their own picks, reached via an
"Other" menu, walled off from Bible search and word counts. ABP stays the anchor. The plumbing is
GENERIC: adding a future text = tag it, drop two json files, add one line to `NONCANON`, load.

**How a text lives:** its own two tables `<book>_words` / `<book>_verses` (never touches the Bible's
tables). Web route `GET /api/extra/<book>/chapter/<n>` reads those. Loader `scripts/load_extra.py
<db> <book> <tagged.json> <english.json>` builds them; safe to re-run.

**Didache data (all in `scripts/didache_proof/`):**
- 16 ch tagged: each Greek word → dictionary form → Strong's → gloss (Tauber's corrected Lake text,
  CC-BY-SA). `didache_tagged_full.json` (2199 words, 2147 Strong's-linked, 52 non-biblical, zero bad
  numbers — `check_didache_tags.py`, read-only).
- `didache_english.json` — our OWN plain English, all 16 ch (0.1 → 16.8, 101 verses), copyright-clean.
- `load_didache.py` — thin wrapper around `load_extra.py` for the Didache (command unchanged).
- `build_proof.py` + `didache_ch1_proof.html` — original standalone proof page.

**Frontend (`static/src/60-library.jsx` + `api.extraChapter` in `00-core.jsx`):**
- `corpus` ("bible" | a `NONCANON` id) is now SEPARATE from `translation` (the abp/kjv/parallel
  layout). "Other ▾" popup (desktop) / "Other texts" sheet row (mobile) + a top-of-nav "Non-canonical"
  group pick the text; picking a Bible book returns to the Bible.
- Reading a non-canonical text: the **Greek interlinear is the normal view** (mirrors ABP — the
  Greek/ABP button). **Parallel** shows Greek interlinear | our readable English, same two-column
  layout as Bible parallel. KJV is disabled there (no KJV for these texts). No bracket/ordering
  machinery; chips stay in natural Greek order; word click → the shared word-study sidebar.

**REMAINING — on PA (user runs):** tables already loaded earlier, so just deploy:
1. `git pull`
2. `touch /var/www/appssanding720_pythonanywhere_com_wsgi.py`
(If ever reloading: `python3 scripts/didache_proof/load_didache.py bible.db` → ~2199 words / 101 verses.)

## Bigger features (someday / ideas)

### Advanced desktop workspace
An opt-in multi-panel layout for wide screens (mobile and normal desktop stay exactly as they are).
Picture: book list on the left, the reading text in the middle, and a right column split into
cross-refs/search/notes on top and the word study (LSJ/BDB/MetaV) on the bottom — all live, no
pop-ups, with draggable dividers that remember their sizes. Full mockup and panel-by-panel spec
kept below.

<details><summary>Full workspace spec</summary>

**Three modes:** Mobile (unchanged) · Desktop basic (unchanged, default) · Desktop advanced
(opt-in toggle in the header, only above ~1100px wide, resizable panels).

```
┌─────────┬──────────────────────────┬────────────────────────┐
│ Books   │                          │  Cross-refs / Search / │
│ (left)  │   Library (center)       │  Notes  (top right)    │
│         │                          ├────────────────────────┤
│         │                          │  Word Study            │
│         │                          │  LSJ / BDB / MetaV     │
│         │                          │  (bottom right)        │
└─────────┴──────────────────────────┴────────────────────────┘
```

- **Left — book/chapter navigator:** always-visible book list (replaces the dropdown); click a book
  to expand its chapters inline (one open at a time); collapsible to reclaim width; on mobile stays
  the current dropdown.
- **Center — Library:** ABP/KJV/Parallel toggle and all current chip/interlinear controls. Word
  click updates the word-study panel in place; verse-number click opens cross-refs in the top-right.
  Chip mode and prose mode (dense, eSword-style inline Strong's superscripts). Parallel mode auto-
  collapses the left nav for width.
- **Top-right — tabs:** Cross-refs (the current TSK panel, today a pop-up) · Search (lexicon + AI
  combined) · Notes (per-verse study notes — future, needs a `notes` table). Default tab: Cross-refs.
- **Bottom-right — word study:** always live, updates on word click; LSJ/BDB/MetaV; replaces the
  pop-up sidebar in this mode.
- **Resizing:** draggable dividers between all panels; sizes saved in the browser.
- **Toggle:** header button switches basic/advanced, remembered in the browser, only shown on wide screens.
</details>

### Topic browser
Browse by concept (Atonement, Covenant, Resurrection, Holy Spirit…) as an alternative to AI search —
a good starting point when you don't know what to search. Use an existing topic list only for the
category *names* (renamed to drop loaded framing); generate the actual verses and summaries ourselves,
Berean-style. Build a quick proof-of-concept with the off-the-shelf topic→verse mappings first to see
if people use it, then swap in our own verse selection. Could be a new tab or a mode inside Search.

### Map tab
Biblical geography as its own tab. Three angles: follow the current chapter and show its places;
search a place and pin every verse that mentions it; or a free-explore world map where clicking a
city opens the MetaV sidebar. The neat version ties maps to the text (e.g. plot every place in Paul's
letters across his journeys) — nobody does this well. Coordinates and the map library are already in
place for the existing place sidebar, so this is smaller than it looks.

### More texts + word grammar (morphology)
- **Word grammar everywhere:** show part-of-speech/tense/case in plain English for every word, from
  free scholarly datasets (CATSS for Greek OT, macula-greek for NT, morphhb/macula-hebrew for Hebrew).
  Some of this already shows for ABP Greek; this would extend coverage. `code: morph column on words`
- **Textus Receptus Greek NT:** add as a second NT text next to ABP. Same Strong's numbering, so it
  plugs in easily, and showing where the two Greek texts differ is genuinely rare and useful.
- **More English translations** (ASV, YLT, Darby, Geneva) as comparison texts — all public domain.
  (ESV is likely licensed — check before importing.)
- **Extra-biblical texts** referenced in scripture (1 Enoch, cited in Jude; Dead Sea Scrolls variants)
  as a separate "Apocrypha" section, never mixed into the canon. Research good digital sources first.
