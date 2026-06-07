#!/usr/bin/env python3
"""
load_enoch.py — convenience wrapper around the generic scripts/load_extra.py.

Loads 1 Enoch (R.H. Charles' 1917 public-domain English) into its OWN two tables
(enoch_words / enoch_verses); never touches the Bible's tables; safe to re-run.

This is an ENGLISH-ONLY load: enoch_tagged_full.json is empty ([]) because no Greek
interlinear is wired up yet (only ~ch 1–32 survives in Greek). enoch_words is created
empty; enoch_verses carries the readable English + the 5 section headings. Equivalent to:

    python3 scripts/load_extra.py <db> enoch \
        scripts/enoch/enoch_tagged_full.json \
        scripts/enoch/enoch_english.json \
        scripts/enoch/enoch_headings.json

Run on PythonAnywhere after git pull:
    python3 scripts/enoch/load_enoch.py bible.db
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))   # so "import load_extra" finds scripts/load_extra.py
import load_extra  # noqa: E402


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else "bible.db"
    load_extra.load(
        db_path,
        "enoch",
        str(HERE / "enoch_tagged_full.json"),
        str(HERE / "enoch_english.json"),
        str(HERE / "enoch_headings.json"),
    )


if __name__ == "__main__":
    main()
