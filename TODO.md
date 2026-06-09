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
2. ~~**Two near-identical "build a word entry" functions on the front end.**~~ **DONE 2026-06-08**
   (commit `007446c`). The three copy-pasted builders now share one core: `entrySnum()` +
   `wordEntryCore()` in static/src/00-core.jsx; makeEntry, flattenAiResults, and the library
   makeEntry each spread the core and add only their own id + extras. No behavior change. Closes
   the frontend half of refactor backlog #3.
3. **More automated checks (mostly done).** The test net now covers broken pages (snapshot harness) and
   the dangerous data invariants (strongs prefix, tipnr type-set, the build's guards). 2026-06-07 added
   the automation layer: GitHub auto-runs the tests + frontend build-check on every push (CI), a
   pre-commit hook runs the same checks locally, `scripts/deploy.sh` is a one-command tested deploy, and
   Dependabot watches outside packages. STILL OPEN here: a nightly `health_check.py` email on PA (needs a
   PA scheduled task + email login) — the only piece that has to run against the real database.
   `code: scripts/health_check.py, scripts/snapshot_endpoints.py, tests/, .github/, scripts/githooks/, scripts/deploy.sh`
4. **Unify the AI prompt STYLE into one shared "house style" snippet.** (The cache-fingerprint half
   of this item is DONE 2026-06-09 — see TODO_ARCHIVE.md. This is the leftover paired half.) Every
   blurb should share one house-style snippet (plain language, short one-idea sentences, no run-ons,
   no jargon; NEVER cap by sentence count — that makes Haiku cram events into run-ons; instead let
   LENGTH FIT THE CONTENT — short/simple gets a sentence or two, dense gets more — and don't pad or
   cram). Put the snippet in `core.py`; each prompt = its own task + its own soft CEILING (not a fixed
   target: chapter ~150w, xref shorter, person/place shorter still) + the shared snippet. Now that the
   caches are fingerprinted, editing the shared snippet auto-refreshes every cache for free — that's why
   this was paired with the cache work. DONE 2026-06-09: cross-ref moved off the "3-sentence" cap to
   adaptive length (and onto Sonnet — see memory project_ai_synthesis_quality), and the chapter summary
   was further tightened (track the arc, not a line per section; ~150w / never >200). STILL OPEN:
   person/place ("1-2 sentences") still caps by sentence count, and the central SHARED snippet in core.py
   was never built — xref and chapter each carry their own adaptive wording. Next lever if huge chapter
   summaries still run long on Haiku: move the chapter summary to Sonnet too (same one-line swap as xref).
   NOTE: changing these prompts is exactly what the
   new fingerprint scheme watches, so each edit will lazily refresh that category's cache (expected).
   `code: shared snippet in core.py; views_crossref.py system prompts; views_metav.py _PN_SYSTEM;
   views_summary.py _SUMMARY_SYSTEM/_*_TMPL; ai.py LSJ prompt in views_lsj.py`

---

## New features

- ~~**Notes feature.**~~ **DONE 2026-06-09** (notes + highlights). Browser-only study notes &
  color highlights in the Library; drag-select or right-click/long-press a verse number; Notes tab
  with search + Export/Import backup. Browser-local (`localStorage`), no DB/login — built in the
  migration-ready shape for a future account. See TODO_ARCHIVE + memory `project_notes_highlights`.
  Open follow-ups: cross-translation highlight paint, word-level highlights in KJV/BSB, notes on the
  non-canon texts, Notes-tab filters (color/book).
- ~~**BSB (Berean Standard Bible).**~~ **DONE 2026-06-08.** Public-domain modern reading text
  alongside ABP/KJV. Loaded by `scripts/load_bsb.py` into `bsb_verses`; served by `views_bsb.py`
  (`/api/bsb/chapter`). Added as a third reading text in the Library toggle (commit `4c88501`), and
  an eSword-style in-text search box in the Library that searches whichever text you're reading via
  the generic `/api/text-search` (commit `05fe6d5`). No word-level/Strong's data by design.

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

## Lexicon tab — done; ongoing polish only

Essentially finished. Leave as a small footnote: tweak spacing/hierarchy as you notice rough edges,
nothing structural left. `code: LexiconView in static/src/80-lexicon.jsx; /api/lexicon/* in views_lexicon.py`

## AI search — almost done; ongoing dev

Mostly there. Leave as a footnote: keep refining results quality and the result cards as you use it;
nothing structural blocking. `code: Search tab in static/src/70-search.jsx; /api/search (views_search.py) + /api/ai-search (ai.py); memory project_ai_search_architecture`

> Note: you revisit these on your own schedule — Claude shouldn't keep pitching them as "next steps."

---

## Non-canonical texts — library DONE + LIVE; a few open scraps

The whole non-canonical library is built, loaded, and live: Septuagint Apocrypha, Pseudepigrapha,
and the Testaments of the Twelve Patriarchs (all English-only), plus the 14 Apostolic Fathers with
full Greek interlinear. The full build record — pipeline, sources, per-book quirks, the Didache/Enoch
details, and the lessons learned — lives in memory `project_noncanonical_texts` and TODO_ARCHIVE.
Only the genuinely open items are kept below.
- **Possible NEXT** (not started): Book of Jasher (Moses Samuel 1840 — beware the pseudo-Jasher);
  4 Baruch (Paraleipomena Jeremiou); Apocalypse of Zephaniah; Joseph and Aseneth.
- Headings: most books have section headings (harvested from source); the rest could get hand-written
  ones if wanted (later).

**Open: wire non-canonical texts into the Lexicon + Search tabs.**
The word panel already shows an "In the Didache" count, but it isn't clickable and the Lexicon/Search
tabs only know the Bible corpus. To let people browse every Didache (or future-book) verse where a
word appears, teach those tabs about the `<book>_words` tables — best done once, generically, as a
"non-canonical corpus" option rather than per book.
`code: views_lexicon.py + LexiconView (80-lexicon.jsx); views_search.py + Search (70-search.jsx)`

### KNOWN GAP — Hebrew/Aramaic interlinear for a non-canonical text

The extra-text **interlinear** is hard-wired to Greek: the endpoint joins `lexicon` on a G-number
(`l.strongs_g = w.strongs`), and the reader's word click routes to LSJ. English-only loads are
language-agnostic (Enoch's source is Ge'ez and it loaded fine — we only store English + headings),
so the source language ONLY matters if we want a word-by-word original. For a Hebrew interlinear
(e.g. Ben Sira/Sirach, which has real Hebrew; or Jubilees' Qumran Hebrew fragments) we'd need: BDB
join on H-numbers in `/api/extra`, BDB/Hebrew routing + right-to-left chips in the reader. Not urgent
— no Hebrew non-canonical is queued, and any of them can ship English-only today.

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

### Highlighting + notes (Logos-style) — CORE DONE 2026-06-09, follow-ups open
Notes + color highlights are LIVE (browser-local, word-position anchor, drag-select + verse-number
gestures, Export/Import backup). See TODO_ARCHIVE + memory `project_notes_highlights`. What's left:
- **Cross-translation paint** — a highlight made in ABP doesn't show in KJV/BSB (word positions
  differ per text). Today paint is matched to the text it was made in.
- **Word-level highlights in KJV/BSB** — they anchor at the whole verse for now (no `data-note-pos`).
- **Notes on the non-canon texts** (Enoch, Didache…) — their verse rows aren't tagged yet.
- **Notes-tab filters** — by color and by book; maybe group-by-book.

### Free user accounts
Sign-up-yourself free accounts. Main payoff is syncing highlights/notes across a reader's devices, and
it opens the door to an email campaign later (announcements, reading plans). We're currently a no-login
public app, so this is real new plumbing (sign-up, login, password reset, a users store) — bigger lift,
worth it once Notes proves people want their work saved. Keep the app fully usable without an account.

### Broader AI search — meaning-based passage search
Logos feels "broader" for two reasons: it reads their whole paid library (commentaries, dictionaries),
and it blends exact-word search with meaning-based search. We deliberately stay text-first (bible +
lexicons only), so we won't copy the library part. But we *can* add meaning-based search over the bible
text itself — find verses that are *about* a concept even when they don't use the word — which gives the
"broad" feel while staying inside scripture. `code: Search tab + /api/search; would need a concept index`

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

### Dead Sea Scrolls — wanted, but the hardest one (why it's still not done)
Deliberately skipped so far, not an oversight. The blockers are real:
- **No public-domain English exists.** The readable translations everyone cites (Vermes,
  Wise-Abegg-Cook, García Martínez) are all modern and copyrighted — nothing free to drop in the way
  Charles/Lightfoot/Brenton were. What IS free is photos + academic transcriptions (Leon Levy digital
  library), not a ready-to-read English text.
- **The scrolls are mostly Hebrew/Aramaic fragments** — broken, gap-ridden, not a clean verse-by-verse
  book. And our interlinear is wired for Greek (G-numbers); a Hebrew original-language view needs the
  BDB / H-number / right-to-left plumbing flagged as the known gap above.
- **The realistic angle isn't "another book to read" — it's a compare view.** The Great Isaiah Scroll
  (1QIsaa) is complete and famous, and its value is showing WHERE it differs from the standard Hebrew
  (Masoretic) text. That's a side-by-side "variants vs the MT" feature, bigger and different from the
  apocrypha plumbing. Best first step if/when we tackle it. `code: would need a clean PD/licensed
  transcription + a verse-aligned variant layer, not the load_extra path`
