#!/usr/bin/env python3
"""
Import metaV Bible data into bible.db.

Loads: Places, PlaceAliases, People, PeopleAliases, PeopleGroups,
       PeopleRelationships, Writers

Usage:
    python load_metav.py /path/to/csv/folder [bible.db]

CSV folder should contain:
    Places.csv, PlaceAliases.csv, People.csv, PeopleAliases.csv,
    PeopleGroups.csv, PeopleRelationships.csv, Writers.csv
"""

import csv
import sqlite3
import sys
from pathlib import Path

CSV_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
DB      = sys.argv[2] if len(sys.argv) > 2 else "/home/appssanding720/bible-db/bible.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS metav_places (
    place_id   INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    root       TEXT,
    comment    TEXT,
    lat        REAL,
    lon        REAL
);
CREATE INDEX IF NOT EXISTS idx_metav_places_name ON metav_places(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS metav_place_aliases (
    place_id   INTEGER NOT NULL REFERENCES metav_places(place_id),
    alias      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metav_place_aliases ON metav_place_aliases(alias COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS metav_people (
    person_id   INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    surname     TEXT,
    is_proper   INTEGER DEFAULT 1,
    gender      TEXT,
    birth_year  TEXT,
    death_year  TEXT,
    birth_place TEXT,
    death_place TEXT
);
CREATE INDEX IF NOT EXISTS idx_metav_people_name ON metav_people(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS metav_people_aliases (
    person_id  INTEGER NOT NULL REFERENCES metav_people(person_id),
    alias      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metav_people_aliases ON metav_people_aliases(alias COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS metav_people_groups (
    person_id  INTEGER NOT NULL REFERENCES metav_people(person_id),
    group_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metav_people_relationships (
    person_id  INTEGER NOT NULL REFERENCES metav_people(person_id),
    related_to INTEGER NOT NULL REFERENCES metav_people(person_id),
    rel_type   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metav_writers (
    book_id    INTEGER NOT NULL,
    writer     TEXT NOT NULL
);
"""


def read_csv(filename):
    path = CSV_DIR / filename
    if not path.exists():
        print(f"  WARNING: {filename} not found — skipping")
        return []
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def clean(val):
    if val is None:
        return None
    v = val.strip().strip('"')
    return v if v else None


def load_places(conn):
    rows = read_csv("Places.csv")
    if not rows:
        return
    conn.execute("DELETE FROM metav_places")
    for r in rows:
        lat = float(r.get("Lat", 0) or 0)
        lon = float(r.get("Lon", 0) or 0)
        conn.execute(
            "INSERT OR REPLACE INTO metav_places (place_id, name, root, comment, lat, lon) VALUES (?,?,?,?,?,?)",
            (int(r["PlaceID"]), clean(r["PlaceName"]), clean(r.get("Root")),
             clean(r.get("Comment")), lat if lat != 0 else None, lon if lon != 0 else None)
        )
    print(f"  Places: {len(rows)} rows")


def load_place_aliases(conn):
    rows = read_csv("PlaceAliases.csv")
    if not rows:
        return
    conn.execute("DELETE FROM metav_place_aliases")
    data = [(int(r["PlaceID"]), clean(r["Alias"])) for r in rows if clean(r.get("Alias"))]
    conn.executemany("INSERT INTO metav_place_aliases (place_id, alias) VALUES (?,?)", data)
    print(f"  PlaceAliases: {len(data)} rows")


def load_people(conn):
    rows = read_csv("People.csv")
    if not rows:
        return
    conn.execute("DELETE FROM metav_people")
    data = []
    for r in rows:
        data.append((
            int(r["PersonID"]),
            clean(r["Name"]),
            clean(r.get("Surname")),
            int(r.get("IsProperName") or 1),
            clean(r.get("Gender")),
            clean(r.get("BirthYear")),
            clean(r.get("DeathYear")),
            clean(r.get("BirthPlace")),
            clean(r.get("DeathPlace")),
        ))
    conn.executemany(
        "INSERT OR REPLACE INTO metav_people (person_id, name, surname, is_proper, gender, birth_year, death_year, birth_place, death_place) VALUES (?,?,?,?,?,?,?,?,?)",
        data
    )
    print(f"  People: {len(data)} rows")


def load_people_aliases(conn):
    rows = read_csv("PeopleAliases.csv")
    if not rows:
        return
    conn.execute("DELETE FROM metav_people_aliases")
    data = [(int(r["PersonID"]), clean(r["Alias"])) for r in rows if clean(r.get("Alias"))]
    conn.executemany("INSERT INTO metav_people_aliases (person_id, alias) VALUES (?,?)", data)
    print(f"  PeopleAliases: {len(data)} rows")


def load_people_groups(conn):
    rows = read_csv("PeopleGroups.csv")
    if not rows:
        return
    conn.execute("DELETE FROM metav_people_groups")
    data = [(int(r["PersonID"]), clean(r["GroupName"])) for r in rows if clean(r.get("GroupName"))]
    conn.executemany("INSERT INTO metav_people_groups (person_id, group_name) VALUES (?,?)", data)
    print(f"  PeopleGroups: {len(data)} rows")


def load_people_relationships(conn):
    rows = read_csv("PeopleRelationships.csv")
    if not rows:
        return
    conn.execute("DELETE FROM metav_people_relationships")
    data = [
        (int(r["Primary"]), int(r["RelatedTo"]), clean(r["RelType"]))
        for r in rows if clean(r.get("RelType"))
    ]
    conn.executemany(
        "INSERT INTO metav_people_relationships (person_id, related_to, rel_type) VALUES (?,?,?)",
        data
    )
    print(f"  PeopleRelationships: {len(data)} rows")


def load_writers(conn):
    rows = read_csv("Writers.csv")
    if not rows:
        return
    conn.execute("DELETE FROM metav_writers")
    data = [(int(r["BookID"]), clean(r["Writer"])) for r in rows if clean(r.get("Writer"))]
    conn.executemany("INSERT INTO metav_writers (book_id, writer) VALUES (?,?)", data)
    print(f"  Writers: {len(data)} rows")


def main():
    print(f"Loading metaV data from: {CSV_DIR}")
    print(f"Target database: {DB}")

    conn = sqlite3.connect(DB)
    conn.executescript(SCHEMA)

    load_places(conn)
    load_place_aliases(conn)
    load_people(conn)
    load_people_aliases(conn)
    load_people_groups(conn)
    load_people_relationships(conn)
    load_writers(conn)

    conn.commit()
    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
