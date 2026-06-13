# TODO — Archive (finished & scrapped work)

History and "don't redo this" notes. Nothing here is open. Deep detail lives in the
memory files; this is the plain-English record plus the rollback database names and the
few "leave it alone" verdicts worth keeping.

---

## Book-summary author list — folded in metaV Writers + named scribes — DONE 2026-06-13

The reading-pane book blurb names the writer from `_BOOK_AUTHORS` (views_summary.py). It used to
leave the traditionally-anonymous books blank on purpose. Folded in metaV's **Writers** list (the
same gusheng/MetaV dataset People/Places came from) to fill them: Judges/Ruth/1-2 Samuel = Samuel,
1-2 Kings = Jeremiah, 1-2 Chronicles = Ezra, Job = Moses, Esther = Mordecai. Hebrews stays blank —
metaV itself marks it "Unknown" (honest), and a blank means no author line. Also added the two
scripturally-named scribes inline: Jeremiah/Baruch (Jer 36) and Romans/Tertius (Rom 16:22).

How: pulled the real Writers.csv off GitHub (couldn't see the live `metav_writers` table — bible.db
is PA-only), eyeballed every row vs our list. First wired a LIVE read of `metav_writers` (mapped
book_id 1-66 via core `_KJV_BOOK_ID_REV`), then REVERTED it — baked the names straight into the one
`_BOOK_AUTHORS` list at the user's call, so there's no second source and no dependency on the table
being loaded. metaV's data was looser than ours in two spots (Psalms = just "David" vs our "David and
other psalmists"; John = just "John" vs "the apostle John") — kept ours.

Lessons worth keeping:
- **metaV doesn't fabricate, but it's confident about disputed traditions.** It honestly says
  "Unknown" for Hebrews, but flatly attributes Job→Moses, Esther→Mordecai, etc. — fringe/Talmudic
  views, not "well established."
- **Feeding the model a name isn't enough.** The summary SYSTEM prompt only names an author "when
  well established", so Haiku SILENTLY DROPPED the contested fold-ins (Job showed no writer) while the
  solid ones (Jeremiah, Paul) worked. Fix was `_AUTHOR_LINE_TMPL`: license a "traditionally attributed
  to X" hedge for debated ascriptions — honest, and the names now surface. (Commits 870db14 live-read,
  bbf5148 bake-in, 645c38f the hedge.)
- Not a cache/wiring bug — Jeremiah picking up Baruch immediately proved the deploy + cache-refresh
  path worked; only the prompt was holding Job back.
- OPEN, optional: 1 Peter "by Silvanus" (1Pe 5:12) as a scribe — debated (scribe vs carrier), left out.

---

## Study modules — admin Study tab + MetaV/Nave's import — BUILT 2026-06-12

Recovered a lost idea ("a DB that had study topics") → it was the **MetaV** dataset
(github.com/gusheng/MetaV, the same one People/Places/cross-refs came from), which carries
Nave's+Torrey's **Topics + TopicIndex**. Built an admin-only **Study** tab: sub-switch
**Topics · Denominations · Arguments**. Topics = a sectioned browse; denomination/argument = a
position→support→tension→resolution claim editor. Own `study.db` (gitignored, PA-only),
`views_study.py`, `static/src/55-study.jsx`. Loader `scripts/load_study_topics.py` imported
~1,819 concept topics + 696 person/place "name-topics". Full record: memory `project_study_modules`.

**Follow-on, all SHIPPED 2026-06-12/13:** the Nave's-sidebar tap-through; a real TWO-SIDED argument
layout (Side A | Side B + resolution, its own `sides` shape); a stepped reader WALKTHROUGH (built then
DROPPED for collapsible subtopics on the page — same cure, one view) + a BOOK sub-collapse inside big
subtopics; a "Preview as reader" admin toggle (all types now read-first); AI-drafted text-first Berean
topic INTROS (Haiku default / Sonnet for the public batch, sharpened prompt; ✦ button + bulk script);
title comma-flip for display + alphabetical list sort; and a publish/dupe-cleanup script set. Only the
public "go-live" flip (open published topics to visitors) is left.

