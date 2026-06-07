#!/usr/bin/env python3
"""Phase 6 regression tests: words-rebuild invariants + the tipnr type-set fix.

Locks the data-shape gates that a future `words` rebuild (or a tipnr re-import)
must not silently break. Pure stdlib + in-memory SQLite — no dependency on the
real bible.db (which is PA-only). Companion to tests/test_strongs_join.py, which
covers the lexicon JOIN KEY itself; this file covers:

  1. strongs_base G/H-prefix invariant — the canonical post-rebuild gate
     (`WHERE strongs_base GLOB '[0-9]*'` must be 0). A BARE base ('4151') is the
     592k regression: SUBSTR(...,2) would shave a digit. See CLAUDE.md.
  2. kjv_strongs.strongs_id is fully prefixed too (always has been).
  3. tipnr type-SET (backlog #5 fix): a strongs shared by a person AND a place
     (e.g. Adam H121) keeps BOTH in entity_types, yet stays ONE row per strongs
     so `LEFT JOIN tipnr ON t.strongs = w.strongs_base` can't multiply word rows
     (the reason we chose a type-set column over a composite PK).
  4. The real import_tipnr aggregation (parse_tipnr) collapses person+place rows
     for one strongs into entity_types='person,place' with a single primary token.

Run:  python tests/test_build_invariants.py
"""
import os
import sqlite3
import sys

# import the real parser from scripts/import_tipnr.py (no DB / network at import)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import import_tipnr  # noqa: E402


_FAILS = []


def check(desc, got, want):
    if got != want:
        _FAILS.append(f"  FAIL: {desc}\n        got {got!r}, want {want!r}")
    else:
        print(f"  ok: {desc} -> {got!r}")


# ── 1 + 2. strongs prefix invariants ─────────────────────────────────────────
def test_prefix_invariants():
    c = sqlite3.connect(":memory:")
    c.executescript("""
        CREATE TABLE words (id INTEGER PRIMARY KEY, strongs_base TEXT);
        CREATE TABLE kjv_strongs (id INTEGER PRIMARY KEY, strongs_id TEXT);
        INSERT INTO words (id, strongs_base) VALUES
            (1, 'G4151'), (2, 'H7307'), (3, '*'), (4, 'G2321.1');
        INSERT INTO kjv_strongs (id, strongs_id) VALUES (1, 'G4151'), (2, 'H7307');
    """)
    # The post-rebuild gate: no bare-number base (the 592k break).
    bare = c.execute("SELECT count(*) FROM words WHERE strongs_base GLOB '[0-9]*'").fetchone()[0]
    check("clean words: 0 bare strongs_base", bare, 0)

    # And it actually CATCHES a regression if one slips in.
    c.execute("INSERT INTO words (id, strongs_base) VALUES (5, '4151')")  # bare!
    bare2 = c.execute("SELECT count(*) FROM words WHERE strongs_base GLOB '[0-9]*'").fetchone()[0]
    check("gate flags a bare strongs_base", bare2, 1)

    kbare = c.execute("SELECT count(*) FROM kjv_strongs WHERE strongs_id GLOB '[0-9]*'").fetchone()[0]
    check("kjv_strongs.strongs_id fully prefixed", kbare, 0)
    c.close()


# ── 3. tipnr type-set: both survive, join stays 1:1 ──────────────────────────
def test_tipnr_typeset_join_is_one_to_one():
    c = sqlite3.connect(":memory:")
    c.executescript("""
        CREATE TABLE tipnr (strongs TEXT PRIMARY KEY, name TEXT, entity_type TEXT, entity_types TEXT);
        CREATE TABLE words (id INTEGER PRIMARY KEY, strongs_base TEXT);
        -- Adam: one row, but the SET records person AND place (the collision fix).
        INSERT INTO tipnr VALUES ('H121', 'Adam', 'person', 'person,place');
        INSERT INTO tipnr VALUES ('H1035', 'Bethlehem', 'place', 'place');
        INSERT INTO words (id, strongs_base) VALUES (1,'H121'), (2,'H121'), (3,'H1035');
    """)
    # One tipnr row per strongs (PK held) — a composite key would allow 2 H121 rows.
    rows_h121 = c.execute("SELECT count(*) FROM tipnr WHERE strongs='H121'").fetchone()[0]
    check("tipnr keeps ONE row per strongs", rows_h121, 1)

    # The collision's full type-set is preserved.
    et = c.execute("SELECT entity_types FROM tipnr WHERE strongs='H121'").fetchone()[0]
    check("Adam H121 keeps both types", et, "person,place")

    # The library join must not multiply word rows: 3 words in -> 3 rows out.
    n = c.execute("""SELECT count(*) FROM words w
                     LEFT JOIN tipnr t ON t.strongs = w.strongs_base""").fetchone()[0]
    check("tipnr join is 1:1 (no row multiplication)", n, 3)
    c.close()


# ── 4. the real parse_tipnr aggregation ──────────────────────────────────────
def test_parse_tipnr_aggregates_shared_strongs():
    # Minimal TIPNR-format lines: a person section and a place section that BOTH
    # carry Adam under H0121 (-> H121). The old INSERT OR REPLACE kept only the
    # last; the fix must union them into a single 'person,place' row.
    lines = [
        "$========== person",
        "Adam@x=H0121",
        "Enosh@x=H0583",
        "$========== place",
        "Adam@x=H0121",
        "Bethlehem@x=H1035",
    ]
    _lookup, rows = import_tipnr.parse_tipnr(lines)
    by_strongs = {r[0]: r for r in rows}

    # one row per strongs
    check("parse: one row per strongs", len(rows), len(by_strongs))
    # shared strongs -> both types in the set, single primary token (person>place)
    check("parse: H121 entity_types is the union", by_strongs["H121"][3], "person,place")
    check("parse: H121 primary entity_type is person", by_strongs["H121"][2], "person")
    # non-shared rows keep their single type
    check("parse: H583 stays person", by_strongs["H583"][3], "person")
    check("parse: H1035 stays place", by_strongs["H1035"][3], "place")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print("== strongs prefix invariants ==")
    test_prefix_invariants()
    print("== tipnr type-set / 1:1 join ==")
    test_tipnr_typeset_join_is_one_to_one()
    print("== parse_tipnr aggregation ==")
    test_parse_tipnr_aggregates_shared_strongs()

    if _FAILS:
        print("\n" + "\n".join(_FAILS))
        print(f"\n{len(_FAILS)} FAILED")
        return 1
    print("\nAll build invariants hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
