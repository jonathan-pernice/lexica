#!/usr/bin/env python3
"""Import MetaV topics into the Study modules engine (study.db) as draft entries.

MetaV (github.com/gusheng/MetaV) carries ~2,035 topics from Nave's + Torrey's,
each linked to its verses. This turns each MAIN topic (e.g. "Faith", "Aaron")
into one DRAFT study entry: the topic's verses are dropped into the Support bucket,
in canonical order, de-duplicated. You then curate each one in the Study tab —
add the tension verses, set the middle road / mystery. Nothing is published.

It's grouped by main topic (the subtopics under a name are merged into that one
entry). Re-running is safe: an entry whose id already exists is left alone (your
edits survive) unless you pass --replace.

Runs on PythonAnywhere, where study.db lives. Reads three files from the MetaV CSV
folder: Verses.csv (verse id -> book/chapter/verse), Topics.csv (id, main, sub),
TopicIndex.csv (topic id -> verse id).

Usage:
    python scripts/load_study_topics.py /path/to/MetaV/CSV            # first 25, a taste
    python scripts/load_study_topics.py /path/to/MetaV/CSV --limit 0  # everything
    python scripts/load_study_topics.py /path/to/MetaV/CSV --only Faith,Grace,Baptism
    python scripts/load_study_topics.py /path/to/MetaV/CSV --replace  # overwrite imported ones
"""
import argparse
import csv
import json
import os
import re
import sqlite3
import sys
import time

# Books 1..66 in canonical order -> the display name the engine's reference parser
# understands (matches views_study._BOOK_DISPLAY). MetaV BookID is this same 1..66.
BOOK_NAMES = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges",
    "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles",
    "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes",
    "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
    "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
    "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John",
    "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy",
    "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
    "1 John", "2 John", "3 John", "Jude", "Revelation",
]

_MAX_VERSES = 300   # cap a single entry's Support bucket (matches the backend cap)


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return s or "topic"


def load_verses(csv_dir):
    """Verses.csv -> {VerseID: (BookID, Chapter, VerseNum)}. Has a header row."""
    out = {}
    with open(os.path.join(csv_dir, "Verses.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                out[r["VerseID"]] = (int(r["BookID"]), int(r["Chapter"]), int(r["VerseNum"]))
            except (KeyError, ValueError, TypeError):
                continue
    return out


def load_topics(csv_dir):
    """Topics.csv -> {TopicID: (main, sub)}. NO header (first line is data)."""
    out = {}
    with open(os.path.join(csv_dir, "Topics.csv"), newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            if not row:
                continue
            tid = (row[0] or "").strip()
            main = (row[1] or "").strip() if len(row) > 1 else ""
            sub = (row[2] or "").strip() if len(row) > 2 else ""
            if tid and main:
                out[tid] = (main, sub)
    return out


def load_topic_index(csv_dir):
    """TopicIndex.csv -> {TopicID: [VerseID,...]}. Has a header row."""
    out = {}
    with open(os.path.join(csv_dir, "TopicIndex.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            tid = (r.get("TopicID") or "").strip()
            vid = (r.get("VerseID") or "").strip()
            if tid and vid:
                out.setdefault(tid, []).append(vid)
    return out


def make_ref(verses, vid):
    """VerseID -> 'Genesis 1:1' (or None if unknown / out of range)."""
    loc = verses.get(vid)
    if not loc:
        return None
    book_id, ch, vnum = loc
    if not (1 <= book_id <= 66):
        return None
    return f"{BOOK_NAMES[book_id - 1]} {ch}:{vnum}"


def group_by_main(topics, topic_index, verses):
    """Merge every subtopic under its main topic into one ordered, de-duped verse
    list. Returns [(main_topic, [ref, ...]), ...] sorted by main topic."""
    by_main = {}   # main -> list of (book_id, ch, vnum, ref), to sort canonically
    for tid, (main, _sub) in topics.items():
        for vid in topic_index.get(tid, []):
            loc = verses.get(vid)
            ref = make_ref(verses, vid)
            if loc and ref:
                by_main.setdefault(main, []).append((loc[0], loc[1], loc[2], ref))
    out = []
    for main in sorted(by_main, key=lambda s: s.lower()):
        seen, refs = set(), []
        for _b, _c, _v, ref in sorted(by_main[main]):
            if ref not in seen:
                seen.add(ref)
                refs.append(ref)
        out.append((main, refs[:_MAX_VERSES]))
    return out


def ensure_table(conn):
    conn.execute(
        "CREATE TABLE IF NOT EXISTS entries ("
        " id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,"
        " json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',"
        " created TEXT NOT NULL, updated TEXT NOT NULL,"
        " deleted INTEGER NOT NULL DEFAULT 0)"
    )


def main():
    ap = argparse.ArgumentParser(description="Import MetaV topics into study.db as draft entries.")
    ap.add_argument("csv_dir", help="MetaV CSV folder (holds Topics.csv, TopicIndex.csv, Verses.csv)")
    ap.add_argument("--db", default=None, help="study.db path (default: alongside the app)")
    ap.add_argument("--limit", type=int, default=25, help="max topics to import (0 = all). Default 25.")
    ap.add_argument("--only", default="", help="comma-separated main-topic names to import (overrides --limit)")
    ap.add_argument("--replace", action="store_true", help="overwrite already-imported entries (default: skip)")
    args = ap.parse_args()

    db_path = args.db or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "study.db")
    print(f"MetaV CSV folder: {args.csv_dir}")
    print(f"study.db:         {db_path}")

    verses = load_verses(args.csv_dir)
    topics = load_topics(args.csv_dir)
    topic_index = load_topic_index(args.csv_dir)
    print(f"Loaded {len(verses):,} verses, {len(topics):,} topic rows, {len(topic_index):,} indexed topics.")

    grouped = group_by_main(topics, topic_index, verses)
    print(f"Grouped into {len(grouped):,} main topics.")

    if args.only.strip():
        wanted = {w.strip().lower() for w in args.only.split(",") if w.strip()}
        grouped = [g for g in grouped if g[0].lower() in wanted]
    elif args.limit and args.limit > 0:
        grouped = grouped[:args.limit]

    conn = sqlite3.connect(db_path)
    ensure_table(conn)
    now = _now()
    created = skipped = 0
    for main, refs in grouped:
        if not refs:
            continue
        entry_id = "metav_" + slugify(main)
        exists = conn.execute("SELECT 1 FROM entries WHERE id=?", (entry_id,)).fetchone()
        if exists and not args.replace:
            skipped += 1
            continue
        body = json.dumps({
            "heldBy": "", "intro": "",
            "support": refs, "tension": [],
            "resolution": {"mode": "middle", "text": ""},
            "notes": "", "related": [], "source": "metav",
        }, ensure_ascii=False)
        if exists:
            conn.execute(
                "UPDATE entries SET type='topic', title=?, json=?, status='draft', updated=?, deleted=0 WHERE id=?",
                (main, body, now, entry_id),
            )
        else:
            conn.execute(
                "INSERT INTO entries (id, type, title, json, status, created, updated, deleted)"
                " VALUES (?,?,?,?,?,?,?,0)",
                (entry_id, "topic", main, body, "draft", now, now),
            )
        created += 1
    conn.commit()
    conn.close()
    print(f"Done. {created} entries written, {skipped} left untouched (already imported).")
    print("Open the Study tab → Topics to review and curate them.")


if __name__ == "__main__":
    main()
