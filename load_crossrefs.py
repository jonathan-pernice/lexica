"""
load_crossrefs.py — Import Torrey's TSK cross-references into bible.db

Usage (on PythonAnywhere):
    python load_crossrefs.py

Expects CrossRefIndex.csv and bible.db in the same directory.
Columns: VerseID, VerseRefID — both reference kjv_verses.verse_id
"""

import csv
import sqlite3
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DB   = os.path.join(BASE, "bible.db")
CSV  = os.path.join(BASE, "CrossRefIndex.csv")

if not os.path.exists(CSV):
    print(f"ERROR: {CSV} not found")
    sys.exit(1)

conn = sqlite3.connect(DB)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA foreign_keys=OFF")

conn.executescript("""
CREATE TABLE IF NOT EXISTS cross_references (
    id           INTEGER PRIMARY KEY,
    verse_id     INTEGER NOT NULL,
    verse_ref_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xref_verse ON cross_references(verse_id);
CREATE INDEX IF NOT EXISTS idx_xref_ref   ON cross_references(verse_ref_id);
""")
conn.commit()
print("Table ready.")

print("Loading cross_references …")
conn.execute("DELETE FROM cross_references")
rows = 0
with open(CSV, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    batch = []
    for row in reader:
        batch.append((int(row["VerseID"]), int(row["VerseRefID"])))
        if len(batch) == 5000:
            conn.executemany(
                "INSERT INTO cross_references (verse_id, verse_ref_id) VALUES (?,?)", batch)
            rows += len(batch)
            batch = []
    if batch:
        conn.executemany(
            "INSERT INTO cross_references (verse_id, verse_ref_id) VALUES (?,?)", batch)
        rows += len(batch)
conn.commit()
print(f"  cross_references: {rows:,} rows")

conn.close()
print("\nDone.")
