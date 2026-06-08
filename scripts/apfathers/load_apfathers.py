#!/usr/bin/env python3
"""
load_apfathers.py — load the Greek-tagged Apostolic Fathers into bible.db.

Thin wrapper over scripts/load_extra.py (the same Greek-interlinear path the Didache
uses). Each book gets its OWN two tables <id>_words / <id>_verses; the Bible's tables
are never touched. Safe to re-run.

Source: Greek + lemma from RickBrannan/apostolic-fathers (CC-BY-SA, Tauber/Lake text),
Strong's + Dodson glosses added by build_af.py, English from Lightfoot (public domain).
(The Didache is loaded separately by scripts/didache_proof/load_didache.py.)

Run on PythonAnywhere after git pull:
    python3 scripts/apfathers/load_apfathers.py bible.db
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))   # so "import load_extra" finds scripts/load_extra.py
import load_extra  # noqa: E402

BOOKS = [
    "clement2",   # 2 Clement -- 20 chapters (proof book)
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
