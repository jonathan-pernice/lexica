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
3. **More automated checks (mostly done).** The test net now covers broken pages (snapshot harness) and
   the dangerous data invariants (strongs prefix, tipnr type-set, the build's guards). 2026-06-07 added
   the automation layer: GitHub auto-runs the tests + frontend build-check on every push (CI), a
   pre-commit hook runs the same checks locally, `scripts/deploy.sh` is a one-command tested deploy, and
   Dependabot watches outside packages. STILL OPEN here: a nightly `health_check.py` email on PA (needs a
   PA scheduled task + email login) — the only piece that has to run against the real database.
   `code: scripts/health_check.py, scripts/snapshot_endpoints.py, tests/, .github/, scripts/githooks/, scripts/deploy.sh`

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

## AI search — needs a real pass

Also flagged, and a bit orphaned. Revisit the whole thing end to end: are results good, does the
two-box layout (plain search on the left, AI on the right) still make sense, do the result cards
look right? Audit first, then propose.
`code: Search tab in static/src/70-search.jsx; /api/search (views_search.py) + /api/ai-search (ai.py); memory project_ai_search_architecture`

> Note: you revisit these two on your own schedule — Claude shouldn't keep pitching them as "next steps."

---

## Non-canonical texts (generic "extra texts" plumbing DONE 2026-06-07)

**STATUS 2026-06-07 — a large library now LIVE** (all in `NONCANON`, auto-loaded by deploy.sh):
- Septuagint Apocrypha (16, English-only), Pseudepigrapha (1-2 Enoch, Jubilees, 2-3 Baruch,
  Apocalypse of Abraham, Assumption of Moses, 2 Esdras/4 Ezra, Life of Adam and Eve, Psalms of
  Solomon, Letter of Aristeas, Ascension of Isaiah, Sibylline Oracles — all English-only),
  Testaments of the Twelve Patriarchs (12, English-only), and the **Apostolic Fathers (14) with
  FULL GREEK INTERLINEAR** (Didache, 1-2 Clement, 7 Ignatius, Polycarp, Mart. Polycarp, Barnabas,
  Diognetus, Shepherd of Hermas).
- Greek-interlinear pipeline = `scripts/apfathers/build_af.py` (+ `build_hermas.py`): Brannan/Lake
  Greek+lemma (CC-BY-SA) → Strong's via openscriptures + Dodson glosses → Lightfoot English.
  Memory `project_noncanonical_texts` has the full recipe + source URLs.
- "Other" picker (desktop dropdown, mobile book-picker, mobile reading-options sheet) all have
  COLLAPSIBLE groups, ordered: Septuagint Apocrypha → Pseudepigrapha → Testaments → Apostolic Fathers.
- **Added 2026-06-07 (English-only, all 7 of the prior shortlist):** 2 Esdras / 4 Ezra (WEB
  Apocrypha), Life of Adam and Eve (Vita, Charles), Psalms of Solomon (Gray), 3 Baruch (Charles),
  Letter of Aristeas (Andrews), Ascension of Isaiah (Charles), Sibylline Oracles (Terry — chapter =
  book, verse = line; books 9 & 10 carry a "no such book" note). Each has its own `parse_*.py` in
  `scripts/apocrypha/`; sources + the per-book parsing quirks are in memory `project_noncanonical_texts`.
- **Possible NEXT** (not started): Book of Jasher (Moses Samuel 1840 — beware the pseudo-Jasher);
  4 Baruch (Paraleipomena Jeremiou); Apocalypse of Zephaniah; Joseph and Aseneth.
- Headings: 1 Enoch, Didache, 2-3 Baruch, Psalms of Solomon, Sibylline Oracles (harvested), and the
  Apostolic Fathers (Hermas section titles) have section headings; the rest could get hand-written
  ones if wanted (user said "later").

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

**DONE on PA 2026-06-07** — reloaded with the `heading` column (`load_didache.py`,
~2199 words / 101 verses / 11 headings). Headings live. The 6 chapters with no heading
(0, 2-4, 10, 12) are intentional — they continue the section a prior chapter started.

**Future (when more non-canonical books exist): wire them into the Lexicon + Search tabs.**
The word panel already shows an "In the Didache" count, but it isn't clickable and the Lexicon/Search
tabs only know the Bible corpus. To let people browse every Didache (or future-book) verse where a
word appears, teach those tabs about the `<book>_words` tables — best done once, generically, as a
"non-canonical corpus" option rather than per book.
`code: views_lexicon.py + LexiconView (80-lexicon.jsx); views_search.py + Search (70-search.jsx)`

### 1 Enoch (English-only) — added 2026-06-07, English-only

Second non-canonical text. R.H. Charles' 1917 translation (public domain, pre-1929), pulled verbatim
from Wikisource's transcription. 108 chapters / 1063 verses / 93 section headings. NO Greek
interlinear — only ~ch 1-32 survives in Greek (Akhmim papyrus), so this is text-only for now;
`enoch_tagged_full.json` is empty `[]` and `enoch_words` loads empty.
- Data + scripts in `scripts/enoch/`: `fetch_charles.py` (caches Wikisource wikitext → raw/),
  `parse_charles.py` (cache → `enoch_english.json` + `enoch_headings.json`, both regenerable),
  `load_enoch.py` (thin wrapper over `load_extra.py`).
- Reader stays in **Prose** via the `englishOnly:true` flag on the `NONCANON` entry (chip/parallel
  views would be blank with no Greek). Drop the flag once a tagged Greek file is added for ch 1-32.
- **DONE + LIVE on PA 2026-06-07** (`load_enoch.py`, 0 words / 1063 verses / 93 headings).
  80 of 108 chapters have a heading; the 28 without continue an earlier section (expected).
- Reader locks to Prose for englishOnly texts; Strong's / Interlinear / Parallel / Chip are
  grayed out (desktop bar + mobile sheet). Mobile pill shows the `abbr` ("1En" / "Did").

### Lessons from Didache → Enoch (baked into the tooling)

1. **The extra-text reader now serves text-only books.** The endpoint built its verse list ONLY from
   the words table, so an English-only text returned nothing. Fixed in `views_library.py`: the list is
   now every verse that has words OR English. Didache output unchanged.
2. **`englishOnly` flag** on a `NONCANON` entry forces Prose so the reader doesn't open on an empty
   interlinear. Set it for any future text loaded without an original-language tagging.
3. **Harvest headings from the source, don't hand-write them.** Didache headings were written by us;
   for a sourced text like Charles, its own `=== … ===` section titles are pulled in automatically
   (`harvest_headings` in parse_charles.py) — faster and more faithful.

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

### Highlighting + notes (Logos-style)
Let a reader drag-select text, pick a color to highlight it, and attach a note. The trick Logos uses:
the highlight isn't stored *inside* the text — it's a separate layer that *points at* a word range
(book/chapter/verse + word position, which we already track). So the same highlight shows up in any
view/translation, and all notes live in one searchable Notes panel (filter by color, tag, book; click
to jump back). Maps cleanly onto our word-position data. Needs somewhere to keep the notes — the
browser's local storage (one device only, no login) for a quick version, or real accounts (below) to
sync across devices. `code: new notes store keyed to words-table positions; render layer paints matches`

**Browser-first is NOT throwaway — notes migrate cleanly to a login later** if two things are done up
front: (1) store the browser notes in the EXACT same shape the server will use (the word-position
anchor), so moving them up is a straight copy, not a conversion; (2) give each note its own id when it's
CREATED, not when it's saved — so "already uploaded" vs "new" is obvious, two devices merge without
duplicates, and a half-finished upload is safe to re-run. Then adding accounts = a one-time "found N
notes on this device, save them to your account?" handoff. Build browser-only now, design the note's
shape as if the login already exists, and nothing is wasted.

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
