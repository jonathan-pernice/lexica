# TODO

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

## Full Corpus Audit — verify the whole text output (queued 2026-06-04)

GOAL: a single rigorous audit report over all ~624k word rows — Strong's tags, interlinear
Greek lemmas, English glosses, and word order. PRINCIPLE (learned from the αὐτός/G1473 fix):
you can't audit a corpus against itself — audit by TRIANGULATION against independent witnesses.
Now newly possible because the `morph` + `lemma` columns exist (rebuild #6). Run when the
active feature work is settled, NOT mid-change. Output is ONE report = near-clean bill of
health on numbers/lemmas (objective) + a prioritized SUSPECT list for English (subjective).

HONEST CEILING (state this up front so nobody expects a clean "all-correct" on English):
- **Strong's tags + Greek lemmas** → highly auditable; independent ground truth exists
  (Rahlfs OT, TAGNT NT) + internal cross-checks. Can approach a verifiable verdict.
- **English correctness + word order** → only PARTIALLY auditable. The English is ABP's own
  human translation; there is NO machine ground truth for "is this gloss right / in the right
  order." Can verify STRUCTURE (ordering invariants, orphan slots) and FLAG semantic suspects
  (LLM), but cannot mechanically PROVE the translation correct. Ceiling = human review.

### Tier 1 — internal consistency (no external data, pure SQL, ~seconds; do FIRST)
Highest value per effort; extends `health_check.py`. The four signals on each word must agree:
- **Strong's ↔ lemma**: compare `words.lemma` vs `lexicon[SUBSTR(strongs_base,2)].lemma`
  (G-words) — a mismatch is exactly the αὐτός/ἐγώ defect, now catchable for EVERY word,
  zero external files. (This single check would have caught the original corruption instantly.)
- **Strong's ↔ morph**: verb-number with a noun morph (or vice-versa) → flag.
- **Slot integrity**: Greek+Strong's present but empty English; English with no source word
  (beyond known italic/supplied); orphan brackets; greek_pos gaps. (Some already in health_check.)

### Tier 2 — external alignment (Rahlfs OT / TAGNT NT; refs + aligner already on PA)
`lxx_align.py` already aligns ABP↔reference by position — the pronoun fix used it on G1473
slots only. A full audit = the SAME run in "report everything" mode (new `--audit` mode):
diff EVERY word's Strong's and lemma vs its aligned reference token. Partition the flags:
- number/lemma **contradicts ABP's own English gloss** → likely REAL error (reuse the
  gloss-consistency guard that drove pronoun MISMATCH to 0),
- **textual divergence** (ABP=Vaticanus/Sixtine vs Rahlfs=eclectic) → expected, NOT an error,
- **alignment gap** → needs a look.
The partition is the whole trick — separates "bug" from "legitimately different text."
Est. a focused session; reuses existing files (~/LXX-Rahlfs-1935, ~/TAGNT_*.txt).

### Tier 3 — semantic English pass (LLM-assisted, fuzzy; decide separately if worth the spend)
- Batch each word's (lemma, Strong's gloss, ABP English) through Haiku: "does this English
  plausibly render this Greek word?" → flags gross mismatches (e.g. a noun gloss on a verb).
  Produces a SUSPECT list, never "all correct." At 624k rows it's a real cost/time call —
  run on suspect CLASSES first (e.g. only Tier-1/2 flagged rows), not the whole corpus blind.
