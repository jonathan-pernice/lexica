# TODO — Archive (finished & scrapped work)

History and "don't redo this" notes. Nothing here is open. Deep detail lives in the
memory files; this is the plain-English record plus the rollback database names and the
few "leave it alone" verdicts worth keeping.

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
