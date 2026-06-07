#!/usr/bin/env python3
"""Phase 1 regression test: the lexicon join key (strongs_g).

Locks in the invariant behind the Strong's-handling refactor — that the lexicon
join is equality on a real prefixed key (lexicon.strongs_g = 'G'||strongs),
NOT SUBSTR(strongs_base, 2). Two historical bugs this guarantees against:

  * the 592k break: a BARE strongs_base ('4151') fed to SUBSTR(...,2) shaved a
    DIGIT -> '151' -> wrong lemma. The key join just doesn't match -> NULL.
  * the Hebrew-PN bug: an H-number ('H121') under SUBSTR matched a Greek lexicon
    row ('121' = G121) -> bogus Greek lemma. strongs_g only ever holds 'G...',
    so it can never match an H-number.

Pure stdlib + in-memory SQLite — no dependency on bible.db. Run:
    python tests/test_strongs_join.py
"""
import sqlite3
import sys


def _fixture() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.executescript("""
        CREATE TABLE lexicon (strongs TEXT PRIMARY KEY, lemma TEXT, strongs_g TEXT);
        CREATE TABLE words (id INTEGER PRIMARY KEY, strongs_base TEXT);
        -- Greek pneuma (the canary) and Greek G121 (collides with Hebrew H121 under SUBSTR).
        INSERT INTO lexicon (strongs, lemma) VALUES ('4151', 'πνεῦμα'), ('121', 'ἄκρον');
        UPDATE lexicon SET strongs_g = 'G' || strongs;   -- mirrors the migration
        INSERT INTO words (id, strongs_base) VALUES
            (1, 'G4151'),   -- normal Greek word
            (2, 'H121'),    -- Hebrew proper noun (must NOT borrow G121's lemma)
            (3, '4151');    -- BARE base (the 592k scenario) — must NOT shave a digit
    """)
    return c


def _lemma(c, join_on, word_id):
    row = c.execute(
        f"SELECT l.lemma FROM words w LEFT JOIN lexicon l ON {join_on} WHERE w.id = ?",
        (word_id,),
    ).fetchone()
    return row[0] if row else None


NEW = "l.strongs_g = w.strongs_base"
OLD = "l.strongs = SUBSTR(w.strongs_base, 2)"


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Greek lemmas in output
    except Exception:
        pass
    c = _fixture()
    fails = []

    def check(desc, got, want):
        if got != want:
            fails.append(f"  FAIL: {desc}\n        got {got!r}, want {want!r}")
        else:
            print(f"  ok: {desc} -> {got!r}")

    # The new key join: correct lemma for Greek, NULL (not bogus) for Hebrew/bare.
    check("G4151 -> πνεῦμα (new join)",      _lemma(c, NEW, 1), "πνεῦμα")
    check("H121  -> None  (new join, no G121 leak)", _lemma(c, NEW, 2), None)
    check("bare '4151' -> None (new join, no digit-shave)", _lemma(c, NEW, 3), None)

    # Demonstrate the OLD join's two bugs, so this test documents *why* the key exists.
    check("OLD join leaks G121 onto H121", _lemma(c, OLD, 2), "ἄκρον")
    check("OLD join shaves bare '4151'->'151' (no match here, but proves the slice)",
          _lemma(c, OLD, 3), None)  # '151' isn't in fixture -> None; the point is it's NOT πνεῦμα
    check("OLD join: bare '4151' is NOT πνεῦμα (digit shaved)", _lemma(c, OLD, 3) == "πνεῦμα", False)

    if fails:
        print("\n".join(fails))
        print(f"\n{len(fails)} FAILED")
        return 1
    print("\nAll strongs-join invariants hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
