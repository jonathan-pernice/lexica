#!/usr/bin/env python3
"""One-time: draft a short, text-first intro for each Study TOPIC that lacks one.

Runs on PythonAnywhere (it needs study.db + bible.db + the Anthropic key). It reuses
the SAME `_draft_intro` the in-app "Draft with AI" button uses, so the voice matches.
Safe to re-run — by default it only fills topics whose intro is still empty.

  python3 scripts/generate_topic_intros.py              # fill only empty intros
  python3 scripts/generate_topic_intros.py --limit 10   # just the first 10 (a test batch)
  python3 scripts/generate_topic_intros.py --replace    # redo EVERY topic's intro

IMPORTANT — the API key:
  The key lives in the WSGI file, not a .env, so a shell run won't see it automatically.
  Grab ANTHROPIC_API_KEY from /var/www/www_lexica_bible_wsgi.py and export it first:
      export ANTHROPIC_API_KEY='sk-...'
  then run the command above. The script stops with a clear message if it's missing.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import study_db, _anthropic                 # noqa: E402
from views_study import _draft_intro, _resolve_ref     # noqa: E402


def _sections_with_text(stored, per_section=2):
    """Rebuild the topic's sections with a couple of resolved verse texts each, for
    grounding (the stored json holds only references)."""
    out = []
    for s in (stored.get("sections") or []):
        s = s or {}
        verses = []
        for ref in (s.get("verses") or [])[:per_section]:
            hits = _resolve_ref(ref)
            verses.append({"ref": ref, "text": " ".join(h["text"] for h in hits) if hits else ""})
        out.append({"heading": s.get("heading", ""), "verses": verses})
    return out


def main():
    ap = argparse.ArgumentParser(description="Draft text-first intros for Study topics.")
    ap.add_argument("--replace", action="store_true", help="redo intros that already exist")
    ap.add_argument("--limit", type=int, default=0, help="stop after N (0 = all)")
    args = ap.parse_args()

    if _anthropic is None:
        print("ANTHROPIC_API_KEY is not set in this shell — it lives in the WSGI file, not .env.")
        print("Grab it and export it first, e.g.:  export ANTHROPIC_API_KEY='sk-...'   then re-run.")
        sys.exit(1)

    conn = study_db()
    rows = conn.execute(
        "SELECT id, title, json FROM entries WHERE type='topic' AND deleted=0 ORDER BY title"
    ).fetchall()
    print("Topics found: {}".format(len(rows)))

    done = skipped = failed = 0
    for r in rows:
        try:
            stored = json.loads(r["json"]) or {}
        except (ValueError, TypeError):
            stored = {}
        if (stored.get("intro") or "").strip() and not args.replace:
            skipped += 1
            continue
        intro = _draft_intro(r["title"], _sections_with_text(stored))
        if not intro:
            failed += 1
            print("  ! no intro: {}".format(r["title"]))
            continue
        stored["intro"] = intro
        conn.execute(
            "UPDATE entries SET json=?, updated=? WHERE id=?",
            (json.dumps(stored, ensure_ascii=False),
             time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), r["id"]),
        )
        conn.commit()
        done += 1
        print("  [{}] {}".format(done, r["title"]))
        if args.limit and done >= args.limit:
            break
        time.sleep(0.2)   # be gentle on the API

    conn.close()
    print("\nDone. Wrote {} intros, skipped {} (already had one), {} failed.".format(done, skipped, failed))


if __name__ == "__main__":
    main()
