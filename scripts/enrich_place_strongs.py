#!/usr/bin/env python3
"""
Enrich metav_places with Greek Strong's numbers by cross-referencing
kjv_words and kjv_strongs tables.

For each place name (and its aliases), finds the most frequently used
G-number in the KJV, then stores it in metav_places.strongs_g.

Usage:
    python enrich_place_strongs.py [bible.db]
"""

import sqlite3
import sys
from pathlib import Path

DB = sys.argv[1] if len(sys.argv) > 1 else "/home/appssanding720/bible-db/bible.db"


def find_strongs_for_name(conn, name: str) -> str | None:
    """Find the most common G-number for a place name in KJV."""
    row = conn.execute("""
        SELECT ks.strongs_id, COUNT(*) AS cnt
        FROM kjv_words kw
        JOIN kjv_strongs ks ON ks.word_id = kw.word_id
        WHERE kw.word = ? COLLATE NOCASE
          AND ks.strongs_id LIKE 'G%'
        GROUP BY ks.strongs_id
        ORDER BY cnt DESC
        LIMIT 1
    """, (name,)).fetchone()
    return row["strongs_id"] if row else None


def main():
    conn = sqlite3.connect(DB, timeout=30)
    conn.row_factory = sqlite3.Row

    # Add strongs_g column if not exists
    try:
        conn.execute("ALTER TABLE metav_places ADD COLUMN strongs_g TEXT")
        conn.commit()
        print("Added strongs_g column")
    except sqlite3.OperationalError:
        print("strongs_g column already exists")

    places = conn.execute(
        "SELECT place_id, name FROM metav_places ORDER BY place_id"
    ).fetchall()

    updated = 0
    not_found = 0

    for idx, place in enumerate(places):
        if idx % 100 == 0:
            print(f"  Processing {idx}/{len(places)}...")
        pid = place["place_id"]
        name = place["name"]

        # Try primary name first
        strongs = find_strongs_for_name(conn, name)

        # Try aliases if not found
        if not strongs:
            aliases = conn.execute(
                "SELECT alias FROM metav_place_aliases WHERE place_id = ?", (pid,)
            ).fetchall()
            for a in aliases:
                strongs = find_strongs_for_name(conn, a["alias"])
                if strongs:
                    break

        if strongs:
            conn.execute(
                "UPDATE metav_places SET strongs_g = ? WHERE place_id = ?",
                (strongs, pid)
            )
            updated += 1
        else:
            not_found += 1

    conn.commit()
    conn.close()
    print(f"Updated: {updated} places with G-numbers")
    print(f"Not found: {not_found} places")
    print("Done.")


if __name__ == "__main__":
    print(f"Database: {DB}")
    main()
