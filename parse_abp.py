#!/usr/bin/env python3
"""
Parse ABP (Apostolic Bible Polyglot) interlinear text with Strong's numbers
into a SQLite database.

Usage:
    python parse_abp.py input.txt [output.db]
    cat input.txt | python parse_abp.py - [output.db]

Format handled:
    (Gen 1:1)  InG1722 the beginningG746 God madeG4160 G3588 G2316 ...
               ^^^^^^                   ^             ^^^^^^^^^^^^^^^^^
               english+strongs          strongs only  standalone Greek words
"""

import re
import sqlite3
import sys
from pathlib import Path

# G-number: standard (G1722), dotted ABP extension (G1510.7.3), proper noun (G*)
STRONGS_RE = re.compile(r'G([\d]+(?:\.[\d]+)*|\*)')

# Verse header: (Gen 1:1) — book is alphanumeric (handles multi-char like "1Kgs")
VERSE_RE = re.compile(
    r'\((\S+)\s+(\d+):(\d+)\)\s*(.*?)(?=\s*\(\S+\s+\d+:\d+\)|$)',
    re.DOTALL,
)


# Strips ABP bracket reordering markers: [2word 1other] -> "word other"
_BRACKET_RE  = re.compile(r'[\[\]]')
_NUMMARK_RE  = re.compile(r'(?<!\d)\d+\s*(?=[A-Za-z])')

# Words that are never the semantic head of a gloss
_FUNCTION_WORDS = frozenset({
    'a', 'an', 'the',
    'my', 'his', 'her', 'their', 'its', 'our', 'your',
    'he', 'she', 'it', 'they', 'we', 'you', 'i',
    'of', 'by', 'in', 'with', 'from', 'to', 'at', 'for',
    'upon', 'over', 'under', 'into', 'on', 'up', 'out',
    'and', 'or', 'but', 'not', 'no', 'as', 'so',
    'also', 'even', 'then', 'now',
})


def _clean_english(text: str) -> str | None:
    t = _BRACKET_RE.sub('', text)       # remove [ ]
    t = _NUMMARK_RE.sub('', t)          # remove positional digits (2spirit->spirit)
    t = t.strip(' .')                   # strip flanking dots/spaces
    t = re.sub(r'\s+', ' ', t)         # normalize whitespace
    return t or None


def _head_word(text: str) -> str | None:
    """Last non-function word of the gloss, lowercased — the primary search token.

    'God made' -> 'made', 'my spirit' -> 'spirit', 'destroyed by the wind' -> 'wind'.
    In ABP interlinear, context words from the previous entry often appear at the
    start of the next gloss, so the last content word is the truest translation.
    """
    if not text:
        return None
    tokens = [re.sub(r"[^\w]", "", w).lower() for w in text.split()]
    tokens = [t for t in tokens if t]
    for tok in reversed(tokens):
        if tok not in _FUNCTION_WORDS:
            return tok
    return tokens[-1] if tokens else None


def parse_words(verse_text: str) -> list:
    """
    Return list of (position, english, strongs) for one verse.

    english is None when the Strong's number has no English gloss
    (i.e. it appears as a bare G#### in the stream).
    strongs is the raw number string, e.g. '1722', '1510.7.3', '*'.
    """
    words = []
    last_end = 0

    for pos, m in enumerate(STRONGS_RE.finditer(verse_text)):
        raw = verse_text[last_end : m.start()].strip()
        english = _clean_english(raw) if raw else None
        words.append((pos, english, m.group(1)))
        last_end = m.end()

    return words


def parse_text(text: str) -> list:
    """Return list of (book, chapter, verse, words) for the whole text."""
    results = []
    for m in VERSE_RE.finditer(text):
        book    = m.group(1)
        chapter = int(m.group(2))
        verse   = int(m.group(3))
        words   = parse_words(m.group(4).strip())
        if words:
            results.append((book, chapter, verse, words))
    return results


SCHEMA = """
CREATE TABLE IF NOT EXISTS verses (
    id      INTEGER PRIMARY KEY,
    book    TEXT    NOT NULL,
    chapter INTEGER NOT NULL,
    verse   INTEGER NOT NULL,
    UNIQUE (book, chapter, verse)
);

-- Each row is one Strong's entry within a verse.
-- position is the left-to-right order of the English gloss in the verse.
-- english is NULL for bare G#### tokens (Greek words with no English gloss shown).
-- strongs uses the ABP numbering: plain integers or dotted extensions like 1510.7.3.
--   '*' means proper noun without a numbered entry.
-- strongs_base strips dotted extensions (1510.7.3 -> 1510) for standard lookups.
-- english_head is the last non-function word of the gloss — the primary search token.
CREATE TABLE IF NOT EXISTS words (
    id           INTEGER PRIMARY KEY,
    verse_id     INTEGER NOT NULL REFERENCES verses(id),
    position     INTEGER NOT NULL,
    english      TEXT,
    english_head TEXT,
    strongs      TEXT    NOT NULL,
    strongs_base TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_words_verse        ON words(verse_id);
CREATE INDEX IF NOT EXISTS idx_words_strongs      ON words(strongs);
CREATE INDEX IF NOT EXISTS idx_words_strongs_base ON words(strongs_base);
CREATE INDEX IF NOT EXISTS idx_words_english      ON words(english COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_words_english_head ON words(english_head COLLATE NOCASE);
"""


def build_database(db_path: str, parsed: list) -> None:
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)

    c = conn.cursor()
    for book, chapter, verse, words in parsed:
        c.execute(
            "INSERT OR IGNORE INTO verses (book, chapter, verse) VALUES (?,?,?)",
            (book, chapter, verse),
        )
        verse_id = c.execute(
            "SELECT id FROM verses WHERE book=? AND chapter=? AND verse=?",
            (book, chapter, verse),
        ).fetchone()[0]

        c.executemany(
            "INSERT INTO words (verse_id, position, english, english_head, strongs, strongs_base) VALUES (?,?,?,?,?,?)",
            [(verse_id, pos, eng, _head_word(eng), st, st.split(".")[0]) for pos, eng, st in words],
        )

    conn.commit()
    conn.close()


def main() -> None:
    src     = sys.argv[1] if len(sys.argv) > 1 else "-"
    db_path = sys.argv[2] if len(sys.argv) > 2 else "bible.db"

    text = sys.stdin.read() if src == "-" else Path(src).read_text(encoding="utf-8")

    print("Parsing…", file=sys.stderr)
    parsed = parse_text(text)
    print(f"  Found {len(parsed)} verses", file=sys.stderr)

    build_database(db_path, parsed)

    conn = sqlite3.connect(db_path)
    n_verses = conn.execute("SELECT COUNT(*) FROM verses").fetchone()[0]
    n_words  = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
    conn.close()

    print(f"  {n_verses:,} verses, {n_words:,} word entries → {db_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
