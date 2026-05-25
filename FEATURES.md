# Lexica — Feature List

## Overview
Lexica is a Greek and Hebrew Bible word study web app built on the Apostolic Bible Polyglot (ABP) interlinear. Designed for serious study without requiring prior knowledge of Greek or Hebrew. Backend: Flask + SQLite. Frontend: React 18 (no build step). Hosted on PythonAnywhere.

---

## Library Tab

### Translation Modes
- **ABP** (Apostolic Bible Polyglot) — primary interlinear text
- **KJV** — King James Version comparison
- **Parallel** — ABP and KJV side by side

### Display Toggles
- **English / Greek** word order toggle (ABP and Parallel modes) — Greek order rearranges words to match the original Greek syntactic sequence
- **Strong's** — shows Strong's number badges on each word (available in Greek order and KJV mode)
- **Interlinear** — stacks Greek lemma above each English word chip (available alongside Strong's)

### Word Interaction
- Click any word to open the **LSJ sidebar** (Greek G-numbers) or **BDB sidebar** (Hebrew H-numbers)
- Italic KJV words (translator additions with no source word) rendered in muted style
- Full English gloss always shown — not truncated to head word
- Bracketed words in Greek order display a small position number indicating their original Greek sequence

### Verse Numbers
- Click a verse number to open the **TSK Cross-Reference Panel** for that verse
- Clicked verse highlighted with gold background + gold left-bar indicator
- Highlight clears when panel is closed

### Navigation
- Book and chapter selector
- Responsive layout for mobile and desktop

---

## TSK Cross-Reference Panel

- Powered by **Torrey's Treasury of Scripture Knowledge** (386,518 cross-reference pairs)
- **Haiku-curated selection**: all TSK refs for a verse are passed to Claude Haiku, which selects the 8–10 with the strongest connection (direct quotation, shared key terms, thematic parallels, canonical echoes)
- **Thematic synthesis**: Haiku generates a 3-sentence synthesis of the curated set, anchored in ABP source vocabulary
- Cross-ref verses display in **ABP text** when library is in ABP or Parallel mode; KJV otherwise
- Results cached per verse in the database — fast on repeat views
- Panel is self-contained; opens alongside the reading view without disrupting navigation

---

## Search Tab

### Lexicon / Strong's Search
- Search by **English word or gloss** (head word or full gloss)
- Search by **Greek characters** with or without accents — matches lemma directly
- Search by **transliteration** — substring match, accent-insensitive (e.g. `proorizo`, `orizo`)
- Search by **Strong's number** — `G####` for Greek, `H####` for Hebrew
- Results show word cards: Strong's badge, Greek lemma, transliteration, gloss, verse count

### OT / NT Corpus Filter
- **All / OT / NT** toggle filters search results by testament
- Grouping counts and gloss variants recomputed from the filtered set

### Gloss Groupings
- Words with multiple translation glosses are grouped and counted across the corpus
- Each gloss variant shows its occurrence count
- Groupings update dynamically when OT/NT filter is applied

### Function Word Filter
- 171 common particles, articles, prepositions, and conjunctions excluded from results by default
- Toggle to show all words including function words

### LSJ Lookup Chain (per result)
1. Exact key match in LSJ
2. Accent + hyphen-stripped plain match
3. Cross-reference resolution (stubs followed, discarded if they point to a different entry)
4. Strong's-def fallback from lexicon table

### Word Detail Sidebar
- **Definition tab** — LSJ definition with section headers; Haiku contextual summary
- **Full LSJ tab** — complete raw LSJ entry

---

## AI Natural Language Search

- Free-text query input (e.g. "spirit in Genesis", "hesed in the Psalms", "light and darkness in John")
- **Two-step pipeline**: Claude Haiku generates SQL against the ABP database, then curates results and generates an explanation
- **Empty-result retry**: if SQL returns 0 rows, Haiku automatically broadens the approach (removes strict co-occurrence subqueries, expands Strong's numbers, falls back to English LIKE matching)
- **Key Strong's citation chips**: up to 6 clickable G/H number chips per result — click to open word detail sidebar
- **Hebrew + Greek equal priority**: OT concept queries return both the Greek G-number (ABP) and Hebrew H-number (BDB) in citation chips
- **Hebrew word bridge**: queries about Hebrew words (by name, transliteration, or meaning) route through BDB → kjv_strongs → ABP interlinear verses
- **TSK cross-references available to AI** at its own judgment — used for thematic cross-testament queries, suppressed for focused lexical queries
- Results cached in database + in-memory; cache versioned to auto-invalidate on logic changes; TSK cache preserved across version bumps

### Browse / Study Mode
- **Browse mode** — compact word cards with gloss and verse reference
- **Study mode** — expands each result into a full verse context view with interlinear data

---

## Lexicons & Databases

| Table | Contents |
|---|---|
| `words` | ABP word-level interlinear — Strong's, position, English gloss, Greek |
| `verses` | ABP verse text |
| `lexicon` | Greek Strong's definitions (G-numbers) |
| `lsj` | Liddell-Scott-Jones Greek lexicon |
| `bdb` | Brown-Driver-Briggs Hebrew lexicon (H-numbers) |
| `kjv_verses` | KJV full verse text (31,102 verses) |
| `kjv_words` | KJV word-level tokens with italic flag |
| `kjv_strongs` | KJV word → Strong's number mapping |
| `cross_references` | TSK cross-references (386,518 pairs) |
| `books` | Book metadata (name, testament, regex) |
| `ai_search_cache` | Cached AI search and TSK synthesis results |

---

## Tech Stack
- **Backend**: Python / Flask, SQLite (WAL mode), PythonAnywhere free tier
- **Frontend**: React 18 + Babel standalone (JSX, no build step)
- **AI**: Claude Haiku for AI search, LSJ summaries, TSK curation and synthesis
- **Deployment**: GitHub → git pull on PythonAnywhere
