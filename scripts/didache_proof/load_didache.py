#!/usr/bin/env python3
"""
load_didache.py — convenience wrapper around the generic scripts/load_extra.py.

Loads the Didache into its OWN two tables (didache_words / didache_verses); never
touches the Bible's tables; safe to re-run. Equivalent to:

    python3 scripts/load_extra.py <db> didache \
        scripts/didache_proof/didache_tagged_full.json \
        scripts/didache_proof/didache_english.json

Run on PythonAnywhere after git pull:
    python3 scripts/didache_proof/load_didache.py bible.db
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
        "didache",
        str(HERE / "didache_tagged_full.json"),
        str(HERE / "didache_english.json"),
        str(HERE / "didache_headings.json"),
    )


if __name__ == "__main__":
    main()
