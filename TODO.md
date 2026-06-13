# TODO

Open work only. Finished and scrapped items (with the gory details) are in [TODO_ARCHIVE.md](TODO_ARCHIVE.md).

Each item ends with a small `code:` line — that's just a pointer for Claude to find the right
spot. You can skip those lines.

---

## Code health / cleanup

The big rework is finished — all six phases are done and live (see the memory notes
`project_redesign` / `project_architecture_rework`). Done: Strong's plumbing centralized +
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
   Also note (flagged by the 2026-06-10 code read): CI itself auto-runs only the data-invariant
   tests; the endpoint snapshot harness + browser click-through are MANUAL (run against a DB copy
   during dev), so web routes / click behavior aren't checked on every push. That's the main
   test-coverage gap if you ever want to close it.
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
3. **Split the one oversized front-end file.** `static/src/60-library.jsx` is ~2,470 lines — by far
   the biggest, clean inside, but it carries the reader + chip/prose + notes wiring + audio + chrono
   all at once. Worth carving into smaller view files like the rest of `static/src/` (the build just
   concatenates them in filename order, so a split costs nothing at runtime). Low urgency — flagged
   by the 2026-06-10 code read (memory `project_code_quality`).
   `code: static/src/60-library.jsx; build = scripts/build-frontend.js`

---

## Where it's behind vs other Bible apps (2026-06-10 assessment — revisit later)

We play in the FREE serious-study niche — against Blue Letter Bible, STEP Bible, e-Sword, Bible Hub.
NOT Logos (paid library) or YouVersion (reading + social reach); those aren't the target. Honest
gaps, worst-first:

1. ~~**No true Hebrew OT interlinear — the one real scholarly gap.**~~ **BUILT + LIVE + PUBLIC 2026-06-11.**
   Real Hebrew OT word-by-word, right-to-left, all 39 books, from **STEP TAHOT** (CC BY): clean contextual
   glosses + real surface pronunciation + decoded grammar (on the detail card), click → BDB. Own `heb.db`
   (PUBLIC route `views_heb.py`), `scripts/load_hebrew.py`, `renderHebVerse`. The single biggest gap, CLOSED
   and now public for everyone — no login (`hebPickable` gates on `hebAvail`, not the old owner flag). Full
   record: memory `project_hebrew_ot_interlinear`.
2. **Fewer translations** — a handful (ABP/KJV/BSB + owner ESV/NIV) vs BLB's dozens / YouVersion's
   hundreds. Cheap win: add public-domain ones (ASV, YLT, Darby, Geneva) — see "More texts".
3. **No reading plans / devotionals / social.** That's YouVersion's whole world — deliberately NOT
   our target. Chronological reading mode is the closest we have; reading plans could ride on
   accounts later if wanted.
4. **Reach / awareness is the REAL gap — not features.** One-person app on a small box; the feature
   set punches far above that, but almost nobody knows it exists, and each feature is a strong v1,
   not battle-tested at scale. The missing piece is marketing/discoverability, not code.

Deliberate NON-targets (listed so we don't mistake them for gaps): no paid commentary library
(Logos), no social feed (YouVersion), no imposed systematic theology (Berean by design).

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
     value): word-level highlights *within* KJV/BSB (today those two only paint a whole verse). Also, in
     the new multi-text COMPARE view a highlight paints WHOLE-VERSE in every column (even its home text) —
     intentional for now; exact-word paint in compare would need the column's own translation id threaded
     into `hiForWord` (today it reads the global `translation`, which is "parallel" in compare).
  3. ~~**Small UI follow-ups offered 2026-06-10.**~~ **BOTH DONE 2026-06-10:** (a) the Notes-TAB list now
     shows the per-item type marker (ribbon `Icon.Bookmark` / pencil `Icon.Note` / color dot), matching
     the reader (`.notes-item-type` in 35-notes.jsx); (b) the Library remembers book/chapter (+ translation
     + open non-canon text) across reloads via `localStorage` `lexica.lib.v1`, restoring instead of
     Genesis 1 (a `nav.book` jump still overrides). Compare/chronological not restored — fall back.

---

## Library in-text search — eSword-style, DONE 2026-06-13 (one small follow-up)

The reader's magnifying-glass search got the eSword upgrade: canonical order, "X verses, Y matches",
book range (preset groups + from/to), any/all/phrase (default Any), whole-word/case/exclude, auto
re-run on setting change, and an in-memory result cache. Full record: memory `project-esword-reference`.
Open:
- **Quick phone check of the new options panel** — built/tested on desktop; styles are responsive but
  the range dropdowns + checkboxes are worth a look on a narrow screen.
