# TODO

## Planned Features

### Hebrew Lexicon Search (main Search tab)
Direct Hebrew word search from the lexicon search input — by English gloss, transliteration, or H-number — returning ABP verses that contain that Hebrew root. Currently Hebrew word lookup only exists inside AI natural language search (via the BDB → kjv_strongs → ABP bridge). The main `/api/search` endpoint only handles Greek/ABP words.

### Parallel Mode Synchronized Scrolling
In Parallel mode, the ABP and KJV columns scroll independently. Synchronized scrolling would keep both columns aligned by verse as the user scrolls.
