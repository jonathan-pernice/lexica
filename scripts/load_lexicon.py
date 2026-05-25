#!/usr/bin/env python3
"""
Download the OpenScriptures Strong's Greek lexicon and load it into bible.db.

Usage:
    python load_lexicon.py [bible.db]

Source: https://github.com/openscriptures/strongs (CC-BY-SA)
"""

import json
import sqlite3
import sys
import urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js"

SCHEMA = """
CREATE TABLE IF NOT EXISTS lexicon (
    strongs     TEXT PRIMARY KEY,  -- numeric portion only, e.g. '4151'
    lemma       TEXT,              -- Greek word: πνεῦμα
    translit    TEXT,              -- transliteration: pneûma
    strongs_def TEXT,              -- Strong's definition
    kjv_def     TEXT,              -- KJV gloss(es)
    derivation  TEXT
);
"""


def fetch_lexicon() -> dict:
    print("Downloading lexicon…", file=sys.stderr)
    req = urllib.request.Request(URL, headers={"User-Agent": "bible-db/1.0"})
    with urllib.request.urlopen(req) as r:
        raw = r.read().decode("utf-8")
    # strip JS wrapper: var strongsGreekDictionary = {...};
    start = raw.index("{")
    end   = raw.rindex("}") + 1
    return json.loads(raw[start:end])


def load(db_path: str, data: dict) -> None:
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)

    rows = []
    for key, entry in data.items():
        strongs = key.lstrip("G")   # "G4151" -> "4151"
        rows.append((
            strongs,
            entry.get("lemma"),
            entry.get("translit"),
            entry.get("strongs_def", "").strip() or None,
            entry.get("kjv_def", "").strip() or None,
            entry.get("derivation", "").strip() or None,
        ))

    conn.executemany(
        "INSERT OR REPLACE INTO lexicon (strongs, lemma, translit, strongs_def, kjv_def, derivation) VALUES (?,?,?,?,?,?)",
        rows,
    )
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM lexicon").fetchone()[0]
    conn.close()
    print(f"  {n:,} lexicon entries -> {db_path}", file=sys.stderr)


def main() -> None:
    db_path = sys.argv[1] if len(sys.argv) > 1 else "bible.db"
    if not Path(db_path).exists():
        print(f"Error: {db_path} not found. Run parse_abp.py first.", file=sys.stderr)
        sys.exit(1)
    data = fetch_lexicon()
    print(f"  {len(data):,} entries fetched", file=sys.stderr)
    load(db_path, data)


if __name__ == "__main__":
    main()
