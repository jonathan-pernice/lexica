# TODO

## Code Health & Refactor Backlog (from 2026-06-03 deep-debug session)

Ranked by bug-prevention value. App works today — these are where the bug density is.
Full detail + bug evidence in memory `project_architecture_rework.md`. **#1 and #2 are ~80% of the value.**

1. **Centralize Strong's-number handling** (DO FIRST — root of 4+ bugs today). One canonical
   module (backend + frontend): `{prefix, number, dotted}` + parse/format + a real JOIN KEY.
   Kill every `SUBSTR(strongs_base, 2)` join and every hardcoded `G{w.strongs || w.strongs_base}`.
   Today's evidence: the 592k bare-prefix break + the Hebrew-PN spurious-Greek-lemma (H121→G121).
2. **Rebuild pipeline**: `build_words_from_abp.py` does `DELETE`+rebuild then a fleet of
   `fix_*` patches. Make it one authoritative idempotent pass that uses ABP position numbers
   for greek_pos/bracket (as its own docstring already says — the code does the opposite).
3. **DRY word serialization**: `/api/chapter` vs `/api/verse-words` drifted (is_pn missing in
   chapter → broke Library metaV). One `_serialize_word()` backend + one `makeWordEntry()` frontend.
4. **Detail panel state model**: too many interacting flags (isPN/isHebrew/isHebrewWord/
   isGentilic/personOk/metavType…). Compute one `{hero, sections[]}` descriptor, render dumbly.
5. **Schema**: `tipnr.strongs` is a PK → person+place sharing one strongs (Adam H121) collapses
   to one type; `pn_type` is untrustworthy as a result. Composite key / type-set.
6. **Tests**: extend `scripts/health_check.py` (data-quality) with code-level tests around the
   Strong's module (#1) and build invariants (#2). Currently it's deploy-and-eyeball.

### Maintenance / data-quality scripts (2026-06-03)
- `health_check.py` — READ-ONLY scanner, run after any import/rebuild (currently 0 warnings)
- `fix_greek_pos_gaps.py` — backfill greek_pos for split bracket words
- `fix_bracket_gaps_absorb.py` — absorb glossless gap words into surrounding bracket
- `fix_orphan_greek_pos.py` — null greek_pos on non-bracket words
- `dedup_words.py` — remove exact-duplicate rows
- All have `--dry-run`. Post-rebuild checklist is in CLAUDE.md.

## _split_compounds demonstrative over-reach — "this/that of X" (queued 2026-06-04)

`_split_compounds` pulls a word out of an already-correct multi-word gloss into a
following empty slot and FRONTS it (position swap). For a front determiner this is
right ("the LORD", "their gatherings" — split off "the"/"their" → correct). But when
the matched word sits AFTER a kept word (esp. a preposition), fronting reorders wrongly:
- Jer 32:14 source `of this possession!G2934.3 G3778` → DB renders "the scroll **this of
  possession**" (should be "of this possession"); "this"(οὗτος) pulled into G3778 + fronted.
- Gen 2:12 "of that land" → "that of land" (same, ἐκεῖνος).
Facet (a) already fixes the copula sub-case (skip εἰμί/G1510 as a target).

