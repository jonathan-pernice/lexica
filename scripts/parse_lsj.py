#!/usr/bin/env python3
"""
Download the Perseids/Perseus LSJ JSON and load it into bible.db.

Source: https://github.com/perseids-project/lsj-js/raw/master/vendor/lsj.json
Run once: python parse_lsj.py [path/to/bible.db]
"""
import json
import os
import re
import sqlite3
import sys
import unicodedata
import urllib.request

LSJ_URL = (
    "https://raw.githubusercontent.com/perseids-project/lsj-js"
    "/master/vendor/lsj.json"
)

DB = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.path.join(os.path.dirname(os.path.abspath(__file__)), "bible.db")
)

# Tags safe to keep in the definition HTML
_ALLOWED = re.compile(r"<(?!/?(?:b|i|em|strong|br)\b)[^>]+>", re.IGNORECASE)


def _sanitize(html: str) -> str:
    """Strip unsafe HTML tags (font, span, etc.) keeping b/i/em/strong/br."""
    return _ALLOWED.sub("", html)


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    ).lower()


def main() -> None:
    print(f"Target database: {DB}")
    print(f"Downloading LSJ JSON from perseids-project (~66 MB)…")

    with urllib.request.urlopen(LSJ_URL) as resp:
        raw = resp.read()
    print(f"Downloaded {len(raw) / 1_048_576:.1f} MB — parsing…")

    data: dict = json.loads(raw.decode("utf-8"))
    print(f"Parsed {len(data):,} entries")

    conn = sqlite3.connect(DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS lsj (
            key      TEXT PRIMARY KEY,
            plain    TEXT,
            translit TEXT,
            def_html TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS lsj_plain    ON lsj(plain)")
    conn.execute("CREATE INDEX IF NOT EXISTS lsj_translit ON lsj(translit)")

    rows = []
    for key, entry in data.items():
        plain    = _strip_accents(key)
        translit = (entry.get("l") or [None])[0]
        def_html = _sanitize(entry.get("d") or "")
        rows.append((key, plain, translit, def_html))

    conn.executemany(
        "INSERT OR REPLACE INTO lsj (key, plain, translit, def_html) VALUES (?,?,?,?)",
        rows,
    )
    conn.commit()
    conn.close()
    print(f"Done — {len(rows):,} LSJ entries loaded into {DB}")


if __name__ == "__main__":
    main()
