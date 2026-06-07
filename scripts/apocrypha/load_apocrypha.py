#!/usr/bin/env python3
"""
load_apocrypha.py — load the Brenton Septuagint Apocrypha (English-only) into bible.db.

Thin wrapper over the generic scripts/load_extra.py. Each book gets its OWN two tables
(<id>_words empty, <id>_verses with the readable English); the Bible's tables, search,
and word counts are never touched. Safe to re-run (each book's two tables are refilled).

Source: Brenton's 1851 public-domain English Septuagint (ebible.org USFM), verse-perfect.
These are English-only loads: <id>_tagged_full.json is empty ([]) — the Greek isn't
Strong's-tagged, so no interlinear.

Run on PythonAnywhere after git pull / merge:
    python3 scripts/apocrypha/load_apocrypha.py bible.db
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))   # so "import load_extra" finds scripts/load_extra.py
import load_extra  # noqa: E402

BOOKS = [
    "esdras1", "tobit", "judith", "esther_gk",
    "maccabees1", "maccabees2", "maccabees3", "maccabees4",
    "wisdom", "sirach", "baruch", "epjeremiah",
    "susanna", "bel", "manasseh",
]


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else "bible.db"
    for book in BOOKS:
        load_extra.load(
            db_path,
            book,
            str(HERE / f"{book}_tagged_full.json"),
            str(HERE / f"{book}_english.json"),
            str(HERE / f"{book}_headings.json"),
        )


if __name__ == "__main__":
    main()
