#!/usr/bin/env python3
"""Batch publish / unpublish Study TOPICS in study.db (just flips the Draft/Published
flag — no AI, no key needed). Runs on PythonAnywhere. Reversible.

  python3 scripts/publish_topics.py             # publish topics that HAVE an intro (the "ready" ones)
  python3 scripts/publish_topics.py --all       # publish EVERY topic
  python3 scripts/publish_topics.py --limit 50  # cap how many it flips
  python3 scripts/publish_topics.py --unpublish # set ALL topics back to Draft

Publishing only affects what shows in "Preview as reader" for now (Study is still
admin-only), so this is safe — re-run with --unpublish to undo.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import study_db   # noqa: E402
from generate_topic_intros import _COMMON   # noqa: E402  (the curated hot-topic list)


def main():
    ap = argparse.ArgumentParser(description="Batch publish/unpublish Study topics.")
    ap.add_argument("--all", action="store_true", help="publish every topic (default: only ones with an intro)")
    ap.add_argument("--common", action="store_true", help="only the curated hot topics (same list the intro script uses)")
    ap.add_argument("--unpublish", action="store_true", help="set topics back to Draft instead")
    ap.add_argument("--limit", type=int, default=0, help="stop after N changes (0 = no cap)")
    args = ap.parse_args()

    target = "draft" if args.unpublish else "published"
    conn = study_db()
    rows = conn.execute(
        "SELECT id, title, json, status FROM entries WHERE type='topic' AND deleted=0 ORDER BY title"
    ).fetchall()
    if args.common:
        wanted = {t.lower() for t in _COMMON}
        rows = [r for r in rows if (r["title"] or "").strip().lower() in wanted]
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    changed = 0
    for r in rows:
        # default (publishing, not --all): only topics that already have an intro
        if not args.unpublish and not args.all:
            try:
                stored = json.loads(r["json"]) or {}
            except (ValueError, TypeError):
                stored = {}
            if not (stored.get("intro") or "").strip():
                continue
        if r["status"] == target:
            continue   # already there
        conn.execute("UPDATE entries SET status=?, updated=? WHERE id=?", (target, now, r["id"]))
        changed += 1
        if args.limit and changed >= args.limit:
            break

    conn.commit()
    conn.close()
    print("Set {} topic(s) to {}.".format(changed, target))


if __name__ == "__main__":
    main()
