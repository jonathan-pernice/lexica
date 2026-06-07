#!/usr/bin/env python3
"""
fix_article_noun_swaps.py — repair the Act 19:4 "Jesus the" tag (Problem 2 case).

SUPERSEDED for the 7 number-reversal verses: the build now self-corrects those at
rebuild time via _fix_backwards_pairing() in build_words_from_abp.py (an
evidence-driven pass over the same fingerprint scan_strongs_cross.py detects — no
hardcoded list). The 7 entries below were removed once that pass was validated to
touch exactly those verses corpus-wide and nothing else.

The ONE entry that remains is Act 19:4 "Jesus the": Greek runs "the Jesus" but the
English reads "Jesus the" (opposite order), and the real word is a proper-noun
slot (G*), so the build-time pass deliberately skips it. This is a Problem-2 case
(lumped function-word + content chip in reversed order); it stays band-aided here
until the general Problem-2 splitter lands, then this script can be retired.

Each fix swaps ONLY the Greek identity (strongs_base, strongs, is_pn) between two
positions in one verse. The English text stays exactly where it is, so the verse
reads identically — only the tag under each word is corrected.

  Act 19:4  "Jesus the"   (carry the PN; the empty slot takes the article G3588)

Dry-run by default (prints before/after). Add --apply to write.
Usage:
  python3 scripts/fix_article_noun_swaps.py bible.db            # preview
  python3 scripts/fix_article_noun_swaps.py bible.db --apply    # write
"""
import sqlite3
import sys

DB = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")
APPLY = "--apply" in sys.argv

# (book, chapter, verse, posA, posB, expect_A, expect_B) — swap the Greek tag
# between the two positions, but ONLY when each position still carries its
# broken-state Strong's (expect_A on posA, expect_B on posB). After the swap the
# guard no longer matches, so re-running is a no-op; a fresh words rebuild puts
# the broken state back, so this re-applies. That makes it safe in the repair
# chain (idempotent — never undoes a correct verse).
SWAPS = [
    # Act 19:4 "Jesus the": carry the proper-noun (G*); the empty slot takes the
    # article G3588. Problem-2 case (reversed Greek/English order) — the build-time
    # _fix_backwards_pairing pass skips proper-noun slots, so it stays here.
    # The 7 number-reversal verses (1Sa 5:2, Rom 8:34, 1Pe 5:12, 2Co 8:10, Eph 3:3,
    # Mat 26:44, Zec 8:13) were removed — the build now self-corrects them.
    ("Act", 19, 4, 20, 21, "G3588", "*"),
]

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row


def lemma_for(sb):
    if not sb or not sb.startswith("G"):
        return ""
    r = conn.execute("SELECT lemma FROM lexicon WHERE strongs = ?", (sb[1:],)).fetchone()
    return r["lemma"] if r else ""


def row_at(verse_id, pos):
    return conn.execute(
        """SELECT id, position, english, english_head, strongs_base, strongs, is_pn
           FROM words WHERE verse_id=? AND position=?""",
        (verse_id, pos),
    ).fetchone()


def show(tag, r):
    print(f"    {tag} pos {r['position']:>3}  eng={r['english']!r:<14} "
          f"{r['strongs_base'] or '-':<7} {lemma_for(r['strongs_base']):<10} "
          f"is_pn={r['is_pn']}")


changed = 0
skipped = 0
for bk, ch, vs, pa, pb, exp_a, exp_b in SWAPS:
    v = conn.execute("SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
                     (bk, ch, vs)).fetchone()
    if not v:
        print(f"!! {bk} {ch}:{vs} not found — skipped")
        continue
    a, b = row_at(v["id"], pa), row_at(v["id"], pb)
    if not a or not b:
        print(f"!! {bk} {ch}:{vs} missing pos {pa}/{pb} — skipped")
        continue
    # Idempotency guard: only act on the known broken arrangement.
    if (a["strongs_base"] or "") != exp_a or (b["strongs_base"] or "") != exp_b:
        print(f"\n{bk} {ch}:{vs}  already correct (or unexpected) — skipped")
        show("A", a)
        show("B", b)
        skipped += 1
        continue
    print(f"\n{bk} {ch}:{vs}  (swap Greek tag pos {pa} <-> pos {pb})")
    print("  BEFORE:")
    show("A", a)
    show("B", b)
    if APPLY:
        conn.execute("UPDATE words SET strongs_base=?, strongs=?, is_pn=? WHERE id=?",
                     (b["strongs_base"], b["strongs"], b["is_pn"], a["id"]))
        conn.execute("UPDATE words SET strongs_base=?, strongs=?, is_pn=? WHERE id=?",
                     (a["strongs_base"], a["strongs"], a["is_pn"], b["id"]))
        print("  AFTER:")
        show("A", row_at(v["id"], pa))
        show("B", row_at(v["id"], pb))
    changed += 1

if APPLY:
    conn.commit()
    print(f"\nAPPLIED to {changed} verse(s); {skipped} already-correct skipped.")
else:
    print(f"\nDRY RUN — {changed} verse(s) would change; {skipped} already correct. "
          f"Re-run with --apply to write.")
conn.close()