- Optional, only if first-search latency ever bugs you: a real full-text index (FTS5) for speed —
  but it changes the "match inside a word" behavior (default substring he likes) and needs a one-time
  build on PA. Parked. `code: /api/text-search in views_search.py; panel in static/src/60-library.jsx`

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
The non-canon word panel USED to show an "In the [book]" count + an LXX cross-link, but both were
HIDDEN 2026-06-11 because they dead-ended (`!entry.isExtra` added to abpOcc; the `extraOcc` push
commented out in 30-detail-panel.jsx). The Lexicon/Search tabs only know the Bible corpus. To let
people browse every Didache (or future-book) verse where a word appears, teach those tabs about the
`<book>_words` tables — best done once, generically, as a "non-canonical corpus" option rather than
per book. Re-show those occurrence links here once it's wired.
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
- ~~**Focus mode**~~ — **DONE + LIVE 2026-06-11** (see TODO_ARCHIVE + memory `project_focus_mode`).
  Tap blank space to strip the chrome. Mobile hides everything; desktop darkens the surround and floats
  the text as a centered "book page" with big ‹ › side arrows. Esc/tap exits.
- ~~**Parchment / dark themes**~~ — **DONE + LIVE 2026-06-11** (memory `project_reader_appearance`).
  Light · Sepia · Dark toggle in the reader's Aa menu (desktop) + the mobile reading-options sheet;
  whole-app re-skin via `data-theme` on `<html>`, remembered across reloads. Buttons are now driven by
  `--ctl-bg`/`--ctl-on` vars (add a new button with those, not `#fff`). The navy header stays brand
  navy in every theme.
- ~~**Greek-friendly typography**~~ — **TRIED + SCRAPPED 2026-06-11.** Shipped a reader font picker
  (Cardo/Gentium beside the default Source Serif), then reverted — the alt serifs looked worse than the
  existing Source Serif on Windows, and the reader was already a good serif, so there's no real win.
  Don't re-add a serif picker. See TODO_ARCHIVE + memory `project_reader_appearance`.

**Layout**
- **Word detail as a floating card** — instead of the fixed right sidebar, the lexicon info pops up
  right next to the word you clicked. `code: detail panel in 90-app.jsx (today it's the right sidebar)`
- **Collapsing toolbar** — shrink the desktop lib-bar to one compact pill that expands when you reach
  for it, giving the text more room. `code: lib-bar in 60-library.jsx + styles.css`

**Navigation**
- ~~**Real start screen**~~ — **DECLINED 2026-06-10.** A home/landing sitting between the user and
  the text would repeat BLB's mistake (reading buried behind chrome). Landing straight in the text is
  a feature — keep it. First-time orientation is already covered by the existing tutorial welcome page.
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
(see archive + memory). App stays fully usable with no account.
**Account ROLES added 2026-06-11 (LIVE): nologin / user / berean / admin** — `role` column on
notes.db users; ESV/NIV = berean+, Stats + an in-app Admin page (About → Admin) = admin, AI search
= any login. Owner email is always admin. Full record: memory `project_user_roles`. STILL OPEN:
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

### Study modules — admin Study tab (LIVE 2026-06-12/13; full record: memory project_study_modules)
Admin-only **Study** tab: Topics (sectioned browse — collapsible subtopics + a book sub-collapse,
alphabetical, comma-flipped display titles) · Denominations (support/tension editor) · Arguments
(two-sided Side A | Side B + resolution). All types read-first; "Preview as reader" admin toggle;
AI-drafted Berean topic intros (Haiku default / Sonnet for the public batch, sharpened prompt — ✦ button +
`scripts/generate_topic_intros.py`). MetaV/Nave's import (~1,819 concepts + 696 name-topics; Nave's-topical
sidebar block). Publish + dupe scripts: publish_topics, find_topics, find_topic_dupes, merge_the_dupes. OPEN:
- **PUBLIC "go-live" flip** — open published Study topics to actual visitors (everything's admin-only
  Preview until then). The big remaining step/decision.
- Drop the place "Sin" entry (Sin (1)/(2) — one is the Wilderness of Sin) from the `_COMMON` list.
- Optional: scope the alphabetical list sort to Topics if denom/arg should stay newest-first; fold MetaV
  `Writers` into `_BOOK_AUTHORS`; the few ambiguous "X, the Y" titles ("God, the Father") stay un-flipped.
`code: views_study.py + static/src/55-study.jsx; scripts/{load_study_topics,generate_topic_intros,publish_topics,find_topics,find_topic_dupes,merge_the_dupes}.py; memory project_study_modules`

### ~~Chronological reading mode~~ — DONE + LIVE 2026-06-09 (desktop + mobile)
Read the Bible in event order, works with ANY version (ABP/KJV/BSB). Shipped as a reading-ORDER
toggle in the Library (Canonical | Clock icon = Chronological), NOT a separate tab. Data is a static
`static/chronological.json` (1,102 passages, 13 eras) built by `scripts/chronological/
build_chronological.py` — no database, no backend route. Exact-range reader trims + spans chapters.
Full record in memory `project_chronological_tab`. Polish DONE 2026-06-11: the chapter divider is now
suppressed on single-chapter passages (it just repeated the passage location); multi-chapter passages
keep their per-chapter dividers (`singleChapterPassage` in 60-library.jsx `withMarks`).

