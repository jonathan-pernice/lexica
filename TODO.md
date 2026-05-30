# TODO

## Advanced Workspace Layout (major feature)

Desktop-only multi-panel workspace mode, alongside the existing single-focus layout. Three modes total:
- **Mobile** — current Lexica (reader + tap-to-open sidebar). No changes needed.
- **Desktop basic** — current Lexica. Default.
- **Desktop advanced** — resizable multi-panel workspace. Minimum viewport width gate.

Panels for advanced mode (based on eSword reference layout):
- Book/chapter navigator (persistent left sidebar, currently a dropdown)
- Bible text panel (center, full interlinear with inline Strong's)
- Cross-references panel (top right)
- Dictionary/lexicon panel (bottom right, currently opens as overlay sidebar)
- Notes panel (personal study notes per verse — new feature, needs DB table)

Draft a written spec of panel combinations and behavior before implementing. Feed spec + styles.css + app.jsx to Claude for design/implementation plan.

## Quick Wins

### AI: Prompt Caching
Add Anthropic `cache_control` to the system prompt. Biggest cost lever — system prompt is long and constant across every request.

### AI: System Prompt Improvements
- Avoid circular definitions (don't use the English gloss to define the word)
- Front-load concrete/relational meanings before abstract ones
- Distinguish grammatical form from semantic scope (e.g. πᾶς — "every" vs "all" is a form question, not semantic)
- Dictionary entry style output: form, gloss, usage note, 2–3 references
- Consider few-shot examples showing target output style

### AI: Cap max_tokens
Tighter limit for simple lookups — most answers don't need 1000 tokens.

### Cross-Reference Count Badge
Show a small ref count on each verse in Library so heavily cross-referenced verses (Isaiah 53, Psalm 22, etc.) are visible at a glance. Data already in `cross_references` table — just needs a count query and a UI badge.

### Transliteration Search — Verify
CLAUDE.md says transliteration search is implemented. Test `ἄρχων` / `archon` specifically to confirm it works end-to-end.

## Planned Features

### Hebrew Lexicon Search (main Search tab)
Direct Hebrew word search from the lexicon search input — by English gloss, transliteration, or H-number — returning ABP verses that contain that Hebrew root. Currently Hebrew word lookup only exists inside AI natural language search (via the BDB → kjv_strongs → ABP bridge). The main `/api/search` endpoint only handles Greek/ABP words.

**Known bug:** H-number direct search (e.g. `H430`) does not work in the current lexicon search — the endpoint only queries ABP `words`/`lexicon`/`lsj` tables which are Greek-only. H-numbers silently return no results.

**Planned fix (Option 1):** Separate Hebrew search mode — query `bdb` by H-number/gloss/transliteration, resolve OT verse occurrences via `kjv_strongs → kjv_verses`, return BDB word cards with OT occurrence groupings. Same sidebar UX as Greek (LSJ → BDB).

### Parallel Mode Synchronized Scrolling
In Parallel mode, the ABP and KJV columns scroll independently. Synchronized scrolling would keep both columns aligned by verse as the user scrolls.

### Parallel Mode Versification Alignment
ABP follows LXX verse numbering (Psalms especially can be off by 1 from KJV). In Parallel mode, mismatched verses currently show blank on one side. Need to: (1) audit how bad the mismatch is in practice, (2) decide whether to offset-map or leave gaps.

### Morphology Display
Show grammatical parsing (case, tense, number, etc.) in the word click sidebar in plain English: "Verb · Aorist · Active · Indicative · 3rd Person · Singular". Morphological data source: MorphGNT (NT) + CATSS/CCAT (LXX OT) — needs import into a `morph` column on the `words` table.

## Future Projects (MetaV Data)

### People & Genealogies
Use MetaV `People.csv`, `PeopleRelationships.csv`, and `PeopleAliases.csv` to build a people browser — click a name in a verse to see their genealogy, relationships, and every verse they appear in with the underlying Greek/Hebrew text.

### Places
Use MetaV `Places.csv` and `PlaceAliases.csv` to surface geographic context — click a place name to see all verses referencing it and potentially a map view.

### Topic Index
Use MetaV `Topics.csv` and `TopicIndex.csv` as a structured alternative to AI search — browse by topic and see curated verse sets with Greek/Hebrew anchoring.
