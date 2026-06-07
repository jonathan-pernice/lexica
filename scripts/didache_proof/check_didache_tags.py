#!/usr/bin/env python3
"""
check_didache_tags.py — verify hand-tagged Didache words against the real lexicon.

READ-ONLY. Opens bible.db read-only and never writes to it. For every word I
hand-tagged it confirms the Strong's number actually exists in YOUR lexicon and
that the dictionary form I gave matches the lexicon's lemma (accents ignored).
Anything that doesn't line up is printed for review; words with no Strong's
(genuine non-biblical vocabulary) are listed separately.

Run on PythonAnywhere:
    python3 check_didache_tags.py didache_tagged.json [bible.db]

Tagged-file format (one JSON list):
    [{"ref":"1.2","greek":"ἀγαπήσεις","lemma":"ἀγαπάω","strongs":"G25","gloss":"you shall love"}, ...]
strongs = null  ->  treated as a deliberate "no Strong's" miss.
"""
import json, sqlite3, sys, unicodedata
from pathlib import Path


def strip_accents(s: str) -> str:
    """Lower-case, drop accents/breathings, normalize final sigma — for lemma compare."""
    if not s:
        return ""
    s = s.replace("ς", "σ")
    nfd = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in nfd if not unicodedata.combining(c))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    tagged_path = Path(sys.argv[1])
    db_path = sys.argv[2] if len(sys.argv) > 2 else "bible.db"

    words = json.loads(tagged_path.read_text(encoding="utf-8"))

    # read-only open — cannot modify the database
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = conn.cursor()

    # build {normalized lemma -> strongs_g} so we can tell whether a word I
    # marked "no-Strong's" actually DOES have an entry (a recoverable miss).
    lex_by_lemma = {}
    for sg, lem in cur.execute("SELECT strongs_g, lemma FROM lexicon").fetchall():
        if lem:
            lex_by_lemma.setdefault(strip_accents(lem), sg)

    ok, misses, bad_number, lemma_flags, recoverable = [], [], [], [], []

    for w in words:
        ref, greek = w.get("ref", "?"), w.get("greek", "?")
        strongs, my_lemma = w.get("strongs"), w.get("lemma", "")

        if not strongs:                       # I marked it as no-Strong's
            hit = lex_by_lemma.get(strip_accents(my_lemma))
            if hit:                           # ...but the lemma IS in the lexicon
                recoverable.append((ref, greek, my_lemma, hit))
            else:
                misses.append((ref, greek, my_lemma))
            continue

        row = cur.execute(
            "SELECT lemma FROM lexicon WHERE strongs_g = ?", (strongs,)
        ).fetchone()

        if row is None:                       # number doesn't exist in the lexicon
            bad_number.append((ref, greek, strongs, my_lemma))
            continue

        lex_lemma = row[0] or ""
        if strip_accents(lex_lemma) == strip_accents(my_lemma):
            ok.append((ref, greek, strongs))
        else:                                 # number exists but lemma looks off
            lemma_flags.append((ref, greek, strongs, my_lemma, lex_lemma))

    conn.close()

    total = len(words)
    print(f"\n=== Didache tag check: {tagged_path.name} ===")
    print(f"  total words      : {total}")
    print(f"  confirmed OK     : {len(ok)}  ({round(len(ok)/total*100)}%)")
    print(f"  no-Strong's (ok) : {len(misses)}")
    print(f"  recoverable      : {len(recoverable)}   <- I can add a number")
    print(f"  BAD number       : {len(bad_number)}   <- fix these")
    print(f"  lemma mismatch   : {len(lemma_flags)}   <- review these")

    if recoverable:
        print("\n-- recoverable (I marked no-Strong's, but the lemma IS in your lexicon) --")
        for ref, gk, lem, sg in recoverable:
            print(f"   {ref:>5}  {gk:<16} {lem:<14} -> {sg}")

    if bad_number:
        print("\n-- BAD Strong's numbers (not in your lexicon) --")
        for ref, gk, sg, lem in bad_number:
            print(f"   {ref:>5}  {gk:<16} {sg:<8} (I said lemma {lem})")

    if lemma_flags:
        print("\n-- lemma mismatches (number exists, dictionary form differs) --")
        for ref, gk, sg, mine, lex in lemma_flags:
            print(f"   {ref:>5}  {gk:<16} {sg:<8} mine={mine:<14} lexicon={lex}")

    if misses:
        print("\n-- no-Strong's words (genuine non-biblical vocabulary) --")
        for ref, gk, lem in misses:
            print(f"   {ref:>5}  {gk:<16} ({lem})")

    print()


if __name__ == "__main__":
    main()
