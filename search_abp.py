#!/usr/bin/env python3
"""
Search bible.db by English gloss.

Usage:
    python search_abp.py spirit
    python search_abp.py spirit breath      # matches either term
    python search_abp.py "holy spirit"      # exact phrase substring
    python search_abp.py -w wind            # whole-word match only
    python search_abp.py --all spirit       # show all results (default: 20)
"""

import re
import sqlite3
import sys

sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_LIMIT = 20

_STRONGS_RE = re.compile(r'^G?(\d+(?:\.\d+)*)$', re.IGNORECASE)


def _strongs_num(term: str):
    m = _STRONGS_RE.match(term.strip())
    return m.group(1) if m else None


def search(db_path: str, terms: list, word_boundary: bool = False, limit: int = DEFAULT_LIMIT) -> None:
    conn = sqlite3.connect(db_path)

    snums = [_strongs_num(t) for t in terms]
    if all(snums):
        parts = [("w.strongs" if "." in n else "w.strongs_base") + " = ?" for n in snums]
        conditions = " OR ".join(parts)
        params = snums
    else:
        conditions = " OR ".join(["w.english_head LIKE ? COLLATE NOCASE"] * len(terms))
        params = [f"%{t}%" for t in terms]

    rows = conn.execute(
        f"""
        SELECT w.strongs_base, w.strongs, w.english, w.english_head,
               v.book, v.chapter, v.verse,
               l.lemma, l.translit
        FROM words w
        JOIN verses v ON w.verse_id = v.id
        LEFT JOIN lexicon l ON l.strongs = w.strongs_base
        WHERE {conditions}
        ORDER BY v.id, w.position
        """,
        params,
    ).fetchall()
    conn.close()

    if word_boundary and not all(snums):
        pats = [re.compile(r'\b' + re.escape(t) + r'\b', re.IGNORECASE) for t in terms]
        rows = [r for r in rows if any(p.search(r[3] or '') for p in pats)]

    # r: (strongs_base, strongs, english, english_head, book, chapter, verse, lemma, translit)

    if not rows:
        print("No matches found.")
        return

    total = len(rows)
    unique_verses = {(r[4], r[5], r[6]) for r in rows}
    query_str = " / ".join(f'"{t}"' for t in terms)
    shown = rows if limit is None else rows[:limit]
    truncated = limit is not None and total > limit

    suffix = f"  [showing {len(shown)} of {total}]" if truncated else ""
    print(f"{query_str}: {total} occurrence(s) in {len(unique_verses)} verse(s){suffix}\n")

    ref_width  = max(len(f"{r[4]} {r[5]}:{r[6]}") for r in shown)
    form_width = max(len(f"G{r[1]}") for r in shown)

    for strongs_base, strongs, english, english_head, book, chapter, verse, lemma, translit in shown:
        ref   = f"{book} {chapter}:{verse}"
        form  = f"G{strongs}" if strongs != strongs_base else f"G{strongs_base}"
        lex   = f"  {lemma} ({translit})" if lemma else ""
        gloss = f'"{english}"' if english else "(no gloss)"
        print(f"  {ref:<{ref_width}}  {form:<{form_width}}  {gloss}{lex}")

    if truncated:
        print(f"\n  ... {total - len(shown)} more — use --all to see everything.")


def main() -> None:
    args = sys.argv[1:]
    word_boundary = "-w" in args or "--words" in args
    show_all      = "--all" in args
    args = [a for a in args if a not in ("-w", "--words", "--all")]

    if not args:
        print("Usage: python search_abp.py [-w] [--all] [bible.db] <term> [term ...]")
        sys.exit(1)

    if args[0].endswith(".db"):
        db_path = args[0]
        terms   = args[1:]
    else:
        db_path = "bible.db"
        terms   = args

    if not terms:
        print("Usage: python search_abp.py [-w] [--all] [bible.db] <term> [term ...]")
        sys.exit(1)

    search(db_path, terms, word_boundary=word_boundary, limit=None if show_all else DEFAULT_LIMIT)


if __name__ == "__main__":
    main()
