#!/usr/bin/env python3
"""
load_didache.py — load the tagged Didache into bible.db (its OWN tables).

SAFE: creates/fills two NEW tables only (didache_words, didache_verses). It
never reads or writes the Bible's words/verses/lexicon. Safe to re-run — it
clears and refills only the Didache tables each time.

Run on PythonAnywhere AFTER git pull:
    python3 scripts/didache_proof/load_didache.py bible.db

Inputs (same folder):
    didache_tagged_full.json  - every word: ref, greek, lemma, strongs, gloss
    didache_english.json      - readable English per verse: {"1.1": "...", ...}
"""
import json, sqlite3, sys
from pathlib import Path

HERE = Path(__file__).parent


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else "bible.db"
    words = json.loads((HERE / "didache_tagged_full.json").read_text(encoding="utf-8"))
    english = json.loads((HERE / "didache_english.json").read_text(encoding="utf-8"))

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # its own tables — nothing else in the database is touched
    cur.executescript("""
        DROP TABLE IF EXISTS didache_words;
        DROP TABLE IF EXISTS didache_verses;
        CREATE TABLE didache_words (
            chapter  INTEGER, verse INTEGER, position INTEGER,
            greek    TEXT, lemma TEXT, strongs TEXT, gloss TEXT
        );
        CREATE TABLE didache_verses (
            chapter INTEGER, verse INTEGER, english TEXT
        );
        CREATE INDEX idx_didache_words_cv  ON didache_words(chapter, verse);
        CREATE INDEX idx_didache_verses_cv ON didache_verses(chapter, verse);
    """)

    # words — split "ch.vs" ref, keep order via a running position per verse
    pos_by_ref, wrows = {}, []
    for w in words:
        ch, vs = (int(x) for x in w["ref"].split("."))
        pos = pos_by_ref.get(w["ref"], 0)
        pos_by_ref[w["ref"]] = pos + 1
        wrows.append((ch, vs, pos, w["greek"], w["lemma"], w.get("strongs"), w["gloss"]))
    cur.executemany(
        "INSERT INTO didache_words VALUES (?,?,?,?,?,?,?)", wrows)

    # english per verse
    vrows = []
    for ref, text in english.items():
        ch, vs = (int(x) for x in ref.split("."))
        vrows.append((ch, vs, text))
    cur.executemany(
        "INSERT INTO didache_verses VALUES (?,?,?)", vrows)

    conn.commit()
    nw = cur.execute("SELECT count(*) FROM didache_words").fetchone()[0]
    nv = cur.execute("SELECT count(*) FROM didache_verses").fetchone()[0]
    conn.close()
    print(f"loaded didache_words: {nw} words, didache_verses: {nv} verses")


if __name__ == "__main__":
    main()