Lessons worth keeping:
- **Topics are NOT claims.** First cut forced every topic into the support/tension/resolution
  shape; a plain topic is just "a subject + its verses," so that shape made no sense. Split into
  TWO shapes — sectioned topic browse vs the claim editor. Don't re-merge them.
- **Filter MetaV name-topics by NAME, not a verse-count proxy.** Nave's lists every proper name;
  those are already in the metaV sidebar + word search. Drop them using MetaV's own People/Places
  lists (short whitelist for God/Jesus/Holy Spirit); keep concepts. The verses-count "bandaid" was
  wrong — it kept big names and could drop small concepts.
- **MetaV's curated topics ≠ a concordance.** Subtopics ("Affliction — consolation under / made
  beneficial") are thematic and include verses without the keyword — real value over plain search.
  For bare names it IS just "where mentioned" (= search), hence dropping them.
- **CSV gotcha:** read MetaV CSVs as `utf-8-sig` — a BOM in the header made every verse link drop
  (the "0 verses" symptom). `--replace` clears prior `metav*` rows first so a re-run is clean.
- Verse text shown = **ABP prose** (the words' english joined like Prose mode), KJV per-verse fallback.
- **Walkthrough → collapse (06-13).** A stepped one-at-a-time reader was built first; on small topics it
  barely differed from the page, so it was dropped for collapsible subtopics (the cleaner fix). Don't re-add.
- **Nave's titles are index-style** ("Life, Eternal", "Devil"=Satan, "Accusation, False"). Match the
  curated `_COMMON` hot-list to the REAL titles (`find_topics.py`); flip them for DISPLAY only
  (`displayTitle`), don't rename the stored data. "X, the" = "The X" (mergeable dupe); "X, <aspect>" is a
  real subtopic (keep). Merge folds "X, the"→"X" with a dry-run + study.db backup + soft-delete.
- **Slow topic load was connection churn**, not the ABP word-stitching — `_resolve_body` opened a fresh
  db connection PER VERSE (~67 for a big topic). One shared connection fixed it (commit 25ad365).
- **Script API key:** the Anthropic key lives in the WSGI, not the shell — bulk scripts need
  `export ANTHROPIC_API_KEY=...` first or `core._anthropic` is None and they no-op.

## Focus mode + reader gesture/scroll fixes — DONE 2026-06-11

All on master, pushed. Full record: memory `project_focus_mode`.

- **Focus mode (distraction-free reading).** Tap blank space in the reader to strip the chrome; Esc or
  tap exits. NOT remembered across reloads. **Mobile** hides the chrome outright (header/nav/toolbar/tabs/
  audio — audio keeps playing). **Desktop** darkens everything with a click-through dark wash and floats
  the text as a `position:fixed`, centered, self-scrolling "book page" with big ‹ › page-turn arrows in
  the side gutters. Files: `90-app.jsx` (flag + shell class), `60-library.jsx` (trigger/page-turn/arrows),
  end of `styles.css`. Iterated live with the user: desktop went from hide-all → dark-spotlight; the page
  got centered on the whole screen (not the offset column), made tall with both edges, and the arrows
  moved to hug the page edges and grew to 76px. Open by-design: word-click lexicon shows dimmed behind
  the page in desktop focus.
- **Verse-number hit area tightened.** Digits moved to an inner `.lib-vnum-num` hit target; the `.lib-vnum`
  gutter is `user-select:none` + inert. Killed the "click/drag beside the number highlights the verse" bug.
- **Highlight pop-up = dismiss-only click** (matches the verse-number menu). First click closes it and is
  swallowed (no chip/verse/focus underneath). LESSON: the close re-renders before the click lands, so a
  state-in-closure check read stale — fixed with a `swallowClickRef` set at mouse-DOWN, checked AFTER the
  `justSelectedRef` (selection-ending) check. Two passes to get right.
- **Pericope headings left-aligned on both** mobile + desktop (were centered on mobile); mobile keeps the
  hidden verse-gutter width so the heading lines up with the verse text.
- **Jump-to-verse scroll:** reader lands the verse in the UPPER THIRD (not centered); left nav scrolls the
  active book to the TOP of its own `.nav-scroll` list, never the window (which used to push the verse
  off-screen). Decided per-case: reader = upper-third, nav = top.

## NIV text + multi-text Compare + reader UI tweaks — DONE 2026-06-10

All on master, deployed. Detail: memory `project_esv_audio` (NIV) + `project_pericopes_parallel` (Compare).

- **NIV — 2nd owner-only text, mirrors ESV exactly.** `views_niv.py`, own `niv.db` (gitignored, PA-only),
  `core.niv_db`, NIV toggle next to ESV. TEXT-ONLY — checked FCBH and it doesn't carry NIV audio (commercially
  licensed), so no audio route. Source = aruljohn/Bible-niv (66 JSON files, `book/chapters/verses`); loaded by
  `scripts/load_niv.py ~/Bible-niv ~/bible-db/niv.db` (maps book name → 1-66 id, ~31,104 verses). The loader
  fixes the source's backtick-for-apostrophe quirk (`God`s` → `God's`); validated the format against the real
  repo before loading. No WSGI change — the existing `OWNER_EMAIL` gate covers it.
- **"Parallel" → multi-text COMPARE (pick 2–4).** Choose any 2–4 of ABP/KJV/BSB/ESV/NIV side by side.
  Desktop = N columns (`.lib-cmp-2/3/4`); mobile = stacked, one labeled line per text (user picked
  "stack per verse" over side-scroll). `compareSel` array holds the picks; per-text loaders fire when their
  id is selected; render = ordered UNION of verse keys (chapter+verse) so a missing verse leaves a blank cell.
  BSB/ESV/NIV inherit the Psalm alignment for free (all English = MT numbering). Notes/highlights SHARED across
  columns (plain columns got the anchor + whole-verse highlight paint + note dot; ABP/KJV inherit theirs).
  LESSON: in compare the home-text exact-WORD highlight paint rounds up to whole-verse (translation is
  "parallel", matches no note's home text) — left as-is on purpose (reads clean in narrow columns).
- **Reader UI tweaks (same session):** mobile note/journal/copy bar is icon-only (reused the existing
  `note-btn-lbl` span that CSS already hides on mobile; desktop keeps the text); mobile prose verse number
  kept `inline` instead of `inline-block` — that was the cause of the number dangling at a line end (an
  inline-block creates a wrap point after it; inline doesn't). Book selector left as-is (the translation
  buttons live in the left nav, not the toolbar, so columns don't crowd it).

---

## ESV (owner-only) + read-along audio + visitor stats — DONE 2026-06-10

A big session. All on master, deployed. Full detail: memory `project_esv_audio` + `project_visitor_stats`.

- **ESV reading text — owner-only, server-gated, LIVE.** Crossway-copyright → not public. Gated to the
  owner's notes.db login on the SERVER (404 to everyone else, not just a hidden toggle). Own `esv.db`
  (gitignored, PA-only), loaded by `scripts/load_esv.py` from github.com/lguenth/mdbible (`by_book/NN_Name.md`;
  31,104 verses). `views_esv.py`. Reads like BSB (plain, proseLocked).
- **Read-along audio.** BSB is LIVE for everyone — public-domain openbible.com Souer mp3s (no key, no
  self-host). ESV audio built (FCBH Bible Brain, NT-only fileset) but waits on `FCBH_API_KEY`. Shared
  `core._USFM_BOOK` + `usfm_titlecase()` (FCBH wants UPPERCASE, openbible title-case).
- **Player evolved through several user passes** (lessons): custom player with skip buttons → then
  "Listen button = play/pause + just a bar" → then moved into the TOOLBAR (icon) → chrono got inline
  per-chapter controls, which were CLUNKY on mobile and got REVERTED to one scroll-aware toolbar button
  (plays the chapter at ~45% mid-screen; bar inline only at the playing chapter in chrono). KEY BUG FIX:
  the play/pause icon must reflect ONLY whether audio is playing (`showPause = audioPlaying`) — tying it
  to the in-view chapter made it flip on scroll ("doesn't catch up").
- **KJV/BSB/ESV now read as continuous PROSE** (`renderFlowVerse`, `.lib-prose-flow`) like ABP — they used
  to render one block per verse everywhere (most obvious in chrono). Word/chip + parallel modes unchanged.
- **Visitor stats — owner-only, in-house.** Tried GoatCounter (one script tag) then REMOVED it for a
  private counter in `notes.db` (`visits` table; daily IP+UA hash, referrer, no cookies/IPs, owner's own
  visits skipped). `views_stats.py`; About → **About|Stats toggle** (not a separate tab; `85-stats.jsx`).
- **One shared site-owner gate:** `views_notes.is_owner()` (`OWNER_EMAIL`, falls back to `ESV_OWNER_EMAIL`)
  — set ONE env var to gate both ESV + Stats. views_esv dropped its local copy. GOTCHA confirmed again:
  the env line must sit ABOVE the app import in the WSGI + reload (module-level read at import).
- Smaller wins: tab remembered across refresh (`localStorage` `lexica.view.v1`); distinct verse-marker
  icons (bookmark ribbon vs note/highlight pencil); desktop chapter label dropped from the toolbar;
  source picker compacted so the owner's 5th button (ESV) fits; verse-menu Note icon-only on mobile;
  all scrollable popouts got `overscroll-behavior: contain` so they don't bleed-scroll the reader.

---

## Words-table rebuild → one self-correcting pass (refactor backlog #2) — DONE 2026-06-09

The rebuild used to be: wipe the word table, rebuild from source, then run a long chain of ~14 patch
scripts in an exact order to fix it back up — the riskiest job in the repo. Now the build fixes
itself. The six shape-keyed, re-runnable cleanup steps run INSIDE the build, per verse
(bracket_punct, g1473_gloss, lord_subject, funcword_subject, lord_oath, greek_pos backfill), in the
same order the old chain used. Only the genuine per-verse patches that a blanket rule would break
stay behind, run by one tail script (`scripts/finish_rebuild.sh`) plus a final punctuation pass.

- **Proven, not hoped.** Built it BOTH ways on a copy of the live database — old way (build + all 14
  patches) and new way (the one self-correcting pass) — and compared every word: **byte-identical**
  (same 624,575 rows, same fingerprint). Tools: `scripts/compare_words.py` (whole-table compare),
  `tests/test_folded_fixes.py` (now in CI + the commit hook).
- **Validated locally first**, on copies in a folder OUTSIDE the repo (`C:\Users\JP\lexica-val`:
  bible.db + bh_scrape.db + the Rahlfs/TAGNT alignment files). The live database was never touched.
  Committed `815c1c6`, pushed, CI green, deployed to PA.
- **Bonus, the one place the new build beats the old chain:** the final punctuation pass also tidies
  ~202 spots where a comma sat on the verb instead of the last word shown in the LORD-subject
  brackets ("said · the LORD,").
- **Kept as small pinned patches (can't fold):** split_merges (237 — a general splitter rule
  regresses ~85 other verses), subject_reorder / mat25_37 / supplied_attach (hand-listed reorder
  verses), theos_filler_tags + kyrios_mistags (a few SOURCE mis-tags you can't rebuild away — e.g.
  Greek "Cyrus" looks like "of the lord"), merge_misses. ~270 verses out of 31,000 — small and stable.
- vs the LIVE database there were 17,498 differences, ALL pre-existing drift (older head-word
  handling + a newer proper-noun list + 3 Cyrus fixes live never got) — none from the fold; the
  old-way rebuild showed the same drift. The standalone fix_*.py scripts are KEPT as re-appliers; on
  a fresh build they find 0 to do.

**THE STANDING LEVER — CHECKED 2026-06-09, DECLINED (keep the patch).** The word-splitter GUESSES
which English word goes with which Greek word by matching the dictionary — that leaky guess is what the
237-verse `fix_split_merges` patch cleans up. The idea was to feed the real word-by-word alignment data
(the Rahlfs/TAGNT files from the pronoun fix) into the splitter (`_split_compounds`) to replace the
guess and retire the patch. A read-only check on the lexica-val copy killed it: that data is Greek-only
— it tells you each Greek word's grammar but never which English word pairs with it, so it can't do the
English-to-Greek matching that IS the splitter's job. It can only act as a grammar filter afterward, and
the filter can't tell a good split from a bad one: allowing only plain nouns/verbs would wrongly throw
away 126 of the 240 good fixes (53% — the good splits land on little words like "and"/"me"/"not" all the
time), and the grammar tag is missing on a fifth of all words. The one clean signal — "never pile a real
word onto 'the'" — covers under half the garbles and the build already guards it. So the frozen
237-verse patch stays: small, stable, proven. **LESSON:** an alignment with no English in it can't
replace an English-pairing step; it can only filter, and a filter can't reconstruct the missing pairing.
Throwaway check scripts: `C:\Users\JP\lexica-val\check_splitter_morph.py` + `check_237_targets_morph.py`.
See memory `project_architecture_rework` (#2) and `project_parser_number_reversal`. DON'T re-investigate.

---

## BSB (Berean Standard Bible) reading text — DONE 2026-06-08

Public-domain modern reading text alongside ABP/KJV. Loaded by `scripts/load_bsb.py` into
`bsb_verses`, served by `views_bsb.py` (`/api/bsb/chapter`); third option in the Library toggle
(commit `4c88501`). Also added an eSword-style in-text search box that searches whichever text you're
reading, via the generic `/api/text-search` (commit `05fe6d5`). No word-level/Strong's data by design.

---

## Free-form Journal — second note mode — DONE 2026-06-09

"Verse notes | Journal" toggle in the Notes tab: plain-text titled pages, a full-page autosaving
editor, riding the same store / sync / Export-Import as anchored notes (`kind:"journal"`, no anchor).
Plus copy + "send verse to journal" from the reader (drag-select bar AND the verse-number menu) into
the page you have open. Detail in memory `project_notes_highlights`.

---

## Front-end "build a word entry" de-dup (refactor backlog #3, front-end half) — DONE 2026-06-08

The three copy-pasted entry-builders now share one core (`entrySnum()` + `wordEntryCore()` in
static/src/00-core.jsx); makeEntry / flattenAiResults / the library makeEntry each spread the core
and add only their own id + extras. No behavior change. Commit `007446c`. Closes the front-end half
of refactor backlog #3 (the backend half was redesign Phase 2).

---

## Notes accounts + sync (email + Google) — DONE 2026-06-09

Built right after the notes feature, same session. Notes started browser-only; the user weighed a
"sync code" (decided too clunky to copy around) and went with real **email + password accounts**,
then added **Google sign-in** too. Because the notes were already stored in the migration-ready
shape (each note has its own id from creation), turning on accounts was a straight copy — nothing
from the browser-only build was wasted.

- It's the **first time the site stores anything a visitor creates** — everything before was
  read-only/no-login. User data lives in its OWN file, `notes.db`, kept separate from the Bible
  database so a corpus rebuild can't touch it.
- Accounts are **opt-in**: the app stays fully usable with no login (notes just stay on that one
  browser). Sign in and your notes follow you to any device.
- Passwords are stored scrambled one-way (never readable). Staying logged in uses a random token,
  not the password. Sync merges by each note's id, newest edit wins; deletes leave a marker so they
  spread instead of coming back.
- Google sign-in is wired so the button only appears once it's fully set up — a half-finished deploy
  can't break the site.
- **Not done:** "forgot password" / set-a-password — that needs the site to send email, which isn't
  set up on PythonAnywhere yet. So a Google-only account has no password to fall back on for now.

Lessons that cost time (in memory `project_notes_highlights`): the site's secrets/keys live in the
**WSGI file** (`os.environ[...]`), not a `.env` — the `.env` on PA was empty and ignored, so the
Google ID had to go in the WSGI file, above the app import, then reload. Diagnose a missing Google
button with `curl <site>/api/auth/config`. And `google-auth` needs a `pip install` in the venv after
pulling (it's in requirements.txt).

---

## Notes & highlights (study notes) — DONE 2026-06-09

Readers can now write study notes and paint color highlights right in the Library, and find them
again later. Built and shipped in one session as small POCs, tweaked live against the user's testing.

- **Where they're kept:** the browser only (`localStorage`) — no database, no login, nothing on
  PythonAnywhere. Decided browser-first on purpose: the saved shape is exactly what a future
  account/sync would use, so moving notes "up to the cloud" later is a straight copy, not a rewrite.
  Each note gets its own id the moment it's created, so merging two devices later won't duplicate.
- **How you make one:** drag-select words → a little bar with 5 highlight colors + a "Note" button;
  or right-click a verse number (long-press on phones) for a whole-verse note. These don't fight the
  existing clicks — a word still opens the lexicon, a verse number still opens cross-references.
- **A note and a highlight are the same thing** — one record that can have text, a color, or both.
- **Finding them:** a new Notes tab lists everything with text search, plus Export (downloads a
  backup file) and Import (merges one back in, safe to re-run). A bookmark shows in the margin of
  any verse that has one.

Lessons / why certain choices: chip mode has no spaces between words, so the saved quote had to be
rebuilt from the chips (not the raw selection). On mobile the browser's own copy/share toolbar fights
a popup near the selection, so the "Add note" bar is pinned to the screen bottom there. The margin
marker had to live *inside* the verse text (indent the first line only) or it shoved every wrapped
line over. Highlights paint only in the text they were made in (ABP word-for-word; KJV/BSB whole
verse) — true cross-translation paint is a known follow-up. Open follow-ups are listed in TODO.md;
full detail in memory `project_notes_highlights`.

---

## AI result cache — unified prompt-fingerprint scheme — DONE 2026-06-09

The four Haiku-backed caches (AI search, reading summaries, TSK cross-refs, person/place blurbs) all
live in the one `ai_search_cache` table but each versioned itself differently: search hashed its own
prompt (good — edit the prompt, the cache auto-refreshes), but summaries used a hand-bumped number you
had to remember to change, and the cross-ref + person/place caches never refreshed on a prompt edit at
all. Fixed: every cache now tags its rows `category:hash-of-its-own-prompt`. Edit any prompt and only
that cache refreshes, lazily, with no manual bump.

- One shared set of helpers in `core.py` (`ai_fingerprint`, `ai_cache_get/put`, `ai_cache_prune`,
  plus a one-time `ai_cache_drop_legacy` sweep). Each cache prunes only its OWN stale rows at startup.
- **The landmine, handled:** search's old startup cleanup deleted every other cache's rows except the
  ones it spared by name. Switching the other caches to the new tag would have made that delete wipe
  them. It's now scoped to search's own rows only. Proven with a focused test (search prune leaves the
  others untouched, and each cache prunes only its own).
- **Per-book authors (the user's call):** a summary's row key stays stable, the author goes only in the
  tag — so editing one book's author refreshes just that book, while editing the prompt wording refreshes
  all summaries.
- LSJ was deliberately left out — it stores its summaries in the lexicon tables, not this cache table.
- One-time cost: the first run after deploy clears the old-format rows, so everything cached before
  regenerates once on next view. Unavoidable when changing the tagging scheme.
- Verified locally without touching the real database: logic test on a throwaway copy + a full app boot
  against a copy of the database (startup cleanup ran clean). Closes refactor backlog #4's cache half;
  the paired prompt-STYLE cleanup is still open in TODO.md.
  `code: core.py helpers, ai.py ~741-805, views_summary.py, views_crossref.py, views_metav.py, app.py startup`

---

## Word click-targets ("dual-ordering") — mostly done

The goal: when one slot bundled several English words, give each its own clickable chip while
keeping both the Greek order (chip view) and the English reading order (prose view) correct.
Again — never a reading bug, just click precision. The mechanism is proven and the bulk shipped:

- **"the LORD" + verb** — split so "the LORD" is its own chip. 795 spots fixed, live 2026-06-05.
  Rollback: `bible_pre_lordsubj_20260605.db`. `script: fix_lord_subject.py`
- **Nouns stuck on a function word** — moved the noun's English back onto its own empty slot.
  Done in three rounds (everyday nouns, then idioms, then plurals/in-bracket cases), 108 fixes
  total, live 2026-06-06. Rollbacks: `bible_pre_funcword_20260606.db`,
  `bible_pre_funcword_idioms_20260606.db`. `script: fix_funcword_subject.py`
- **Scrapped:** a third case (a verb's English wrapping around its subject) — too few, too varied,
  and would need risky row inserts for tiny payoff. Parked for good.

What's left is in the live TODO (the "the"/article cleanup). The proven method if anyone resumes:
always start read-only and measure first; copy the database before any real change; never run a
blanket delete; keep repair scripts narrow, re-runnable, with a dry-run; and add them to the
checklist in CLAUDE.md.

---

## Non-canonical library — built and live (2026-06-07)

A whole shelf of extra texts now lives in the Library under the "Other" menu, walled off from Bible
search and word counts (ABP stays the anchor). All English-only unless noted:
- **Septuagint Apocrypha** (16 books, Brenton 1851).
- **Pseudepigrapha** — 1-2 Enoch, Jubilees, 2-3 Baruch, Apocalypse of Abraham, Assumption of Moses,
  2 Esdras/4 Ezra, Life of Adam and Eve, Psalms of Solomon, Letter of Aristeas, Ascension of Isaiah,
  Sibylline Oracles (mostly R.H. Charles; sources per-book in memory).
- **Testaments of the Twelve Patriarchs** (12 separate books, Charles).
- **Apostolic Fathers** (14, incl. Didache) — these have the **full Greek interlinear**, same
  word-study layer as the Bible: Brannan/Lake Greek → Strong's (openscriptures + Dodson glosses) →
  Lightfoot English. Polycarp ch 10-14 survive only in Latin → English-only there.

How it's built (generic, re-runnable): each text gets its own two tables `<book>_words` /
`<book>_verses`, served by `/api/extra/<book>/chapter/<n>`, loaded by `scripts/load_extra.py`. Adding
a future text = tag it, drop two json files, add one line to `NONCANON`, load. `englishOnly:true`
locks the reader to Prose for texts with no original-language tagging. The full pipeline, source URLs,
and per-book parsing quirks are in memory `project_noncanonical_texts`. Still open (in the live TODO):
more books (Jasher, 4 Baruch…), optional hand-written headings, wiring these into the Lexicon/Search
tabs, and the Hebrew-interlinear gap.

---

## Search results now match the Library look — done

The AI search result verses were restyled to match the polished Library reading view: plain word
chips in reading order, no Strong's clutter, brackets kept, gold highlights kept (same as Library's
chip mode). Also stopped re-fetching each verse's words one at a time — the search response now
carries the words the server already built. `code: Search results in static/src/70-search.jsx`

---

## Lexicon tab — finished (ongoing polish only)

The word-study flow (search → word profile → gloss chips → book distribution → verse list) is done
and reads cleanly, matched to the Library look. Anything left is minor spacing/hierarchy polish done
as noticed — nothing structural. `code: LexiconView in static/src/80-lexicon.jsx`

---

## Full corpus audit — done, corpus is sound (2026-06-05)

Checked all ~624k words against independent reference texts. **Verdict: the corpus is sound.**
- Internal consistency check: zero of the pronoun-class corruption that bit us before.
- External agreement: ~92% match against the reference Greek texts. The other 8% is *not* error —
  it's genuine edition/translation differences and proper-noun number quirks. **100% is the wrong
  target** (it would mean rewriting our text into theirs) — don't chase it.
- One real issue found and fixed: 1,724 pronoun slots labeled with the wrong person, corrected.
  Rollback: `bible_pre_g1473gloss_20260605.db`. `script: fix_g1473_gloss.py`
- A residual ~1,069 cases are blocked on missing grammar data — not chased, not worth guessing.
- Audit scripts are read-only and in the rebuild checklist. `scripts: audit_corpus_tier1/2.py`

---

## Word-order garble fixes — done (2026-06-05)

A rebuild had left some multi-word phrases reading backwards or bundled wrong.
- **"this/that of X" over-reach** — fixed; 3,438 verses corrected. Rollback:
  `bible_pre_splitfix_20260604.db`.
- **Bracketed phrases reading scrambled** — fixed; 374 → 0. (Memory: project_bracket_order_fix.)
- **Hab 3:14 showed up twice** — root cause was a duplicated line in the source text file; removed
  at source and cleaned the live database. `script: fix_hab314_dupes.py`
- **Punctuation on the wrong word** — fixed (365 verses). `script: fix_bracket_punct.py`
- Known harmless false alarms in the old audit tools (~8 twin-bracket flags) — database is correct,
  **don't re-chase them.**

---

## Lexicon coverage for pronouns — done (2026-06-04)

Made sure pronoun forms (this/that/who/me/you in all their endings) resolve to a real dictionary
entry instead of a terse fallback. Found the big paradigms already resolve fine; added a handful of
small redirect stubs for the few genuine gaps. Rollback for the stubs is a one-line delete (in the
memory note). Reopen only if a specific word is reported showing the terse gloss.

---

## Text structure — done

- **Section headings** added across the whole canon (2,431 of them), shown in chip/prose/parallel.
  (Song of Solomon has none — the source doesn't carry them; not a bug.)
- **Prose reading mode** — normal books flow as paragraphs with small verse numbers; poetry keeps
  one line per verse.
- **Font size control** — A−/A+ buttons, remembered in the browser.

---

## Reader typeface picker — TRIED + REVERTED (2026-06-11)

Built a "Reading font" picker (Source Serif default · Cardo · Gentium) in the text-style menu, then
**pulled it the same day** (commits 8a9a635/6a08858 in, f1f96a5 out). **Why it failed:** the reader
was already on Source Serif 4 — a good serif — so this was a preference toggle, not an upgrade. The
two alternatives both looked worse on the user's Windows display (Cardo renders thin/rough; Gentium
also disliked). Replacement candidates (Literata, EB Garamond, Noto Serif) didn't win either, so the
user scrapped the whole picker rather than keep weaker fonts. **Lesson: don't re-add a serif picker —
Source Serif is the keeper.** What DID work and is worth remembering if this ever comes back: scope a
font swap to the reader by overriding `--f-serif`/`--f-greek` inline on `.lib-reading` (custom props
inherit, so the rest of the app is untouched); Google fonts lazy-load (the binary downloads only when
a glyph renders); and Cardo/Gentium need a Hebrew fallback (Frank Ruhl Libre) since they carry no
Hebrew — that fallback DID render cleanly (no boxes). Memory `project_reader_appearance`.

---

## Pronoun number fix + grammar display — done (2026-06-04)

Live as rebuild #6. Rollback: `bible_pre_morph_20260604.db`. (Memory: project_pronoun_fix_path_c.)
- Added word-grammar data (part of speech, tense, case…) covering ~78% of words.
- Fixed "he is a prophet" word order (Gen 20:7) and a couple of related ordering cases.
- Word grammar now shows in plain English in the word pop-up for ABP Greek (e.g. "Verb · Aorist ·
  Active · Indicative · 3rd person · Singular").

---

## MetaV (people & places) — done

- People sidebar (bio, family, genealogy) and places sidebar (map + coordinates), with proper-noun
  clicks routed correctly in both ABP and KJV.
- Hebrew names route to the people/places view with the Hebrew dictionary stacked below; clans
  (the "-ites") are labeled "People / Clan". When a name has no data, a short AI blurb fills in
  (text-first, cached).
