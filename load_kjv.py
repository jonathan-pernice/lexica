"""
load_kjv.py — Import KJV + Strong's data into bible.db

Usage (on PythonAnywhere):
    python load_kjv.py

Expects all four CSVs and bible.db in the same directory:
    /home/appssanding720/bible-db/
"""

import csv
import sqlite3
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DB   = os.path.join(BASE, "bible.db")

CSV = {
    "verses":   os.path.join(BASE, "Verses.csv"),
    "main":     os.path.join(BASE, "MainIndex.csv"),
    "strongs":  os.path.join(BASE, "StrongsIndex.csv"),
    "bdb":      os.path.join(BASE, "Strongs.csv"),
}

# ── Verify files exist before touching the DB ────────────────────────────────
missing = [p for p in CSV.values() if not os.path.exists(p)]
if missing:
    print("ERROR: missing files:")
    for p in missing: print(" ", p)
    sys.exit(1)

conn = sqlite3.connect(DB)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA foreign_keys=OFF")

# ── Create tables (do NOT touch existing tables) ─────────────────────────────
conn.executescript("""
CREATE TABLE IF NOT EXISTS kjv_verses (
    verse_id   INTEGER PRIMARY KEY,
    book_id    INTEGER NOT NULL,
    chapter    INTEGER NOT NULL,
    verse_num  INTEGER NOT NULL,
    verse_text TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS kjv_words (
    word_id   INTEGER PRIMARY KEY,
    book_id   INTEGER NOT NULL,
    chapter   INTEGER NOT NULL,
    verse_num INTEGER NOT NULL,
    verse_pos INTEGER NOT NULL,
    word      TEXT    NOT NULL,
    italic    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kjv_strongs (
    word_id    INTEGER NOT NULL,
    strongs_id TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS bdb (
    strongs_id     TEXT PRIMARY KEY,
    lemma          TEXT,
    xlit           TEXT,
    pronounce      TEXT,
    description    TEXT,
    part_of_speech TEXT
);
""")
conn.commit()
print("Tables ready.")


def load_csv(path, encoding="utf-8-sig"):
    """Return a DictReader for the given file, trying utf-8-sig then latin-1."""
    try:
        f = open(path, newline="", encoding=encoding)
        reader = csv.DictReader(f)
        next(reader)           # probe first row
        f.seek(0)
        reader = csv.DictReader(f)
        return f, reader
    except UnicodeDecodeError:
        f.close()
        f = open(path, newline="", encoding="latin-1")
        return f, csv.DictReader(f)


# ── kjv_verses ────────────────────────────────────────────────────────────────
print("Loading kjv_verses …")
conn.execute("DELETE FROM kjv_verses")
f, reader = load_csv(CSV["verses"])
rows = 0
with f:
    batch = []
    for row in reader:
        batch.append((
            int(row["VerseID"]),
            int(row["BookID"]),
            int(row["Chapter"]),
            int(row["VerseNum"]),
            row["VerseText"].strip(),
        ))
        if len(batch) == 2000:
            conn.executemany(
                "INSERT INTO kjv_verses VALUES (?,?,?,?,?)", batch)
            rows += len(batch); batch = []
    if batch:
        conn.executemany("INSERT INTO kjv_verses VALUES (?,?,?,?,?)", batch)
        rows += len(batch)
conn.commit()
print(f"  kjv_verses: {rows:,} rows")


# ── kjv_words ─────────────────────────────────────────────────────────────────
print("Loading kjv_words …")
conn.execute("DELETE FROM kjv_words")
f, reader = load_csv(CSV["main"])
rows = 0
with f:
    batch = []
    for row in reader:
        italic = 1 if str(row.get("Italic", "0")).strip() in ("1", "true", "True", "TRUE", "y", "Y") else 0
        batch.append((
            int(row["WordID"]),
            int(row["BookID"]),
            int(row["Chapter"]),
            int(row["VerseNum"]),
            int(row["VersePos"]),
            row["Word"].strip(),
            italic,
        ))
        if len(batch) == 5000:
            conn.executemany(
                "INSERT INTO kjv_words VALUES (?,?,?,?,?,?,?)", batch)
            rows += len(batch); batch = []
    if batch:
        conn.executemany("INSERT INTO kjv_words VALUES (?,?,?,?,?,?,?)", batch)
        rows += len(batch)
conn.commit()
print(f"  kjv_words: {rows:,} rows")


# ── kjv_strongs ───────────────────────────────────────────────────────────────
print("Loading kjv_strongs …")
conn.execute("DELETE FROM kjv_strongs")
f, reader = load_csv(CSV["strongs"])
rows = 0
with f:
    batch = []
    for row in reader:
        batch.append((
            int(row["WordID"]),
            row["StrongsID"].strip(),
        ))
        if len(batch) == 5000:
            conn.executemany(
                "INSERT INTO kjv_strongs VALUES (?,?)", batch)
            rows += len(batch); batch = []
    if batch:
        conn.executemany("INSERT INTO kjv_strongs VALUES (?,?)", batch)
        rows += len(batch)
conn.commit()
print(f"  kjv_strongs: {rows:,} rows")


# ── bdb (Hebrew only) ─────────────────────────────────────────────────────────
print("Loading bdb (Hebrew Strong's only) …")
conn.execute("DELETE FROM bdb")
f, reader = load_csv(CSV["bdb"])
rows = skipped = 0
with f:
    batch = []
    for row in reader:
        sid = row.get("StrongsID", row.get("strongs_id", "")).strip()
        if not sid.startswith("H"):
            skipped += 1
            continue
        batch.append((
            sid,
            row.get("Lemma",        row.get("lemma",        "")).strip() or None,
            row.get("Xlit",         row.get("xlit",         "")).strip() or None,
            row.get("Pronounce",    row.get("pronounce",    "")).strip() or None,
            row.get("Description",  row.get("description",  "")).strip() or None,
            row.get("PartOfSpeech", row.get("part_of_speech","")).strip() or None,
        ))
        if len(batch) == 2000:
            conn.executemany(
                "INSERT OR REPLACE INTO bdb VALUES (?,?,?,?,?,?)", batch)
            rows += len(batch); batch = []
    if batch:
        conn.executemany("INSERT OR REPLACE INTO bdb VALUES (?,?,?,?,?,?)", batch)
        rows += len(batch)
conn.commit()
print(f"  bdb: {rows:,} rows inserted, {skipped:,} non-Hebrew skipped")


# ── Indexes ───────────────────────────────────────────────────────────────────
print("Building indexes …")
conn.executescript("""
CREATE INDEX IF NOT EXISTS idx_kjv_verses_loc   ON kjv_verses(book_id, chapter, verse_num);
CREATE INDEX IF NOT EXISTS idx_kjv_words_id     ON kjv_words(word_id);
CREATE INDEX IF NOT EXISTS idx_kjv_strongs_word ON kjv_strongs(word_id);
CREATE INDEX IF NOT EXISTS idx_kjv_strongs_sid  ON kjv_strongs(strongs_id);
CREATE INDEX IF NOT EXISTS idx_bdb_strongs      ON bdb(strongs_id);
""")
conn.commit()
print("  indexes done.")

conn.close()
print("\nDone.")
