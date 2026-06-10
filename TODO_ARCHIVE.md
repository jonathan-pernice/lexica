# TODO — Archive (finished & scrapped work)

History and "don't redo this" notes. Nothing here is open. Deep detail lives in the
memory files; this is the plain-English record plus the rollback database names and the
few "leave it alone" verdicts worth keeping.

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

**THE STANDING LEVER (if these last scripts ever bug you):** the word-splitter GUESSES which English
word goes with which Greek word by matching the dictionary — that leaky guess is what the 237-verse
`fix_split_merges` patch cleans up. We already have real word-by-word alignment data (the Rahlfs/TAGNT
files used for the pronoun fix). Feeding that into the splitter (`_split_compounds`) to replace the
guess could retire split_merges entirely. Big, risky project — the splitter is load-bearing — so a
deliberate future effort, copy-first, only when wanted. See memory `project_architecture_rework` (#2)
and `project_parser_number_reversal`.

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