- Word order: mostly the structural ordering checks (symptom #2 class); true faithfulness
  needs sampling + human/LLM review. Inherently judgment, not pass/fail.

DELIVERABLES: extend `health_check.py` (Tier 1) + add an `audit_align.py` / `lxx_align --audit`
mode (Tier 2); Tier 3 is an optional `audit_english_llm.py` gated on a go/no-go on cost.
Would make this the most rigorously-audited ABP digital edition in existence — nobody
downstream of ABP audits the source at all (see the αὐτós saga, memory
`project_pronoun_strongs_corruption`).

## ✓ _split_compounds demonstrative over-reach — "this/that of X" — DONE + LIVE (2026-06-05)

FIXED and live on bible.db (rollback `bible_pre_splitfix_20260604.db`). Solution = the
**leading-run rule, gated to NON-bracketed head slots** (build_words_from_abp.py
`_split_compounds`, commits 6755053 + 52e1002): a redistributed gloss word is fronted only
when no kept "own" word precedes it AND the head slot is non-bracketed (`bid is None`).
- WHY the non-bracket gate: non-bracketed slots render straight from `position`, so the
  fronting swap visibly garbled them ("this of possession", "the of LORD", "LORD the was
  enraged"); bracketed slots render in abp_pos order via `_sort_brackets`, so the swap is
  invisible there AND the redistribution keeps a useful separate chip — leave them alone.
- HEAD-vs-TARGET resolved (the open question): head = the content/noun slot bearing the
  bundled gloss; target = the following empty function-word slot. So "the LORD" (leading
  "the") still splits; "of **this** possession" (kept "of" before "this") stays whole.
- VALIDATION method that worked: `--test` trace → build to `bible_test.db` (copy-first) →
  **position-INDEPENDENT** diff `scripts/diff_split_fix.py` ((strongs,english) multiset per
  verse; bracket-aware [BRK]/[non-brk] tags). Final impact = **3,438 verses fixed**, all clean
  garble-fixes across books (1Ch/2Ch/Jer/Gen/1Co spot-checked), 0 health warnings, strongs_base
  invariant 0, repair counts identical to rebuild #6. Canaries confirmed live: Jer 32:14 "of
  this possession", Gen 2:12 "of that land", Gen 3:8 "of the LORD", 2Ch 6:10 triple-fix,
  1Ch 13:10 "the LORD was enraged".
- ATTEMPT-1 lesson held: target-POS was the wrong axis; gloss word-order (leading-run) is right.
  The [BRK] tag in the diff is per-strongs and NOISY — judge cases by content, not the tag.
- KNOWN RESIDUAL (spawned as separate tasks — all PRE-EXISTING, NOT regressions): (1) content-
  noun chip bundled onto a neighbor verb loses its own chip in non-bracketed cases (reading
  correct, click less granular) — restore later via bracket+abp_pos dual-ordering; (2) complex-
  bracket reorder garbles with tangled/missing abp_pos ("the and LORD", 1Ch 15:13); (3)
  punctuation riding the wrong token ("mourned many, days", 1Ch 7:22). Leading-run does NOT
  touch (2)/(3) — they live in the bracketed/abp_pos layer.

---

### Original brief (kept for history — queued 2026-06-04)

`_split_compounds` pulls a word out of an already-correct multi-word gloss into a
following empty slot and FRONTS it (position swap). For a front determiner this is
right ("the LORD", "their gatherings" — split off "the"/"their" → correct). But when
the matched word sits AFTER a kept word (esp. a preposition), fronting reorders wrongly:
- Jer 32:14 source `of this possession!G2934.3 G3778` → DB renders "the scroll **this of
  possession**" (should be "of this possession"); "this"(οὗτος) pulled into G3778 + fronted.
- Gen 2:12 "of that land" → "that of land" (same, ἐκεῖνος).
Facet (a) already fixes the copula sub-case (skip εἰμί/G1510 as a target).

ATTEMPT 1 REVERTED (2026-06-04): a morph-POS gate skipping ALL pronoun/article/
demonstrative (CATSS R*) target slots. Build+diff vs live showed it changed **11,036
verses / 34,032 slots** — it correctly stopped "this/that of X" BUT also bundled the
beneficial re-separation of "the"/"their"/"her"/"my" determiners corpus-wide ("the LORD"
→ one chip, article G3588 emptied; reading unchanged but loses the separate clickable
article/possessive). Target-POS can't tell "front determiner (split it)" from "middle
word after a preposition (don't front it)". Commits 924f53c+bdd11d4 reverted.

REAL FIX (next attempt): key on **gloss word-order**, not target POS — candidate is the
"leading-run" rule: only redistribute+front a word with no kept "own" word before it, so
"the LORD"/"their X" (determiner first) still split but "of **this** possession" / "he
**is** a prophet" stay whole. BUT this is UNCONFIRMED — see caveats.

CRITICAL METHOD FIXES (attempt 1's mistakes, do NOT repeat):
- **The diff must be POSITION-INDEPENDENT.** Attempt 1 compared `english` at the same
  (verse_id, position) old-vs-new; redistribution shifts positions, so one real change
  cascades into many spurious per-position diffs. The "11,036 verses / 34,032 slots" figure
  is therefore INFLATED/unreliable — it does NOT mean 11k regressions. Re-measure by
  comparing, per verse, the position-INDEPENDENT `(strongs_base → english)` mapping (sorted
  by strongs, or a multiset) — that isolates real redistribution changes from shuffles.
- **First TRACE `_split_compounds` on real rows** until the swap (L~312) is fully understood.
  Open question attempt 1 could not resolve: for "the LORD", is the article the HEAD (own,
  bears the bundled gloss) or the TARGET (taken)? That determines whether the leading-run
  rule preserves the split or bundles it. Print rows before/after for a "the LORD" verse.
- Then: build-to-`bible_test.db` + position-independent diff + eyeball, before any swap.
- Watch object-fronting (object glossed at END, "[²hatred ¹I will put]") for regressions.

Live (rebuild #6) is correct and untouched — this is the only remaining symptom-#2 facet.
Relates to the ABP eSword re-source idea (project_abp_esword_fidelity) — the source bundles
these glosses, so a re-source may dissolve the problem.

## LSJ coverage audit — generalize the pronoun-stub fix (✅ PRONOUN CLASS DONE 2026-06-04)

✅ **Pronoun paradigms audited and closed (2026-06-04).** Morph-driven audit (distinct Greek
`strongs_base` whose `morph` GLOBs a pronoun tag → `lexicon.lemma` → exact-key test) over
demonstratives/relatives/αὐτός-obliques/reflexives/interrog-indef. STRUCTURAL FINDING: the big
paradigms DON'T dead-end — αὐτός (G846), demonstratives (οὗτος G3778, ἐκεῖνος, ὅδε), relatives
(ὅς G3739, ὅστις) collapse ALL case forms onto ONE Strong's with a NOMINATIVE lemma that has a
full LSJ entry, so τοῦτον/ὅν/αὐτόν resolve as οὗτος/ὅς/αὐτός. Reflexives + σός have own entries.
Only 3 genuine new gaps → fixed with stubs: **ἐμοῦ(G1700)/ἐμοί(G1698)/ἐμέ(G1691) → `v. ἐγώ`**
(emphatic 1st-sing, same class as the enclitic μοῦ/μοί/μέ stubs). τὶς(G5100) was a FALSE flag
(exact-key test misses the plain fallback; strip_accents('τὶς')='τις' already hits the full `τις`
entry). τηλικοῦτος(G5082, 4×) optional `v. τηλίκος`. Verified in-app (σέ→σύ, ἐμ-→ἐγώ). See memory
`project_pronoun_fix_path_c.md` (LSJ pronoun-coverage AUDIT block). Rollback = `DELETE FROM lsj
WHERE key IN ('ἐμοῦ','ἐμοί','ἐμέ','τηλικοῦτος')`.

RESIDUAL (optional, lower value): a corpus-wide sweep of NON-pronoun inflected forms. Likely
near-empty — `lexicon.lemma` for verbs/nouns is already the dictionary headword (present 1st-sing
/ nominative), so they resolve directly; the pronoun class was special because of case-split
Strong's numbers. Re-open only if a specific non-pronoun word is reported showing the terse gloss.

--- ORIGINAL TASK NOTES (kept for the method) ---

Inflected Greek forms whose dictionary headword is a *different* word have no own LSJ key,
so `/api/lsj` falls through to the terse Strong's gloss (e.g. σέ → "thee"). 2026-06-04 we
fixed the personal-pronoun families by adding 11 "v. <base>" stub rows to `lsj`
(σέ/ὑμεῖς/ὑμᾶς/ὑμῖν/ὑμῶν→σύ; μέ/μοί/μοῦ→ἐγώ; ἡμᾶς/ἡμῖν/ἡμῶν→ἡμεῖς) — see memory
`project_pronoun_fix_path_c.md` (LSJ note). That was SCOPED to those forms only.

This task = the corpus-wide version:
- AUDIT: for every distinct `lexicon.lemma` the `words` table actually uses (G-numbers),
  check whether it resolves in `lsj` (exact `key`, accent-strip via `plain` =
  `lower(strip_accents(lemma))`, or an existing "v. X" xref stub) vs falls to the Strong's
  gloss. List the misses by frequency. NOTE: `strip_accents` is an app-registered SQLite
  fn (not in the bare CLI) — run the audit via a small read-only Python script using the
  app's `db()` connection (or replicate NFD-strip in Python).
- FIX only the misses that are an **inflected form of an existing LSJ headword** — add a
  `<b>FORM</b>, v. <i>BASE</i>.` stub with `plain=lower(strip_accents(FORM))`, exactly like
  the σέ fix; the generic `_resolve_lsj_xref` then follows it. Likely paradigms still
  unaudited: αὐτός obliques (αὐτόν/αὐτοῦ/αὐτῷ/αὐτήν…), demonstratives (οὗτος/τοῦτον/ἐκεῖνος),
  relatives (ὅς/ὅν/οὗ/ᾧ), reflexives (ἑαυτοῦ/σεαυτοῦ/ἐμαυτοῦ), interrogative/indefinite (τίς/τινος).
- DO NOT stub genuinely-absent rare words (no base headword exists) — they correctly keep the
  Strong's gloss. No code change, no rebuild — pure `lsj` data (idempotent INSERT OR IGNORE).

## Priority: Lexicon tab & AI corpus search (ORPHANS — need a focused pass)

Two areas the user flagged as under-attended and needing real attention. **Start each by
AUDITING the current implementation before planning** — neither was deeply reviewed in the
2026-06-03 session, so read the code first and propose a plan.

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
  Haiku Berean prompt, key_strongs chips, empty-result retry, Hebrew bridge, corpus filters
- Related work already specced below in "Search Layout Revamp" (bare-chip verse rendering, N+1 fetch fix)
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
- **✓ AI search verse display** — Strong's numbers hidden (`display:none`). Word tokens kept for gold highlights and word clicks.
- **Search verse rendering direction** — target is "bare chips": word tokens in source order, no Strong's, no interlinear Greek row, brackets preserved, gold highlights intact. Matches Library chip mode visually. Backend: eliminate N+1 `api.verseWords` fetches by including full verse word lists in the AI search response (currently re-fetched even though `_fetch_verse_words` already ran server-side).

## ✓ Text Structure Session — DONE

### ✓ Pericopes / Section Headings
`pericopes` table created and populated (2431 headings, full canon). Backend: `chapter_text()` LEFT JOINs pericopes, folds `heading` into verse object. Frontend: `renderVerse()` injects `.pericope-heading` div before verse when heading is present. Works in chip, prose, and parallel (ABP column only). Note: Song of Solomon has 0 headings — BibleHub doesn't carry them; not a bug.

### ✓ Prose Mode — Continuous Flow
Non-poetry books wrap as a single flowing paragraph in prose mode with inline verse-number superscripts. Poetry books (Psa/Pro/Job/Son/Lam/Ecc) keep line-per-verse. `renderProseWords()` helper shared by both paths.

### ✓ Font Size Preference
A−/A+ in desktop lib-bar and mobile modes sheet. `--lib-font-size` CSS custom property on `.lib-reading`. Persisted in localStorage. Defaults: 15px mobile / 18px desktop. Range 13–24px.

## ✓ Symptom #2 + Morphology Session — DONE (2026-06-04)

Live on `bible.db` = rebuild #6 (rollback `bible_pre_morph_20260604.db`). Detail in memory
`project_pronoun_fix_path_c.md`.
- **✓ morph + lemma columns** — `words.morph` + `words.lemma`, populated from the existing
  Rahlfs(CATSS)/TAGNT alignment (78%; NULL only where the source is blank). Commit 998b92c.
- **✓ Symptom #2 facet (a) — copula reorder** — Gen 20:7 "he is a prophet" (was "is he…").
  `_split_compounds` no longer extracts the copula (εἰμί/G1510) into its own slot. Commit 90c911e.
- **✓ Symptom #2 facet (c) — chip Strong's anchoring** — multi-word-gloss chip puts the
  Strong's/lemma superscript on the morph-resolved head (content→`english_head`, function→
  firstNonItalic), not blindly the first word. Jer 32:14 G5087 now on "put". Commit 675ba46.
- **✓ LSJ pronoun definitions** — 11 oblique "v. ‹base›" stub rows in `lsj` (σέ→σύ etc.) so
  inflected pronouns resolve to their dictionary entry, not the terse "thee". Data-only.
- **✗ Symptom #2 demonstrative ("this/that of X")** — attempted, REVERTED (broad gate
  regressed); requeued above as "_split_compounds demonstrative over-reach".
- **Still open: facet (b)** — possessive split ("your rod": "your" rides the noun slot,
  σου empty). Cosmetic, lowest priority; the last untouched symptom-#2 facet besides demonstrative.

## Planned Features

### ✓ Prose Reading Mode — DONE
Chip/Prose toggle live. Prose renders clickable inline word spans, no chip borders. Continuous flow and poetry detection complete (Text Structure Session).

### ✓ Morphology Display — DONE + LIVE (2026-06-04, commits ab6657b + e90f2ff)
Word-click sidebar now renders the `morph` parsing in plain English under the headword
(e.g. "Verb · Aorist · Active · Indicative · 3rd person · Singular"). Frontend-only:
`decodeMorph()` in app.jsx (per-scheme tables — CATSS dotted OT / Robinson hyphen NT, since
the letters conflict: CATSS perfect=X/imperative=D vs Robinson perfect=R/imperative=M),
`morph` plumbed through the Library makeEntry, one muted `.detail-morph` line, ABP Greek only
(Hebrew/PN/NULL hide cleanly). Verified in-app: V.AAI3S verb, RP.NS pronoun (Gen 3:15 σύ / 6:13
ἐγώ → "Pronoun · Nominative · Singular"), NT Robinson, Hebrew/`*` omit. Decoder handles
person-prefixed Robinson pronouns (P-1GS), trailing name markers (N-GSM-T), PRT-N,
indeclinables (N-PRI/A-NUI), 2nd aorist.
RD-class disambiguation (commit e90f2ff): CATSS lumps αὐτός, the reflexives (ἑαυτοῦ/σεαυτοῦ/
ἐμαυτοῦ), the reciprocal (ἀλλήλων) and the true demonstratives all under RD. `_CATSS_RD_LEMMA`
maps by lemma (passed in as entry.greek, NFC-normalized) → αὐτός="Pronoun" (matches Robinson
P, 19.4k words), ἑαυτοῦ…="Reflexive pronoun" (547), ἀλλήλων="Reciprocal pronoun"; default for
the rest (οὗτος/ἐκεῖνος/ὅδε/τοιοῦτος) stays "Demonstrative pronoun". Verified in-app: αὐτός
(Gen 4:4) → "Pronoun · Nominative · Singular · Masculine". So OT now matches the finer P/F/C/D
distinctions Robinson already encodes. Original kickoff brief below for reference.

### ★ Morphology Display — KICKOFF (data DONE 2026-06-04 · display PENDING · NEXT SESSION)

GOAL: when a Greek word is clicked, show its grammatical parsing in plain English in the
word-detail sidebar, e.g. **"Verb · Aorist · Active · Indicative · 3rd person · Singular"**
or **"Noun · Genitive · Singular · Feminine"**. Pure display feature — NO rebuild, NO DB
writes, frontend-only (+ maybe a tiny serialization confirm). This cashes in rebuild #6's
`morph` column, which today only facet (c) reads internally.

STATE (already done, don't redo):
- `words.morph` populated (rebuild #6, ~78%; NULL where the source was blank — just hide the
  line then). `words.lemma` also populated.
- `morph` is ALREADY serialized to the frontend as `w.morph` in BOTH word endpoints:
  `chapter_text` (app.py ~L2486) and the verse-words endpoint (app.py ~L1697). Verify it
  reaches the detail panel; if `makeEntry`/detail-entry construction drops it, add `morph: w.morph`.

THE WORK = a decoder + sidebar render:
1. **Enumerate the real codes first** (frequency-ordered, cover the bulk):
   - OT/CATSS (dotted): `sqlite3 bible.db "SELECT morph,COUNT(*) FROM words WHERE morph LIKE '%.%' GROUP BY 1 ORDER BY 2 DESC LIMIT 80;"`
   - NT/Robinson (hyphen): `sqlite3 bible.db "SELECT morph,COUNT(*) FROM words WHERE morph LIKE '%-%' GROUP BY 1 ORDER BY 2 DESC LIMIT 80;"`
2. **Write `decodeMorph(morph)` → string** (pure JS, app.jsx). Detect scheme: contains '.' = CATSS, '-' = Robinson, else single-letter POS (C/X/D/P…). Two morph schemes (verbs start `V` in both):
   - **CATSS** `POS.PARSE`: nominals `N./A./RA./RD./RP.` + `‹case›‹number›‹gender›` (case NVGDA = Nom/Voc/Gen/Dat/Acc; number S/P/D; gender M/F/N). Verbs `V.` + `‹tense›‹voice›‹mood›` then person+number, or +`‹case/num/gen›` for participles. Tense P/I/F/A/X/Y (pres/impf/fut/aor/perf/plup), voice A/M/P, mood I/D/S/O/N/P (ind/impv/subj/opt/inf/ptcp). Singles: C=conjunction, X=particle, D=adverb, P=preposition, I=interjection.
   - **Robinson (TAGNT)**: `POS-PARSE`. `N-NSM`/`A-ASF`/`T-NSM`/`P-GSM` = `‹case›‹number›‹gender›`. `V-AAI-3S` = tense-voice-mood then person-number (note leading `2` = second aorist, e.g. `V-2AMS`). Word-POS tags: `CONJ`/`PREP`/`ADV`/`PRT`/`COND`/`INJ`. **The TAGNT source files have a legend in their header `#` lines** — read it for the authoritative Robinson key.
   - Build from the frequency list so the top ~40 codes/scheme cover most of the corpus; degrade gracefully (show raw code or skip) on anything unmapped.
3. **Render** in the word-detail sidebar near the lemma/Strong's (the LSJ panel — see `api.lsj`
   call ~app.jsx:633 and the hero render ~app.jsx:679). One muted line under the headword.
   ABP G-words only (KJV/Hebrew/`*` proper-noun slots have no `morph` → omit cleanly).

GOTCHAS: ~22% NULL morph (hide, don't show "unknown"); the P/A/etc. letters are
POSITION-dependent in CATSS (P = present OR passive OR participle by slot); don't confuse the
display `morph` with facet (c)'s anchor use. Reference legends: TAGNT header lines (Robinson),
CCAT/CATSS morphology codes (Rahlfs repo `03a_morphology…`).

### ✓ Parallel Mode Versification Alignment — DONE
Audited: ABP and KJV both use MT-style verse numbering, so they align in Parallel mode — no
systematic off-by-one (Psalms specifically audited, memory `project_pericopes_parallel`). No
offset-map needed; residual one-off gaps are inherent LXX/MT text differences, not a bug.

## MetaV

### ✓ People & Places — DONE
People sidebar (bio, relationships, genealogy), places sidebar (Leaflet map, coordinates), proper noun routing in both ABP and KJV. All live.

### ✓ Hebrew PN + gentilic handling — DONE (2026-06-03)
- Hebrew proper nouns route to metaV (person/place) with BDB stacked below (KJV-style); badge shows real H-number.
- Person/place default: Person, flips to Place only on a prefix-exact strongs_g match (pn_type untrusted — tipnr PK collision).
- Gentilics (-ite/-ites: Hivite, Sinite…): labeled "People / Clan", place card headed "Homeland", AI summary fires on the clan tab.
- AI curation (`/api/metav/ai-description`, Haiku, cached `pn:` key, text-first prompt) fills groups with no metaV/BDB.

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
