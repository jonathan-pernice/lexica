#!/usr/bin/env python3
"""Read-only: list study TOPIC titles that contain any of the given keywords, so we
can find Nave's exact titles (it names things its own way — "Life, Eternal", "Devil").

  python3 scripts/find_topics.py sin satan covenant forgiveness judgment suffering
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import study_db   # noqa: E402


def main():
    kws = [a.lower() for a in sys.argv[1:] if not a.startswith("-")]
    if not kws:
        print("Usage: python3 scripts/find_topics.py <keyword> [keyword ...]")
        return
    conn = study_db()
    rows = conn.execute(
        "SELECT title FROM entries WHERE type='topic' AND deleted=0 ORDER BY title"
    ).fetchall()
    conn.close()
    titles = [r["title"] or "" for r in rows]
    for kw in kws:
        hits = [t for t in titles if kw in t.lower()]
        print("\n{} ({} match):".format(kw, len(hits)))
        for t in hits:
            print("    " + t)


if __name__ == "__main__":
    main()
