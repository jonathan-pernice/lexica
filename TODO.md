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

1. **More automated checks (mostly done).** The test net now covers broken pages (snapshot harness) and
   the dangerous data invariants (strongs prefix, tipnr type-set, the build's guards). 2026-06-07 added
   the automation layer: GitHub auto-runs the tests + frontend build-check on every push (CI), a
   pre-commit hook runs the same checks locally, `scripts/deploy.sh` is a one-command tested deploy, and
   Dependabot watches outside packages. STILL OPEN here: a nightly `health_check.py` email on PA (needs a
   PA scheduled task + email login) — the only piece that has to run against the real database.
   `code: scripts/health_check.py, scripts/snapshot_endpoints.py, tests/, .github/, scripts/githooks/, scripts/deploy.sh`
2. **Unify the AI prompt STYLE into one shared "house style" snippet.** (The cache-fingerprint half
   of this item is DONE 2026-06-09 — see TODO_ARCHIVE.md. This is the leftover paired half.) CORRECTED 2026-06-09 (see memory project_ai_synthesis_quality): the original plan — drop sentence-count
   caps and let LENGTH FIT THE CONTENT (adaptive) everywhere — is only right for SONNET. Haiku does NOT
   honor a soft adaptive cap: on a maximal chapter (Sibylline Bk 1) it marched every section and overran
   the token ceiling (got chopped mid-word). New rule: share the VOICE only (plain language, short
   one-idea sentences, no run-ons, no jargon, no moralizing) in one core.py snippet; keep LENGTH control
   split by MODEL — HARD sentence-counts on the Haiku prompts, SOFT adaptive (~Nw ceiling) on the Sonnet
   ones. DONE: xref write-up and chapter summary both moved to adaptive length AND onto Sonnet (33742e8;
   b98517f then 5f38d25); the AI-search xref enrichment is on Sonnet too (21aa95a). STILL OPEN: (a) the
   shared VOICE snippet in core.py was never built — xref/chapter carry their own wording; (b) person/place
   (`_PN_SYSTEM`, Haiku, "1-2 sentences") is CORRECT as a hard cap — leave it, do NOT convert to adaptive;
   (c) glance at the LSJ word-study blurb (Haiku) to confirm it's hard-capped, not soft.
   NOTE: changing these prompts is exactly what the
   new fingerprint scheme watches, so each edit will lazily refresh that category's cache (expected).
   `code: shared snippet in core.py; views_crossref.py system prompts; views_metav.py _PN_SYSTEM;
   views_summary.py _SUMMARY_SYSTEM/_*_TMPL; ai.py LSJ prompt in views_lsj.py`

---

## New features

- ~~**Notes feature.**~~ **DONE 2026-06-09** (notes + highlights + bookmarks + accounts). Study
  notes, color highlights, and bookmarks in the Library (drag-select, or a verse-number menu);
  Notes tab with search + filters + sort + collapsible group-by-book + Export/Import backup.
  Browser-local first, with **opt-in accounts (email/password OR Google) for cross-device sync** —
  the first server-write path, in its own `notes.db` (NOT bible.db). See TODO_ARCHIVE + memory
  `project_notes_highlights`. Open follow-ups: cross-translation highlight paint, word-level
  highlights in KJV/BSB, **password reset / set-password (needs SMTP — see below)**, Apple sign-in (if wanted).

- **Notes — next-session follow-ups (one place to start from).** Memory `project_notes_highlights`
  has the full design + gotchas.
  1. **Email / SMTP on PA — PARKED until the app gets a custom domain (2026-06-09 decision).** Unlocks
     password **reset**, **set-a-password** for Google-only accounts, the nightly `health_check.py`
     email, and later campaigns. Deliberately deferred: a domain means doing the sender setup once,
     properly (mail from `you@domain` + SPF/DKIM via a real service), instead of standing up a throwaway
     Gmail now and redoing it. The send code is provider-agnostic plain SMTP, so when the domain lands
     it's just env vars in the WSGI + a small send helper + the reset/set-password endpoints. Nothing
     else is blocked by it.
  2. **Highlight paint reach** — cross-translation DONE 2026-06-09 (a highlight now shows in ABP/KJV/BSB;
     exact words in its home text, rounds up to whole verse elsewhere). STILL OPEN (optional, lower
     value): word-level highlights *within* KJV/BSB (today those two only paint a whole verse).

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

## Random redesign ideas (2026-06-09 brainstorm — pick any, nothing committed)

Loose look-and-feel ideas, parked here so they're not lost. None are scoped yet — grab whichever appeals.

**Reading experience**
- **Focus mode** — tap the text and all the chrome (toolbar, left nav, bottom tabs) fades away for
  distraction-free reading; tap again to bring it back. `code: reader chrome toggle in 60-library.jsx + 90-app.jsx`
- **Parchment / dark themes** — a warm sepia reading skin plus a real dark mode, with a small corner
  toggle. `code: styles.css theme vars (--ink, --bg…) + a theme switch`
- **Greek-friendly typography** — a proper Greek serif and more line spacing so the reader feels like
  a book, not a database. `code: styles.css font stack + line-height on the reader`

**Layout**
- **Word detail as a floating card** — instead of the fixed right sidebar, the lexicon info pops up
  right next to the word you clicked. `code: detail panel in 90-app.jsx (today it's the right sidebar)`
- **Collapsing toolbar** — shrink the desktop lib-bar to one compact pill that expands when you reach
  for it, giving the text more room. `code: lib-bar in 60-library.jsx + styles.css`

**Navigation**
- **Real start screen** — a proper home/landing instead of dropping straight into Genesis 1.
  `code: initial view in 90-app.jsx`
- **Chronological timeline scrubber** — a draggable era timeline across the top of the chronological
  READING MODE (it's a reading mode, NOT a tab) for jumping around the sequence.
  `code: chronological reading-mode UI; memory project_chronological_tab`

**Search**
- **One smart box** — merge the Lexicon and AI search inputs into a single field that detects what you
  typed (Strong's vs Greek vs plain question) and routes it. `code: Search tab inputs in 70-search.jsx`

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

### Highlighting + notes (Logos-style) — DONE 2026-06-09, two paint follow-ups open
Notes + highlights + bookmarks LIVE, plus opt-in accounts/sync (see archive + memory
`project_notes_highlights`). Non-canon notes, Notes-tab filters/sort/group, Export/Import all DONE.
Still open:
- **Cross-translation paint** — a highlight made in ABP doesn't show in KJV/BSB (word positions
  differ per text). Today paint is matched to the text it was made in.
- **Word-level highlights in KJV/BSB** — they anchor at the whole verse for now (no `data-note-pos`).

### Free user accounts — MOSTLY DONE 2026-06-09 (reset pending)
LIVE: email/password + Google sign-in, opt-in, syncing notes across devices via `notes.db`
(see archive + memory). App stays fully usable with no account. STILL OPEN:
- **Password reset + set-password** — needs the site to SEND email (SMTP on PA, not configured). A
  Google-only account currently can't use the password form (no password set). Same SMTP blocker as
  the nightly health_check email below — wire SMTP once, both unlock.
- **Apple sign-in** — only if wanted (needs a paid Apple Developer account; heavier than Google).
- Email campaign / reading plans (the original "reach" payoff) — once SMTP + accounts are proven.

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

### Chronological reading mode (works with ANY version)
Read the Bible in historical/event order instead of book order — like the ESV Chronological Bible
(interleaves Psalms with Kings/Samuel, prophets with their history, etc.). The key win: this is just
a different READING ORDER, not a different text, so ONE chronological list drives ABP, KJV, AND BSB
alike — every version already shares the same book/chapter/verse addresses, so the app just pulls
each passage range from whichever version is selected. Version-agnostic by design.
- **The one real piece of work = the passage list** (~1,000–1,200 chunks, each = book + verse range
  + an era label like "Creation"/"United Kingdom"/"Exile"). Claude can generate a standard ESV-style
  arrangement as that list — this is the blocking step; do it first, read-only, before any app code.
- Then: a small route that serves "passage #N" + next/prev (pulling text from the existing version
  tables), and a new tab with era-based navigation instead of book/chapter dropdowns. Separate tab,
  not a Library toggle. Touches NO existing ABP/KJV/BSB data — sits entirely on top.
- Sources to check first for a ready passage sequence: github.com/lifegems/bible-timeline,
  github.com/BennyThadikaran/bible (365-day plan). See memory `project_chronological_tab`.
`code: new chronological_sequence list + a serve-by-position route + a new tab`

### Read-along audio (play a chapter while you read)
Like eSword's ESV/KJV audio — a play button that reads the chapter aloud. Scoped 2026-06-09.
Plan: EVERY reading text gets audio EXCEPT ABP (no recording exists for it).
- **BSB — cleanest option.** The official Berean Standard Bible audio (narrators Souer/Hays/Gilbert)
  is **public domain (CC0)** — no terms, no key, no non-commercial limit. We can download the mp3s and
  host them ourselves. Trade-off: PLAIN narration, **no background music/dramatization.**
- **KJV — dramatized (music + sound effects)** like eSword comes from Faith Comes By Hearing's "Bible
  Brain" API (formerly Bible.is). Free for non-commercial use but stays on THEIR terms + THEIR server
  (register for a key). Also simpler free KJV-with-soft-music recordings exist (AudioTreasure, Internet
  Archive) if plain narration is fine.
- **ESV — dramatized, but PRIVATE.** FCBH Bible Brain has ESV audio with background music (fileset
  e.g. `ENGESVN2DA`). Rides along with the login-gated ESV text above — owner-only, server-enforced,
  so the spoken ESV words match the ESV text on screen. See the ESV item under "More texts" below.
- **ABP — none exists** (niche LXX Greek interlinear; no recordings). The primary Greek text stays
  audio-less; KJV/BSB/ESV all get it.
- **The catch = alignment.** Audio is per-CHAPTER, not timed per verse, so the basic version is a
  per-chapter play button that highlights the whole chapter. Verse-by-verse follow-along (karaoke
  style) needs per-verse timing data — a much bigger lift, not always available.
- Realistic first cut: a per-chapter play button on KJV/BSB using CC0 BSB audio. Easy + free.
`code: new audio route/static mp3s + a play control in the Library reader`

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
- **ESV — PERSONAL, LOGIN-GATED TO THE OWNER ONLY (plan set 2026-06-09).** ESV is Crossway-copyrighted,
  so it CANNOT be a public reading text like KJV/BSB. But the owner owns ESV copies (bought several of
  their books) and wants it for his OWN study — that's personal use, not publishing. So the plan: load
  the ESV text (chapter-per-file source exists, e.g. github.com/lguenth/mdbible) AND wire up ESV audio,
  but show BOTH only to the owner's account.
  - **HARD RULE: enforce the gate on the SERVER, not just hide the toggle.** The ESV text route AND the
    audio embed must check "is this the owner's account?" server-side and refuse everyone else — hiding
    the button is not enough (the address must not work for anyone else). Reuse the existing accounts/
    login (notes.db bearer token) to identify the owner.
  - Keep it GENUINELY single-user. Opening ESV to other logged-in users = publishing again = not allowed.
  - ESV audio is on FCBH's Bible Brain API (dramatized fileset exists, e.g. `ENGESVN2DA`); fine for
    private non-commercial use, streamed from their server on their terms.
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
