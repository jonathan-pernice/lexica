#!/usr/bin/env python3
"""
Load all ABP text files from abp_texts/ into bible.db, skipping books already present.
Runs parse_abp.py on each new file, then seed_books.py to refresh book metadata.

    python load_all_books.py [path/to/bible.db]
"""
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

HERE      = Path(__file__).parent
TEXTS_DIR = HERE / "abp_texts"
DB        = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "bible.db")

CANONICAL_ORDER = [
    "genesis", "exodus", "leviticus", "numbers", "deuteronomy",
    "joshua", "judges", "ruth", "1samuel", "2samuel",
    "1kings", "2kings", "1chronicles", "2chronicles",
    "ezra", "nehemiah", "esther", "job", "psalms", "proverbs",
    "ecclesiastes", "songofsolomon", "isaiah", "jeremiah",
    "lamentations", "ezekiel", "daniel", "hosea", "joel",
    "amos", "obadiah", "jonah", "micah", "nahum",
    "habakkuk", "zephaniah", "haggai", "zechariah", "malachi",
]

_VERSE_HEADER_RE = re.compile(r'\((\S+)\s+\d+:\d+\)')


def _first_book_abbrev(path: Path) -> str | None:
    """Read the first verse header to get the book abbreviation used in the DB."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        m = _VERSE_HEADER_RE.search(text)
        return m.group(1) if m else None
    except Exception:
        return None


def _loaded_books() -> set[str]:
    try:
        conn = sqlite3.connect(DB)
        rows = conn.execute("SELECT DISTINCT book FROM verses").fetchall()
        conn.close()
        return {r[0] for r in rows}
    except Exception:
        return set()


def _sort_key(path: Path) -> int:
    book = path.stem.removeprefix("abp_").lower()
    try:
        return CANONICAL_ORDER.index(book)
    except ValueError:
        return len(CANONICAL_ORDER)


def main() -> None:
    txt_files = sorted(TEXTS_DIR.glob("abp_*.txt"), key=_sort_key)
    if not txt_files:
        print(f"No abp_*.txt files found in {TEXTS_DIR}")
        sys.exit(1)

    already_loaded = _loaded_books()
    if already_loaded:
        print(f"Already in DB: {', '.join(sorted(already_loaded))}\n")

    to_load: list[tuple[Path, str]] = []
    n_skipped_loaded = 0
    n_skipped_empty  = 0

    for f in txt_files:
        abbrev = _first_book_abbrev(f)
        if abbrev is None:
            n_skipped_empty += 1
            continue
        if abbrev in already_loaded:
            n_skipped_loaded += 1
            continue
        to_load.append((f, abbrev))

    if n_skipped_loaded:
        print(f"Skipping {n_skipped_loaded} already-loaded book(s).")
    if n_skipped_empty:
        print(f"Skipping {n_skipped_empty} empty stub(s).")
    if n_skipped_loaded or n_skipped_empty:
        print()

    if not to_load:
        print("Nothing new to load — running seed_books.py to refresh metadata.\n")
    else:
        print(f"Loading {len(to_load)} book(s):\n")
        parse_script = str(HERE / "parse_abp.py")
        for i, (f, abbrev) in enumerate(to_load, 1):
            print(f"  [{i}/{len(to_load)}] {f.name}  ({abbrev})", end="  ", flush=True)
            result = subprocess.run(
                [sys.executable, parse_script, str(f), DB],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                print("FAILED")
                print(result.stderr.strip())
                sys.exit(1)
            # parse_abp.py prints a summary line to stderr; grab the last non-empty line
            lines = [l.strip() for l in result.stderr.splitlines() if l.strip()]
            print(lines[-1] if lines else "done")
        print()

    print("Running seed_books.py…")
    result = subprocess.run(
        [sys.executable, str(HERE / "seed_books.py"), DB],
        capture_output=True,
        text=True,
    )
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode != 0:
        print("seed_books.py failed:")
        print(result.stderr.strip())
        sys.exit(1)


if __name__ == "__main__":
    main()
