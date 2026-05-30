# TODO

## Planned Features

### Hebrew Lexicon Search (main Search tab)
Direct Hebrew word search from the lexicon search input — by English gloss, transliteration, or H-number — returning ABP verses that contain that Hebrew root. Currently Hebrew word lookup only exists inside AI natural language search (via the BDB → kjv_strongs → ABP bridge). The main `/api/search` endpoint only handles Greek/ABP words.

**Known bug:** H-number direct search (e.g. `H430`) does not work in the current lexicon search — the endpoint only queries ABP `words`/`lexicon`/`lsj` tables which are Greek-only. H-numbers silently return no results.

**Planned fix (Option 1):** Separate Hebrew search mode — query `bdb` by H-number/gloss/transliteration, resolve OT verse occurrences via `kjv_strongs → kjv_verses`, return BDB word cards with OT occurrence groupings. Same sidebar UX as Greek (LSJ → BDB).

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
