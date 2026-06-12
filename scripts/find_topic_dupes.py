#!/usr/bin/env python3
"""Read-only: list candidate DUPLICATE study topics so we can decide which to merge.

Groups topics by their leading keyword (the part before the first comma) and prints
any group with more than one topic — e.g. "Trinity, The" + "Trinity, the Holy". It
changes NOTHING, just prints, so it's safe to run anytime. Review the output and tell
me which pairs are truly the same; I'll merge only those.

  python3 scripts/find_topic_dupes.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import study_db   # noqa: E402


def head_key(title):
    t = (title or "").strip()
    ci = t.find(",")
    return (t[:ci] if ci >= 0 else t).strip().lower()


def vcount(js):
    try:
        d = json.loads(js) or {}
    except (ValueError, TypeError):
        return 0
    return sum(len((s or {}).get("verses") or []) for s in (d.get("sections") or []))


def main():
    conn = study_db()
    rows = conn.execute(
        "SELECT id, title, json FROM entries WHERE type='topic' AND deleted=0"
    ).fetchall()
    conn.close()

    groups = {}
    for r in rows:
        groups.setdefault(head_key(r["title"]), []).append(r)
    dupes = {k: v for k, v in groups.items() if len(v) > 1}

    if not dupes:
        print("No candidate duplicates found.")
        return

    print("Candidate duplicate groups (topics sharing a leading keyword).")
    print("Review and tell me which are truly the same — I'll merge only those.\n")
    for k in sorted(dupes):
        for r in sorted(dupes[k], key=lambda r: (r["title"] or "").lower()):
            print("    {:<42} {:>3} verses   [{}]".format(r["title"], vcount(r["json"]), r["id"]))
        print()
    print("{} groups, {} topics involved.".format(len(dupes), sum(len(v) for v in dupes.values())))


if __name__ == "__main__":
    main()
