#!/usr/bin/env python3
"""
fix_article_noun_swaps.py — repair 8 verses where the build's word-splitter paired
a multi-word gloss with its trailing Greek numbers BACKWARDS, so a real word's tag
landed on a function word (the article ὁ/G3588 or a preposition) and vice-versa.
ABP source is correct in every case; only our parse flipped it. Found by
scan_strongs_cross.py; each confirmed against the ABP source text.

Each fix swaps ONLY the Greek identity (strongs_base, strongs, is_pn) between two
positions in one verse. The English text stays exactly where it is, so the verse
reads identically — only the tag under each word is corrected.

  1Sa 5:2   "of"/"God"    ("God" -> θεός instead of the article)
  Rom 8:34  "of"/"God"    (same)
  Act 19:4  "Jesus the"   (eSword keeps "Jesus the"; swap so it carries the PN and
                           the empty slot takes the article G3588 — reads the same)
  1Pe 5:12  "a little"    ("little" -> ὀλίγος instead of διά)
  2Co 8:10  "a year ago"  ("year ago" -> πέρυσι instead of ἀπό)
  Eph 3:3   "a little"    ("little" -> ὀλίγος instead of ἐν)
  Mat 26:44 "a third time"("third time" -> τρίτος instead of ἐκ)
  Zec 8:13  "a blessing"  ("blessing" -> εὐλογία instead of ἐν)

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
    # article ὁ/G3588 <-> noun ("of God", "Jesus the")
    ("1Sa", 5, 2, 6, 7, "G2316", "G3588"),
    ("Rom", 8, 34, 15, 16, "G2316", "G3588"),
    ("Act", 19, 4, 20, 21, "G3588", "*"),
    # preposition <-> noun: source "a <noun> Gprep Gnoun" parsed backwards, so the
    # noun's English ("little"/"blessing"…) landed on the preposition and "a" on
    # the noun. Found by scan_strongs_cross.py; each confirmed against ABP source.
    ("1Pe", 5, 12, 9, 8, "G1223", "G3641"),   # "little"  <-> ὀλίγος
    ("2Co", 8, 10, 20, 19, "G575", "G4070"),  # "year ago" <-> πέρυσι
    ("Eph", 3, 3, 10, 9, "G1722", "G3641"),   # "little"  <-> ὀλίγος
    ("Mat", 26, 44, 7, 6, "G1537", "G5154"),  # "third time" <-> τρίτος
    ("Zec", 8, 13, 22, 21, "G1722", "G2129"), # "blessing" <-> εὐλογία
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
