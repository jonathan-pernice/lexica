#!/usr/bin/env python3
"""
load_extra.py — load a tagged non-canonical text into bible.db (its OWN tables).

SAFE: creates/fills two NEW tables only, <book>_words and <book>_verses. It never
reads or writes the Bible's words/verses/lexicon. Safe to re-run — it clears and
refills only this text's two tables each time.

Run on PythonAnywhere after git pull, e.g. for the Didache:
    python3 scripts/load_extra.py bible.db didache \
        scripts/didache_proof/didache_tagged_full.json \
        scripts/didache_proof/didache_english.json

Inputs:
    <tagged.json>  - every word: ref ("ch.vs"), greek, lemma, strongs, gloss
    <english.json> - readable English per verse: {"1.1": "...", ...}
The <book> id must be lowercase letters/digits/underscore (it becomes the table name,
and the web route /api/extra/<book>/... reads those same tables).
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

BOOK_RE = re.compile(r"^[a-z0-9_]+$")


def load(db_path, book, tagged_path, english_path, headings_path=None):
    if not BOOK_RE.match(book):
        sys.exit(f"bad book id '{book}': use lowercase letters/digits/underscore only")
    words = json.loads(Path(tagged_path).read_text(encoding="utf-8"))
    english = json.loads(Path(english_path).read_text(encoding="utf-8"))
    headings = json.loads(Path(headings_path).read_text(encoding="utf-8")) if headings_path else {}

    wtable, vtable = f"{book}_words", f"{book}_verses"
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # its own two tables — nothing else in the database is touched
    cur.executescript(f"""
        DROP TABLE IF EXISTS {wtable};
        DROP TABLE IF EXISTS {vtable};
        CREATE TABLE {wtable} (
            chapter INTEGER, verse INTEGER, position INTEGER,
            greek   TEXT, lemma TEXT, strongs TEXT, gloss TEXT
        );
        CREATE TABLE {vtable} (
            chapter INTEGER, verse INTEGER, english TEXT, heading TEXT
        );
        CREATE INDEX idx_{wtable}_cv ON {wtable}(chapter, verse);
        CREATE INDEX idx_{vtable}_cv ON {vtable}(chapter, verse);
    """)

    # words — split "ch.vs" ref, keep order via a running position per verse
    pos_by_ref, wrows = {}, []
    for w in words:
        ch, vs = (int(x) for x in w["ref"].split("."))
        pos = pos_by_ref.get(w["ref"], 0)
        pos_by_ref[w["ref"]] = pos + 1
        wrows.append((ch, vs, pos, w["greek"], w["lemma"], w.get("strongs"), w["gloss"]))
    cur.executemany(f"INSERT INTO {wtable} VALUES (?,?,?,?,?,?,?)", wrows)

    # english + optional section heading per verse
    vrows = []
    for ref, text in english.items():
        ch, vs = (int(x) for x in ref.split("."))
        vrows.append((ch, vs, text, headings.get(ref)))
    cur.executemany(f"INSERT INTO {vtable} VALUES (?,?,?,?)", vrows)

    conn.commit()
    nw = cur.execute(f"SELECT count(*) FROM {wtable}").fetchone()[0]
    nv = cur.execute(f"SELECT count(*) FROM {vtable}").fetchone()[0]
    conn.close()
    print(f"loaded {wtable}: {nw} words, {vtable}: {nv} verses")


def main():
    if len(sys.argv) < 5:
        sys.exit("usage: load_extra.py <db> <book> <tagged.json> <english.json> [headings.json]")
    headings = sys.argv[5] if len(sys.argv) > 5 else None
    load(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], headings)


if __name__ == "__main__":
    main()
