# TODO — Archive (completed & scrapped work)

Completed/scrapped items moved here from TODO.md on 2026-06-06 to keep the live list
focused on open work. Kept for history + method notes. Nothing here is open.

---

## ★ DUAL-ORDERING pilots — DONE / SCRAPPED (open remainder stays in TODO.md)

Full context: memory [[project_bracket_order_fix]] ("DUAL-ORDERING project").
NOT a bug — reading is correct everywhere; this is a precision/clickability upgrade.
THE ONE IDEA: split a bundled gloss onto its OWN Greek slot while keeping BOTH orders
correct — `position` = Greek/source order (CHIP), `greek_pos` = English reading order (PROSE).

✅ **PILOT #1 (κύριος-subject) DONE + LIVE 2026-06-05** — `scripts/fix_lord_subject.py` (post-build
repair, no rebuild, UPDATE-only: the empty κύριος slot already exists). 795 `(the) LORD <verb...>`
slots split: "the LORD" → its own κύριος/G2962 chip (greek_pos=1), verb keeps its gloss (greek_pos=2),
bound in a new bracket. CHIP stays Greek order, PROSE reads "the LORD <verb>". audit REPAIRABLE 795→0,
OK +795, health 0/0, audit_bracket_order at baseline, idempotent. Rollback `bible_pre_lordsubj_20260605.db`.
Added to the CLAUDE.md post-rebuild repair chain (runs last). **The dual-ordering mechanism is PROVEN.**