ATTEMPT 1 REVERTED (2026-06-04): a morph-POS gate skipping ALL pronoun/article/
demonstrative (CATSS R*) target slots. Build+diff vs live showed it changed **11,036
verses / 34,032 slots** — it correctly stopped "this/that of X" BUT also bundled the
beneficial re-separation of "the"/"their"/"her"/"my" determiners corpus-wide ("the LORD"
→ one chip, article G3588 emptied; reading unchanged but loses the separate clickable
article/possessive). Target-POS can't tell "front determiner (split it)" from "middle
word after a preposition (don't front it)". Commits 924f53c+bdd11d4 reverted.

REAL FIX (next attempt): key on **gloss word-order**, not target POS — only redistribute
+front a word that is the LEADING run of the gloss (no kept "own" word precedes it). That
allows "the LORD"/"their X" (determiner first) and blocks "of **this** possession" / "he
**is** a prophet" (kept word precedes). CAVEATS to validate before trusting it: (a) I did
NOT fully verify `_split_compounds`'s swap direction during attempt 1 — STUDY the swap
(L~299) + how it inherits src_bid/greek_pos before changing it; (b) check object-fronting
cases (object glossed at END, e.g. "[²hatred ¹I will put]") aren't regressed; (c) MANDATORY
build-to-`bible_test.db` + diff-vs-live + eyeball (the 11k blast radius makes --test on a
few verses insufficient). Live (rebuild #6) is correct and untouched — this is the only
remaining symptom-#2 facet. Also relates to the ABP eSword re-source idea
(project_abp_esword_fidelity) since the source itself bundles these glosses.

## LSJ coverage audit — generalize the pronoun-stub fix (queued 2026-06-04)

Inflected Greek forms whose dictionary headword is a *different* word have no own LSJ key,
so `/api/lsj` falls through to the terse Strong's gloss (e.g. σέ → "thee"). 2026-06-04 we
fixed the personal-pronoun families by adding 11 "v. <base>" stub rows to `lsj`
(σέ/ὑμεῖς/ὑμᾶς/ὑμῖν/ὑμῶν→σύ; μέ/μοί/μοῦ→ἐγώ; ἡμᾶς/ἡμῖν/ἡμῶν→ἡμεῖς) — see memory
`project_pronoun_fix_path_c.md` (LSJ note). That was SCOPED to those forms only.

This task = the corpus-wide version:
- AUDIT: for every distinct `lexicon.lemma` the `words` table actually uses (G-numbers),
  check whether it resolves in `lsj` (exact `key`, accent-strip via `plain` =
  `lower(strip_accents(lemma))`, or an existing "v. X" xref stub) vs falls to the Strong's
  gloss. List the misses by frequency. NOTE: `strip_accents` is an app-registered SQLite
  fn (not in the bare CLI) — run the audit via a small read-only Python script using the
  app's `db()` connection (or replicate NFD-strip in Python).
- FIX only the misses that are an **inflected form of an existing LSJ headword** — add a
  `<b>FORM</b>, v. <i>BASE</i>.` stub with `plain=lower(strip_accents(FORM))`, exactly like
  the σέ fix; the generic `_resolve_lsj_xref` then follows it. Likely paradigms still
  unaudited: αὐτός obliques (αὐτόν/αὐτοῦ/αὐτῷ/αὐτήν…), demonstratives (οὗτος/τοῦτον/ἐκεῖνος),
  relatives (ὅς/ὅν/οὗ/ᾧ), reflexives (ἑαυτοῦ/σεαυτοῦ/ἐμαυτοῦ), interrogative/indefinite (τίς/τινος).
- DO NOT stub genuinely-absent rare words (no base headword exists) — they correctly keep the
  Strong's gloss. No code change, no rebuild — pure `lsj` data (idempotent INSERT OR IGNORE).

## Priority: Lexicon tab & AI corpus search (ORPHANS — need a focused pass)

Two areas the user flagged as under-attended and needing real attention. **Start each by
AUDITING the current implementation before planning** — neither was deeply reviewed in the
2026-06-03 session, so read the code first and propose a plan.

### Lexicon tab — finish & polish
- Nail down the workflow: search box → word profile → gloss chips → book distribution → verse list
- "Make it pretty" — visual polish, hierarchy, spacing; align with the Library reading-view standards
- Finish it out — find incomplete states, dead ends, missing affordances; decide what "done" means
- Code: `LexiconView` in app.jsx (always-mounted, `display:none`); endpoints `/api/lexicon/lookup`,
  `/api/lexicon/profile/<strongs>`, `/api/lexicon/verses/<strongs>/<book>`; corpus toggle ABP|KJV
- Cross-check memory `project_lexicon_tab.md`

### AI corpus search — needs attention
- Genuinely orphaned; revisit the whole flow end-to-end (quality, UX, layout)
- Audit: result quality, the lexicon-vs-AI two-input split (does it still serve?), result-card rendering
- Code: Search tab in app.jsx; `/api/search` (returns abp/kjv results+groupings+variants); AI mode uses
  Haiku Berean prompt, key_strongs chips, empty-result retry, Hebrew bridge, corpus filters
- Related work already specced below in "Search Layout Revamp" (bare-chip verse rendering, N+1 fetch fix)
- Cross-check memory `project_ai_search_architecture.md`

## Advanced Workspace Layout (major feature)

### Spec

**Three layout modes:**
- **Mobile** — current Lexica unchanged. Tap-to-open sidebar overlay.
- **Desktop basic** — current Lexica unchanged. Default for desktop.
- **Desktop advanced** — multi-panel workspace. Opt-in via toggle in the header. Minimum viewport width gate (e.g. 1100px). User-resizable panels via draggable dividers (clean implementation only).

**Panel layout:**

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

**Left panel — Book/Chapter Navigator:**
- Always-visible book list (replaces dropdown)
- Click a book → chapter numbers expand inline below it (accordion)
- Only one book expanded at a time
- Collapsible on desktop (narrows to icons or hides) to reclaim center width
- On mobile: hidden, existing dropdown stays

**Center panel — Library:**
- ABP / KJV / Parallel toggle, all existing chip/interlinear controls
- Word click → updates Word Study panel in place (no overlay)
- Verse number click → opens Cross-refs tab in top-right panel
- Full height, scrollable
- **Reading modes:**
  - *Chip mode* — current default, all words individually clickable
  - *Prose mode* — dense reading view, inline Strong's superscripts (eSword-style), no stacked interlinear
  - Interlinear toggle (Greek row on/off) available in chip mode
- **Parallel mode** — auto-collapses left nav to give center panel full width; user can re-expand manually

**Top-right panel — tabs: Cross-refs | Search | Notes**
- **Cross-refs**: existing TSK curated panel (currently opens as overlay)
- **Search**: lexicon browse + AI search combined, toggle between them inside the tab
- **Notes**: personal study notes per verse (future — needs `notes` DB table)
- Default tab: Cross-refs

**Bottom-right panel — Word Study:**
- Always live, updates on word click from Library
- LSJ, BDB, MetaV — same content as current sidebar
- Replaces the overlay sidebar entirely in advanced mode

**Resizing:**
- Draggable vertical divider between left nav and center
- Draggable vertical divider between center and right panels
- Draggable horizontal divider between top-right and bottom-right
- Sizes persist in localStorage

**Toggle:**
- Header button (e.g. ⊞ icon) switches between basic and advanced
- State persists in localStorage
- Only shown above minimum viewport width

## Search Layout Revamp (plan together)
- Overall search layout needs optimizing — spacing, hierarchy, result cards
- Audit whether library display improvements (verse numbers neutral, interlinear hierarchy, gold overuse) carried over to search result verses — likely they did not since search uses different component classes
- Align search verse rendering with library standards where appropriate
- **✓ AI search verse display** — Strong's numbers hidden (`display:none`). Word tokens kept for gold highlights and word clicks.
- **Search verse rendering direction** — target is "bare chips": word tokens in source order, no Strong's, no interlinear Greek row, brackets preserved, gold highlights intact. Matches Library chip mode visually. Backend: eliminate N+1 `api.verseWords` fetches by including full verse word lists in the AI search response (currently re-fetched even though `_fetch_verse_words` already ran server-side).

## ✓ Text Structure Session — DONE

### ✓ Pericopes / Section Headings
`pericopes` table created and populated (2431 headings, full canon). Backend: `chapter_text()` LEFT JOINs pericopes, folds `heading` into verse object. Frontend: `renderVerse()` injects `.pericope-heading` div before verse when heading is present. Works in chip, prose, and parallel (ABP column only). Note: Song of Solomon has 0 headings — BibleHub doesn't carry them; not a bug.

### ✓ Prose Mode — Continuous Flow
Non-poetry books wrap as a single flowing paragraph in prose mode with inline verse-number superscripts. Poetry books (Psa/Pro/Job/Son/Lam/Ecc) keep line-per-verse. `renderProseWords()` helper shared by both paths.

### ✓ Font Size Preference
A−/A+ in desktop lib-bar and mobile modes sheet. `--lib-font-size` CSS custom property on `.lib-reading`. Persisted in localStorage. Defaults: 15px mobile / 18px desktop. Range 13–24px.

## Planned Features

### ✓ Prose Reading Mode — DONE
Chip/Prose toggle live. Prose renders clickable inline word spans, no chip borders. Continuous flow and poetry detection complete (Text Structure Session).

### Morphology Display
Show grammatical parsing (case, tense, number, etc.) in the word click sidebar in plain English: "Verb · Aorist · Active · Indicative · 3rd Person · Singular". Morphological data source: MorphGNT (NT) + CATSS/CCAT (LXX OT) — needs import into a `morph` column on the `words` table.

### Parallel Mode Versification Alignment
ABP follows LXX verse numbering (Psalms especially can be off by 1 from KJV). In Parallel mode, mismatched verses currently show blank on one side. Need to: (1) audit how bad the mismatch is in practice, (2) decide whether to offset-map or leave gaps.

## MetaV

### ✓ People & Places — DONE
People sidebar (bio, relationships, genealogy), places sidebar (Leaflet map, coordinates), proper noun routing in both ABP and KJV. All live.

### ✓ Hebrew PN + gentilic handling — DONE (2026-06-03)
- Hebrew proper nouns route to metaV (person/place) with BDB stacked below (KJV-style); badge shows real H-number.
- Person/place default: Person, flips to Place only on a prefix-exact strongs_g match (pn_type untrusted — tipnr PK collision).
- Gentilics (-ite/-ites: Hivite, Sinite…): labeled "People / Clan", place card headed "Homeland", AI summary fires on the clan tab.
- AI curation (`/api/metav/ai-description`, Haiku, cached `pn:` key, text-first prompt) fills groups with no metaV/BDB.

### Topic Index
Browse by concept (Atonement, Covenant, Resurrection, Holy Spirit etc.) as a structured alternative to AI search. Good entry point for users who don't know what to search for.

**Approach:** use MetaV topic *names* only as a category scaffold — throw away their verse mappings entirely (MetaV topics reflect evangelical Protestant systematic theology, which conflicts with the Berean approach). Generate all content ourselves:
- Topic names: MetaV `Topics.csv` as a starting list, curated/renamed to remove theologically loaded framing
- Verse selection: our own Strong's-driven corpus query per topic
- Synthesis: Haiku with Berean system prompt, anchored in ABP vocabulary

Could be a fourth nav tab or a browse mode within Search.

**Implementation order:** use MetaV topic-to-verse mappings as-is for POC — validate the UX and feature usage first. Once proven, swap in our own Strong's-driven verse selection and Haiku synthesis. No point building the full pipeline before the feature is validated.

## Map Tab

Biblical geography as a dedicated tab. Three modes worth exploring:

- **Passage-driven** — follows library navigation; shows relevant places for the current chapter
- **Search-driven** — search a place name, map zooms and pins every verse that mentions it
- **Exploration mode** — full map of the biblical world; click a region/city to get the MetaV sidebar with verse references

**Data:** MetaV coordinates already exist and Leaflet is already imported for the MetaV place sidebar — the jump to a full tab is smaller than it looks.

**Interesting angle:** tie it to the text, not just static geography. E.g. plot all places mentioned in Paul's letters across his journeys. Nothing else does this well.

**Placement:** fourth nav tab, or a view toggle inside Library alongside Chip/Prose.

## Library Expansion (texts + morphology)

### Morphology Data Sources

One dataset per language, accessed via two paths (ABP direct / KJV via kjv_strongs):

| Source | Language | Covers |
|---|---|---|
| [CATSS](http://ccat.sas.upenn.edu/gopher/text/religion/biblical/lxxmorph/) | OT Greek (LXX) | ABP OT words directly |
| [macula-greek](https://github.com/Clear-Bible/macula-greek) | NT Greek | ABP NT words directly; KJV NT via kjv_strongs |
| [macula-hebrew](https://github.com/Clear-Bible/macula-hebrew) or [morphhb](https://github.com/openscriptures/morphhb) | Hebrew (MT) | KJV OT via kjv_strongs |

**Access paths:**
- ABP OT word click → CATSS morphology
- ABP NT word click → macula-greek morphology
- KJV OT word click → macula-hebrew/morphhb via kjv_strongs
- KJV NT word click → macula-greek via kjv_strongs (same dataset, different path)

**Notes:**
- CATSS is tagged against Rahlfs LXX, not ABP directly — expect versification mismatches similar to the BH alignment problem; position-based alignment should work
- morphhb is more mature/battle-tested than macula-hebrew for basic morphology display; macula-hebrew is richer if deeper linguistic analysis is ever wanted
- All stored in a `morph` column on `words` table (ABP path) or looked up by Strong's number (KJV path)

### Textus Receptus (TR) NT Integration
Public domain Greek NT, same Strong's numbering as ABP so word study infrastructure works without changes. Implementation: add as a NT text toggle alongside ABP (ABP | TR). Use case: textual criticism — ABP and TR diverge in a few hundred NT places, showing differences side by side is uniquely valuable. No free tool does this well. Needs a tagged TR source — Robinson-Pierpont Byzantine text has community Strong's tagging.

### Additional Bible Texts (scrollmapper/bible_databases)
- Large collection of public domain translations in structured formats
- Evaluate: ASV, YLT, Darby, Geneva 1599 as scholarly comparison texts
- ESV: check licensing — likely restricted, confirm before importing
- Each additional translation needs its own word-level table if interlinear is wanted, or verse-level only for parallel reading

### Deuterocanonical / Pseudepigrapha
- **1 Enoch** — referenced in NT (Jude 1:14-15); available in public domain English translations
- **Dead Sea Scrolls** — partial OT texts with textual variants; check what structured digital editions exist
- These would be a separate "Apocrypha" section, not mixed into canonical OT/NT
- Research available structured sources before committing to import
