# TODO

Open work only. **Completed & scrapped items (with full method notes) are in [TODO_ARCHIVE.md](TODO_ARCHIVE.md)** — moved there 2026-06-06.

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

## ★ DUAL-ORDERING — remaining wrong-slot work

Pilots #1 (κύριος-subject) and #2 (function-word nouns, rounds 1–3, 108 fixes) are **DONE + LIVE**;
#3 (wrapped verb-gloss insert) was **SCRAPPED**. Full writeups + the proven method/constraints are in
[TODO_ARCHIVE.md](TODO_ARCHIVE.md). The dual-ordering mechanism is proven; what's left:

- **G3588 article / preposition wrong-slot partition (BIGGEST remaining source)** — flagged 2026-06-06
  via the Lexicon "rendered as" panel. G3588 ὁ "renders as" a huge list: most is LEGIT (the 46979;
  substantival ones/one/things/he/she/that/who/both; oblique-case article carrying the case's English
  prep — to/in/with/of/for/by/against), but the tail is BUNDLING ARTIFACTS — concrete/proper nouns
  leaked onto the article slot when their OWN Strong's slot was left empty (son 206, god 5, lord 1,
  jesus 2, wisdom 2, israel/uriah 1, covenant/sacrifice/blood/name/word/stone/gates…). Clicking "son"
  opens the ARTICLE, not υἱός/G5207. SAME family as pilot #1, onto function words — highest-VOLUME
  source (G3588 is the commonest word). The hard part is the DISCRIMINATOR: legit one-Greek-many-English
  (neuter substantival "things"/"ones", oblique-prep) vs many-Greek-collapsed (concrete noun bundled,
  own slot empty). A blanket "article = only 'the'" rule would DESTROY real Greek — the read-only audit
  must PARTITION first. Start by auditing G3588 (and prep) slots whose english_head is a concrete/proper
  noun with an adjacent empty content slot. Use the archived KICKOFF METHOD / CONSTRAINTS.
- **~90 REPAIRABLE-OTHER gray zone (#4, deferred)** — adjective/particle wrong-slot cases left after
  #2 rounds 1–3, plus a few semantic synonym misses. Lower yield, not urgent.
- **Facet (b) — possessive split** ("your rod": "your" rides the noun slot, σου empty). Cosmetic,
  lowest priority; the last untouched symptom-#2 facet.

## Priority: Lexicon tab & AI corpus search (need a focused pass)

Two areas the user flagged as under-attended. **Start each by AUDITING the current implementation
before planning** — read the code first and propose a plan.
(NOTE: user revisits these on their own timeline — do not proactively re-pitch as "next steps"; memory
`project_pending_improvements`.)

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
  Haiku Berean prompt, key_strongs chips, empty-result retry, Hebrew bridge, corpus filters.
  (Pass-1 + retry system prompts ALREADY have cache_control:ephemeral — app.py ~3257/3373.)
- Related work specced below in "Search Layout Revamp"
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
- ✓ AI search verse display — Strong's numbers hidden (`display:none`); word tokens kept for gold highlights and word clicks. (done)
- **Search verse rendering direction** — target is "bare chips": word tokens in source order, no Strong's, no interlinear Greek row, brackets preserved, gold highlights intact. Matches Library chip mode visually. Backend: eliminate N+1 `api.verseWords` fetches by including full verse word lists in the AI search response (currently re-fetched even though `_fetch_verse_words` already ran server-side).

## MetaV

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