✅ **#2 ROUND 1 (function-word nouns) DONE + LIVE 2026-06-06** — `scripts/fix_funcword_subject.py`,
applied 21. Concrete nouns (God/judgment/heart/name/riches/city/part/side/east-north-west…) bundled
onto an adjacent function-word slot (article G3588 / preposition) with the noun's OWN slot empty beside
it → clicking the noun opened the article/prep. Fix RELOCATES the English onto the noun's empty adjacent
slot + blanks the function word; one slot always empty ⇒ word order UNCHANGED, no brackets/greek_pos/
reorder (can't garble). health 0/0, bracket_order baseline, idempotent. Rollback `bible_pre_funcword_
20260606.db`. In the CLAUDE.md repair chain after fix_lord_subject. Slice A (bracket-internal collapse)
was confirmed EMPTY (audit_bracket_collapse.py GENUINE-COLLAPSE=0 — subsumed by 0a4b146). Read-only
scopers added: `audit_funcword_wrongslot.py`, `audit_bracket_collapse.py`.

✅ **#2 ROUND 2 (idioms) DONE + LIVE 2026-06-06** — `fix_funcword_subject.py --include-idioms`, applied 75
(κατὰ πρόσωπον "in front/person/face" G4383 + ἐν τάχει "quickly" G5034). 96 total across rounds 1+2.
health 0/0, bracket_order baseline, idempotent. Rollback `bible_pre_funcword_idioms_20260606.db`. Chain now
runs `--include-idioms` to restore all 96.

✅ **#2 ROUND 3 (plurals + in-bracket) DONE + LIVE 2026-06-06** — `--include-idioms --include-bracketed`,
applied 12 (5 plural fruits/judgments/places/myriads + 7 in-bracket way/place/year/time/part + 2 πρόσωπον).
gloss_has() plural-stems; --include-bracketed carries greek_pos so audit_bracket_order stays baseline.
**108 total across rounds 1+2+3.** Rollback was `bible_pre_funcword_idioms_20260606.db` (round 2; round 3
applied on top, health 0/0). Chain runs `--include-idioms --include-bracketed`.

⛔ **#3 (wrapped verb-gloss INSERT) SCRAPPED 2026-06-06** — scoped read-only (audit_verbwrap.py); the
clean core is small, heterogeneous (μὴ γένοιτο idiom, εἰμί copulas we don't touch, negative-particle
hosts), needs per-case inserts, and the 1Pe 5:10 headline shape isn't even in the empty-verb net. Minor
payoff (click-target only; verbs read fine), real row-insert risk. Parked indefinitely.

ORIGINAL KICKOFF BRIEF (kept for method) — the three same-shape use cases:
  1. **κύριος-subject (~879, HIGHEST VALUE)** — "the LORD was enraged" bundled onto the VERB (G2373).
     Dry-run 1Ch 13:10 CONFIRMED the empty κύριος/G2962 slot ALREADY EXISTS after the verb (not an
     insert-row case). Blockers: (a) `_split_compounds` leading-run guard keeps "LORD" on the verb
     (supplied "the" fails to redistribute, sets seen_own=True — LOAD-BEARING for "of this possession",
     don't rip out); (b) English subject-verb vs slot verb-subject (Greek) → naive move garbles →
     need dual-ordering (position vs greek_pos).  → SHIPPED as pilot #1.
  2. **Split out brackets (user-flagged)** — bracketed multi-word glosses share ONE Strong's
     ("and the LORD" = 3 chips all on G2962). Give each bracket token its own slot by `abp_pos`.
  3. **Verb-gloss fragment wrapped around the subject (1Pe 5:10 "may he ready" / Joh 4:51 "as he")**
     — "may"/"as" is part of a REAL Greek VERB's gloss that wraps AROUND the subject in English, so it
     rides αὐτός/G846. Fix = its own inserted cell tagged with the VERB'S Strong's. The ONE sub-case
     needing an INSERTED row. → SCRAPPED (#3 above).
  NON-GOAL — true italics (translator-supplied words with NO Greek): get NO Strong's, NO new cell;
  stay INERT (muted, never borrow a neighbor's Strong's on click). Display-only.
KICKOFF METHOD / CONSTRAINTS (still apply to any remaining wrong-slot work): START READ-ONLY, scope
  first. Tools built: `audit_lord_strongs.py`, `audit_bracket_order.py`, `count_redistributions.py`
  (~10,058 non-bracket splits ALREADY done this way = proof), `diff_split_fix.py` (position-independent
  diff). bible.db PA-only (give run commands); COPY-FIRST (cp → --test dry-run → build to bible_test.db
  → diff_split_fix → health_check 0/0 → strongs_base GLOB '[0-9]*'=0 → audit_bracket_order +
  audit_lord_strongs → tier1/tier2 → swap); NEVER `DELETE FROM words`; repair scripts touch only needed
  columns + `--dry-run` + idempotent + ADD to the CLAUDE.md checklist. Leading-run logic is FRAGILE
  (attempt-1 reverted) — validate position-INDEPENDENTLY, never per-position diff.
SHIPPED (easy half, 2026-06-05): κύριος ANCHOR-MORPH display fix — 552→3 LORDs recovered via the
  frontend `strongsAnchorIndex` (commit 4652aa4).

---

## Full Corpus Audit — ✓ TIER 1 + TIER 2 DONE + LIVE (2026-06-05)

Verdict = **the corpus is sound**; one genuine fixable class found and fixed.

- **Tier 1 — `scripts/audit_corpus_tier1.py`** (read-only, mode=ro). Result: ZERO αὐτός-class
  corruption across 595k Greek rows. Scary raw counts collapsed under partitioning — A1 8509→0 genuine
  (pron case-headwords σύ/ὑμῖν, crasis, ≤2-edit orthographic variants + the G3924 παρεμβάλλω ABP-LXX
  convention); C1 empty-English content slots all render via a sibling. Genuine internal error ≈ 0.
- **Tier 2 — `scripts/audit_corpus_tier2.py`** (read-only; reuses lxx_align Rahlfs/TAGNT loaders + NW
  aligner). **92.10% content-word Strong's agreement vs Rahlfs/TAGNT.** The ~8% gap is NOT error — (a)
  PN H↔G cross-numbering (13,243), (b) same-word conventions (τις/τίς, εἴδω/ὁράω, ἅγιον/ἅγιος,
  ἐσθίω/φάγω) + textual divergence (κύριος/θεός; ABP=Vaticanus/Sixtine vs Rahlfs eclectic), (c)
  alignment/versification (Dan 64%/Psa 70% = different edition). CEILING IS TEXTUAL: 100% = rewriting
  ABP into Rahlfs — do NOT chase. KEY PARTITION: real-error bucket compares gloss vs ABP's OWN number
  (internal), NOT vs the reference; is_pn/H-number slots audited separately.
- **GENUINE ERROR FOUND + FIXED — `scripts/fix_g1473_gloss.py`** (rollback `bible_pre_g1473gloss_
  20260605.db`): residual G1473 (ἐγώ) slots glossed 3rd-person = un-fixed tail of αὐτός corruption.
  ABP gloss decides PERSON, morph gives CASE+NUMBER. **Applied 1,724 → G846/αὐτός.** health 0/0,
  invariant 0. Bucket(a) 2,532→1,069. Idempotent; in post-rebuild checklist AFTER import_tipnr.
- **RESIDUAL (1,069, NOT chased):** ~1,012 G1473 glossed 2P/1P with NULL morph (can't give number,
  guessing creates errors) + a smaller G846 mirror class. Blocked on case-split without morph. Tier 3
  (LLM English) NOT started — not warranted yet.
- Both audit scripts read-only and in the post-rebuild checklist (Tier 1 every rebuild; Tier 2 when
  refs handy).

### Original brief (kept for history — queued 2026-06-04)
GOAL: a single rigorous audit over all ~624k word rows by TRIANGULATION against independent witnesses
(can't audit a corpus against itself). HONEST CEILING: Strong's + lemmas highly auditable (Rahlfs/TAGNT
ground truth); English + word order only PARTIALLY (ABP's own human translation, no machine ground
truth — verify STRUCTURE + FLAG suspects, can't PROVE correct).
- Tier 1 — internal SQL consistency (Strong's↔lemma, Strong's↔morph, slot integrity); would've caught
  the αὐτός defect instantly.
- Tier 2 — external alignment (lxx_align `--audit` report mode); partition number/lemma-contradicts-gloss
  (real error) vs textual divergence (expected) vs alignment gap.
- Tier 3 — optional LLM semantic English pass on suspect CLASSES only; gated on cost.

---

## ✓ _split_compounds demonstrative over-reach — "this/that of X" — DONE + LIVE (2026-06-05)

FIXED and live (rollback `bible_pre_splitfix_20260604.db`). Solution = the **leading-run rule, gated to
NON-bracketed head slots** (build_words_from_abp.py `_split_compounds`, commits 6755053 + 52e1002): a
redistributed gloss word is fronted only when no kept "own" word precedes it AND the head slot is
non-bracketed (`bid is None`).
- WHY the non-bracket gate: non-bracketed slots render from `position`, so the fronting swap visibly
  garbled them ("this of possession", "the of LORD"); bracketed slots render in abp_pos order, swap
  invisible + keeps a useful separate chip — leave alone.
- HEAD-vs-TARGET: head = the content/noun slot bearing the bundled gloss; target = the following empty
  function-word slot. So "the LORD" still splits; "of **this** possession" stays whole.
- VALIDATION: `--test` trace → build to `bible_test.db` (copy-first) → position-INDEPENDENT diff
  `scripts/diff_split_fix.py` ((strongs,english) multiset per verse). Impact = **3,438 verses fixed**,
  0 health warnings, invariant 0, repair counts identical to rebuild #6. Canaries live: Jer 32:14 "of
  this possession", Gen 2:12 "of that land", Gen 3:8 "of the LORD", 2Ch 6:10 triple-fix, 1Ch 13:10
  "the LORD was enraged".
- ATTEMPT-1 lesson held: target-POS was the wrong axis; gloss word-order (leading-run) is right.
- KNOWN RESIDUAL (all PRE-EXISTING, NOT regressions): (1) content-noun chip bundled onto a neighbor
  verb loses its own chip in non-bracketed cases (reading correct, click less granular) → the
  DUAL-ORDERING work above; (2) complex-bracket reorder garble → ✅ DONE 2026-06-05 (memory
  [[project_bracket_order_fix]]): 374→0, root cause `ee84aa0` left `_split_compounds` front-swapping
  inside brackets, fix 0a4b146 SKIPS bracketed slots + greek_pos=source abp_pos. Job 21:22 "it he" /
  Eze 40:3 "set he them" are a DIFFERENT non-bracket class — revisit separately if wanted.
  (2b) ✓ Hab 3:14 duplicate-rows quirk RESOLVED: root cause was two byte-identical `(Hab 3:14)` lines
  in `abp_texts/abp_ot_texts/abp_habakkuk.txt` (only dup marker in corpus; build has no per-verse
  dedup). FIX: removed dup source line (commit 5543213) + `scripts/fix_hab314_dupes.py` cleaned live DB.
  (3) ✓ punctuation riding the wrong token — fix_bracket_punct.py (365 verses) + chip renders clause
  punct OUTSIDE "]" (d0a2456).
- TOOLING CAVEAT: audit_order_mismatch.py greedy-matches repeated words → ~63 false positives; benign.
  Replaced by audit_bracket_order.py (whose strongs-overlap matcher cross-matches twin sibling brackets
  → ~8 WORDSET FPs: Jon 4:9, Gen 44:26, Lev 14:36, 1Ki 12:12, Jon 1:8, Jdg 8:8, Lev 27:12 — DB correct,
  DON'T re-chase).

---

## LSJ coverage audit — generalize the pronoun-stub fix — ✅ PRONOUN CLASS DONE 2026-06-04

Morph-driven audit over demonstratives/relatives/αὐτός-obliques/reflexives/interrog-indef. STRUCTURAL
FINDING: big paradigms DON'T dead-end — αὐτός (G846), demonstratives (οὗτος G3778, ἐκεῖνος, ὅδε),
relatives (ὅς G3739, ὅστις) collapse ALL case forms onto ONE Strong's with a NOMINATIVE lemma that has
a full LSJ entry, so τοῦτον/ὅν/αὐτόν resolve. Only 3 genuine new gaps → fixed with stubs:
**ἐμοῦ(G1700)/ἐμοί(G1698)/ἐμέ(G1691) → `v. ἐγώ`**. τὶς(G5100) was a FALSE flag; τηλικοῦτος(G5082)
optional. Verified in-app. Rollback = `DELETE FROM lsj WHERE key IN ('ἐμοῦ','ἐμοί','ἐμέ','τηλικοῦτος')`.
Earlier (2026-06-04) the personal-pronoun families got 11 "v. <base>" stubs (σέ/ὑμεῖς/ὑμᾶς/ὑμῖν/ὑμῶν→σύ;
μέ/μοί/μοῦ→ἐγώ; ἡμᾶς/ἡμῖν/ἡμῶν→ἡμεῖς). RESIDUAL (optional, likely near-empty): a corpus-wide sweep of
NON-pronoun inflected forms — `lexicon.lemma` is already the dictionary headword for verbs/nouns, so they
resolve directly. Re-open only if a specific non-pronoun word is reported showing the terse gloss.
METHOD (kept): for every distinct lexicon.lemma the words table uses (G-numbers), check it resolves in
lsj (exact key / accent-strip via `plain` / "v. X" xref) vs falls to the Strong's gloss; fix only misses
that are an inflected form of an existing headword with a `<b>FORM</b>, v. <i>BASE</i>.` stub. NOTE:
`strip_accents` is an app-registered SQLite fn — run via a read-only Python script using `db()`.

---

## ✓ Text Structure Session — DONE

- **Pericopes / Section Headings** — `pericopes` table created + populated (2431 headings, full canon).
  `chapter_text()` LEFT JOINs pericopes; `renderVerse()` injects `.pericope-heading`. Works chip/prose/
  parallel (ABP column). Song of Solomon has 0 headings (BibleHub doesn't carry them; not a bug).
- **Prose Mode — Continuous Flow** — non-poetry books wrap as one flowing paragraph w/ inline verse-num
  superscripts; poetry (Psa/Pro/Job/Son/Lam/Ecc) keeps line-per-verse. `renderProseWords()` shared.
- **Font Size Preference** — A−/A+ in desktop lib-bar + mobile sheet. `--lib-font-size` on `.lib-reading`,
  localStorage. Defaults 15px mobile / 18px desktop, range 13–24px.

---

## ✓ Symptom #2 + Morphology Session — DONE (2026-06-04)

Live = rebuild #6 (rollback `bible_pre_morph_20260604.db`). Detail in memory [[project_pronoun_fix_path_c]].
- **morph + lemma columns** — populated from the Rahlfs(CATSS)/TAGNT alignment (78%). Commit 998b92c.
- **Facet (a) copula reorder** — Gen 20:7 "he is a prophet"; `_split_compounds` no longer extracts the
  copula (εἰμί/G1510). Commit 90c911e.
- **Facet (c) chip Strong's anchoring** — multi-word-gloss chip puts the superscript on the morph-resolved
  head (content→english_head, function→firstNonItalic). Jer 32:14 G5087 on "put". Commit 675ba46.
- **LSJ pronoun definitions** — 11 oblique "v. ‹base›" stubs. Data-only.
- **✗ demonstrative ("this/that of X")** — attempted, REVERTED; → done later (see _split_compounds entry).
- **Still open: facet (b)** — possessive split ("your rod": "your" rides the noun slot, σου empty).
  Cosmetic, lowest priority. [moved to TODO.md open list]

---

## ✓ Planned Features — DONE subset

- **✓ Prose Reading Mode** — Chip/Prose toggle live; inline clickable word spans, continuous flow +
  poetry detection.
- **✓ Morphology Display — DONE + LIVE (2026-06-04, commits ab6657b + e90f2ff)** — word-click sidebar
  renders `morph` in plain English ("Verb · Aorist · Active · Indicative · 3rd person · Singular").
  Frontend `decodeMorph()` with per-scheme tables (CATSS dotted OT / Robinson hyphen NT — letters
  conflict), ABP Greek only (Hebrew/PN/NULL hide). RD-class disambiguation (e90f2ff): `_CATSS_RD_LEMMA`
  maps αὐτός→"Pronoun", reflexives→"Reflexive pronoun", ἀλλήλων→"Reciprocal pronoun", default
  "Demonstrative pronoun". Verified in-app. (Original KICKOFF brief lived here — now obsolete; decoder
  shipped.)
- **✓ Parallel Mode Versification Alignment** — audited: ABP + KJV both MT-style numbering, align in
  Parallel; no systematic off-by-one (Psalms audited). Residual one-off gaps are inherent LXX/MT text
  differences, not a bug.

---

## ✓ MetaV — DONE subset

- **✓ People & Places** — people sidebar (bio, relationships, genealogy), places sidebar (Leaflet map,
  coords), proper-noun routing in ABP + KJV. All live.
- **✓ Hebrew PN + gentilic handling (2026-06-03)** — Hebrew PNs route to metaV with BDB stacked below;
  badge shows real H-number. Person/place default Person, flips to Place only on prefix-exact strongs_g
  match (pn_type untrusted — tipnr PK collision). Gentilics (-ite/-ites) labeled "People / Clan", place
  card "Homeland", AI summary on the clan tab. AI curation (`/api/metav/ai-description`, Haiku, cached
  `pn:` key, text-first) fills groups with no metaV/BDB.
