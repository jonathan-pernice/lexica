#!/usr/bin/env python3
"""
load_pseudepigrapha.py — load the pseudepigrapha (English-only, R.H. Charles) into bible.db.

Thin wrapper over scripts/load_extra.py. Each book gets its OWN two tables
(<id>_words empty, <id>_verses with the readable English); the Bible's tables, search,
and word counts are never touched. Safe to re-run.

Source: R.H. Charles' public-domain English, via the Wesley Center Online (NNU). These
are messy scans, so a few verse NUMBERS may merge into the previous verse (no text lost).
English-only -- no Greek interlinear.

(1 Enoch is loaded separately by scripts/enoch/load_enoch.py.)

Run on PythonAnywhere after git pull:
    python3 scripts/apocrypha/load_pseudepigrapha.py bible.db
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))   # so "import load_extra" finds scripts/load_extra.py
import load_extra  # noqa: E402

BOOKS = [
    "jubilees",
    "enoch2",     # 2 Enoch (Slavonic, Morfill) -- 68 chapters
    "baruch2",    # 2 Baruch (Syriac Apocalypse, Charles) -- 85 chapters
    "apocabr",    # Apocalypse of Abraham (translation 1) -- 32 chapters
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