### Read-along audio — DONE + LIVE 2026-06-10 (BSB live for all; ESV waits on a key)
Per-chapter audio on KJV/BSB/ESV (ABP has no recording). Full record: memory `project_esv_audio` +
TODO_ARCHIVE. **BSB is live for everyone** — public-domain openbible.com Souer mp3s, no key, no
self-hosting (`/api/bsb/audio`). Control = a play/pause ICON in the toolbar + a draggable progress
bar. **Mobile (2026-06-11): the scrubber docks at the BOTTOM, on a strip just above the reading
cockpit, sliding up when a chapter loads — ALL modes incl. chronological (`.lib-audio-dock`); desktop
chrono keeps the inline bar at the playing chapter.** Chrono is scroll-aware (plays the chapter at
~45% mid-screen, auto-advances). Audio is per WHOLE chapter (no per-verse timing). STILL OPEN:
- ~~**Mobile dock slide-OUT animation**~~ — **DONE 2026-06-11.** The bottom scrubber now eases back
  DOWN when the chapter/passage ends (`audio-dock-down`), matching its slide-up entry. It stays mounted
  one beat after the audio clears (`dockClosing` in 60-library.jsx) so the exit can play; a re-open cancels it.
- **ESV audio** — owner-only; code DONE 2026-06-11. Now prefers **Crossway's own ESV API**
  (api.esv.org, `ESV_API_TOKEN`) — whole-Bible Max McLean reading, instant self-serve token (NO FCBH
  approval wait). `views_esv._crossway_audio_url` captures the 302→signed-mp3 URL. FCBH (`FCBH_API_KEY`,
  NT-only) stays as the fallback if only that key is set. JUST NEEDS: free token at api.esv.org →
  `ESV_API_TOKEN` in the WSGI → reload. (FCBH key still pending and now optional.)
- ~~**KJV audio**~~ — **DONE + LIVE 2026-06-11 (public, no key).** Single narrator + soft music
  background (the "Firefighters for Christ" KJV reading, hosted by audiotreasure.com at
  `/content/KJV_FF/<NN>_<Name>_<chap>.mp3`). Hotlinked like BSB — `views_kjv.kjv_audio` +
  `api.kjvAudio` + `kjvMode` in the audio toggle; book-name tokens pinned in `_KJV_AUDIO_NAME`
  (irregular spellings + a "Soloman" typo), Psalms = 3-digit chapters, all 66 books covered.
  STILL OPEN: a **dramatized** KJV (multiple voices + music) = the FCBH recording, so it rides the
  same pending Bible Brain key as ESV; swap/add it then if wanted. Self-hosting the archive.org
  dramatized copies is off the table (FCBH owns that recording).
- **Verse-by-verse karaoke** — needs per-verse timing data; bigger lift, parked.
`code: views_bsb.bsb_audio + views_esv.esv_audio; audio player in 60-library.jsx`

### Map tab
Biblical geography as its own tab. Three angles: follow the current chapter and show its places;
search a place and pin every verse that mentions it; or a free-explore world map where clicking a
city opens the MetaV sidebar. The neat version ties maps to the text (e.g. plot every place in Paul's
letters across his journeys) — nobody does this well. Coordinates and the map library are already in
place for the existing place sidebar, so this is smaller than it looks.

### More texts + word grammar (morphology)
- **Word grammar everywhere:** plain-English part-of-speech/tense/case per word. **DONE for the Hebrew OT**
  (2026-06-11, via STEP TAHOT — shown on the detail card; `decode_morph` in load_hebrew.py) and partly for
  ABP Greek (~78% morph). Could extend to fuller Greek coverage (CATSS for the LXX OT, macula-greek for the
  NT). `code: morph column on words; decode_morph in scripts/load_hebrew.py`
- **Textus Receptus Greek NT:** add as a second NT text next to ABP. Same Strong's numbering, so it
  plugs in easily, and showing where the two Greek texts differ is genuinely rare and useful.
- **Multi-text COMPARE — DONE + LIVE 2026-06-10** (memory `project_pericopes_parallel`). The old 2-column
  "Parallel" is now a picker for **2–4 of ABP/KJV/BSB/ESV/NIV** side by side (desktop columns, mobile stacked
  labeled lines); notes/highlights shared across columns. This is the vehicle for comparison texts.
- **More English translations** (ASV, YLT, Darby, Geneva) — all public domain; would slot straight into
  the Compare picker as new toggles + their own loader/db (like BSB). Not started.
- **ESV — PERSONAL, LOGIN-GATED — DONE + LIVE 2026-06-10** (memory `project_esv_audio`). Owner-only ESV
  reader, server-gated via the shared `views_notes.is_owner()` (`OWNER_EMAIL` live; toggle shows for the
  owner). Text LOADED on PA (`load_esv.py` → `esv.db` = 31,104 verses, all 66 books). Only ESV AUDIO is
  still open — waits on `FCBH_API_KEY` (see audio item).
- **NIV — PERSONAL, OWNER-ONLY — DONE + LIVE 2026-06-10** (memory `project_esv_audio`). Mirrors ESV exactly:
  `views_niv.py`, own `niv.db`, NIV toggle. TEXT-ONLY (FCBH has no NIV audio). Loaded by `scripts/load_niv.py
  ~/Bible-niv ~/bible-db/niv.db` from aruljohn/Bible-niv. No WSGI change needed.
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
