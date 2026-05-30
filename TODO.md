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

### Cross-Reference Count Badge
Show a small ref count on each verse in Library so heavily cross-referenced verses (Isaiah 53, Psalm 22, etc.) are visible at a glance. Data already in `cross_references` table — just needs a count query and a UI badge.

## Planned Features

### Morphology Display
Show grammatical parsing (case, tense, number, etc.) in the word click sidebar in plain English: "Verb · Aorist · Active · Indicative · 3rd Person · Singular". Morphological data source: MorphGNT (NT) + CATSS/CCAT (LXX OT) — needs import into a `morph` column on the `words` table.

### Parallel Mode Synchronized Scrolling
In Parallel mode, the ABP and KJV columns scroll independently. Synchronized scrolling would keep both columns aligned by verse as the user scrolls.

### Parallel Mode Versification Alignment
ABP follows LXX verse numbering (Psalms especially can be off by 1 from KJV). In Parallel mode, mismatched verses currently show blank on one side. Need to: (1) audit how bad the mismatch is in practice, (2) decide whether to offset-map or leave gaps.

## Future Projects (MetaV Data)

### People & Genealogies
Use MetaV `People.csv`, `PeopleRelationships.csv`, and `PeopleAliases.csv` to build a people browser — click a name in a verse to see their genealogy, relationships, and every verse they appear in with the underlying Greek/Hebrew text.

### Places
Use MetaV `Places.csv` and `PlaceAliases.csv` to surface geographic context — click a place name to see all verses referencing it and potentially a map view.

### Topic Index
Use MetaV `Topics.csv` and `TopicIndex.csv` as a structured alternative to AI search — browse by topic and see curated verse sets with Greek/Hebrew anchoring.
