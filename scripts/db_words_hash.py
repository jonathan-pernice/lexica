#!/usr/bin/env python3
"""db_words_hash.py — READ-ONLY. Prints a content fingerprint of the words table
so a local copy and the PA copy can be compared for sameness. Same hash = the
word data matches; different = they've diverged (someone edited one since).

Usage:  python3 scripts/db_words_hash.py [bible.db]
"""
import sqlite3, hashlib, sys

db = sys.argv[1] if len(sys.argv) > 1 else "bible.db"
c = sqlite3.connect(db)
h = hashlib.md5()
for row in c.execute(
    "SELECT id, english, english_head, strongs, strongs_base, lemma, morph "
    "FROM words ORDER BY id"
):
    h.update(repr(row).encode("utf-8"))
print("words hash:", h.hexdigest())
print("rows:", c.execute("SELECT count(*) FROM words").fetchone()[0])
