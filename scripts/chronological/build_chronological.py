#!/usr/bin/env python3
"""
Build the chronological reading list the Library uses for "Chronological" order.

INPUT  (both in this folder):
  - source_oneyear.txt  : the passage sequence in event order, with "# ERA:" headers.
  - verse_counts.json   : per-chapter verse counts (facts only) for clean labels.
OUTPUT:
  - ../../static/chronological.json : { eras:[...], passages:[...] } the browser loads.

The passages are just pointers (book + verse range) into the reader's existing
ABP/KJV/BSB text — no Bible text is copied here. Run locally; it never touches
bible.db. Re-run after editing source_oneyear.txt:  python build_chronological.py
"""
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source_oneyear.txt")
COUNTS = os.path.join(HERE, "verse_counts.json")
OUT = os.path.join(HERE, "..", "..", "static", "chronological.json")

EN_DASH = "–"

# Full book name (normalized: lowercased, spaces/dots stripped) -> the app's book code
# (the same codes the verses tables and 00-core.jsx use, e.g. Mark -> "Mar").
NAME_TO_CODE = {
    "genesis": "Gen", "exodus": "Exo", "leviticus": "Lev", "numbers": "Num",
    "deuteronomy": "Deu", "joshua": "Jos", "judges": "Jdg", "ruth": "Rth",
    "1samuel": "1Sa", "2samuel": "2Sa", "1kings": "1Ki", "2kings": "2Ki",
    "1chronicles": "1Ch", "2chronicles": "2Ch", "ezra": "Ezr", "nehemiah": "Neh",
    "esther": "Est", "job": "Job", "psalm": "Psa", "psalms": "Psa",
    "proverbs": "Pro", "ecclesiastes": "Ecc",
    "songofsolomon": "Son", "songofsongs": "Son", "song": "Son",
    "isaiah": "Isa", "jeremiah": "Jer", "lamentations": "Lam", "ezekiel": "Eze",
    "daniel": "Dan", "hosea": "Hos", "joel": "Joe", "amos": "Amo", "obadiah": "Oba",
    "jonah": "Jon", "micah": "Mic", "nahum": "Nah", "habakkuk": "Hab",
    "zephaniah": "Zep", "haggai": "Hag", "zechariah": "Zec", "malachi": "Mal",
    "matthew": "Mat", "mark": "Mar", "luke": "Luk", "john": "Joh", "acts": "Act",
    "romans": "Rom", "1corinthians": "1Co", "2corinthians": "2Co",
    "galatians": "Gal", "ephesians": "Eph", "philippians": "Php",
    "colossians": "Col", "1thessalonians": "1Th", "2thessalonians": "2Th",
    "1timothy": "1Ti", "2timothy": "2Ti", "titus": "Tit", "philemon": "Phm",
    "hebrews": "Heb", "james": "Jas", "1peter": "1Pe", "2peter": "2Pe",
    "1john": "1Jn", "2john": "2Jn", "3john": "3Jn", "jude": "Jud",
    "revelation": "Rev", "revelationofjohn": "Rev",
}

# App code -> the display name shown in labels (matches 00-core.jsx BOOK_LABELS).
CODE_TO_DISPLAY = {
    "Gen": "Genesis", "Exo": "Exodus", "Lev": "Leviticus", "Num": "Numbers",
    "Deu": "Deuteronomy", "Jos": "Joshua", "Jdg": "Judges", "Rth": "Ruth",
    "1Sa": "1 Samuel", "2Sa": "2 Samuel", "1Ki": "1 Kings", "2Ki": "2 Kings",
    "1Ch": "1 Chronicles", "2Ch": "2 Chronicles", "Ezr": "Ezra", "Neh": "Nehemiah",
    "Est": "Esther", "Job": "Job", "Psa": "Psalms", "Pro": "Proverbs",
    "Ecc": "Ecclesiastes", "Son": "Song of Solomon", "Isa": "Isaiah",
    "Jer": "Jeremiah", "Lam": "Lamentations", "Eze": "Ezekiel", "Dan": "Daniel",
    "Hos": "Hosea", "Joe": "Joel", "Amo": "Amos", "Oba": "Obadiah", "Jon": "Jonah",
    "Mic": "Micah", "Nah": "Nahum", "Hab": "Habakkuk", "Zep": "Zephaniah",
    "Hag": "Haggai", "Zec": "Zechariah", "Mal": "Malachi", "Mat": "Matthew",
    "Mar": "Mark", "Luk": "Luke", "Joh": "John", "Act": "Acts", "Rom": "Romans",
    "1Co": "1 Corinthians", "2Co": "2 Corinthians", "Gal": "Galatians",
    "Eph": "Ephesians", "Php": "Philippians", "Col": "Colossians",
    "1Th": "1 Thessalonians", "2Th": "2 Thessalonians", "1Ti": "1 Timothy",
    "2Ti": "2 Timothy", "Tit": "Titus", "Phm": "Philemon", "Heb": "Hebrews",
    "Jas": "James", "1Pe": "1 Peter", "2Pe": "2 Peter", "1Jn": "1 John",
    "2Jn": "2 John", "3Jn": "3 John", "Jud": "Jude", "Rev": "Revelation",
}


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    return re.sub(r"[\s.]", "", s).lower()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def load_counts():
    """app code -> { chapter:int -> verse count:int }."""
    with open(COUNTS, encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for b in data:
        code = NAME_TO_CODE.get(norm(b["book"]))
        if not code:
            continue
        out[code] = {int(c["chapter"]): int(c["verses"]) for c in b["chapters"]}
    return out


_REF_RE = re.compile(r"^(.*?)\s+(\d+(?::\d+)?(?:\s*-\s*\d+(?::\d+)?)?)\s*$")


def parse_point(s):
    if ":" in s:
        c, v = s.split(":")
        return int(c), int(v)
    return int(s), None


def parse_passage(line, counts):
    m = _REF_RE.match(line)
    if not m:
        raise ValueError("can't parse passage: %r" % line)
    code = NAME_TO_CODE.get(norm(m.group(1)))
    if not code:
        raise ValueError("unknown book: %r" % line)
    cc = counts.get(code, {})
    ref = m.group(2).replace(" ", "")
    left, _, right = ref.partition("-")
    lc, lv = parse_point(left)
    start_c, start_v = lc, (lv if lv is not None else 1)

    if not right:                       # single point
        if lv is None:                  # whole chapter "C"
            end_c, end_v = lc, cc.get(lc)
        else:                           # single verse "C:V"
            end_c, end_v = lc, lv
    elif ":" in right:                  # "C:V"
        end_c, end_v = parse_point(right)
    elif lv is None:                    # whole-chapter range "C-D"
        end_c = int(right)
        end_v = cc.get(end_c)
        start_v = 1
    else:                               # same-chapter verse range "C:V-W"
        end_c, end_v = lc, int(right)

    return code, start_c, start_v, end_c, end_v


def make_label(code, sc, sv, ec, ev, counts):
    name = CODE_TO_DISPLAY.get(code, code)
    # A single whole psalm reads "Psalm 90" (singular); a span stays "Psalms 4–6".
    if code == "Psa" and sc == ec:
        name = "Psalm"
    end_count = counts.get(code, {}).get(ec)
    whole = (sv == 1 and end_count is not None and ev == end_count)
    if whole:
        return name + (f" {sc}" if sc == ec else f" {sc}{EN_DASH}{ec}")
    if sc == ec:
        return f"{name} {sc}:{sv}{EN_DASH}{ev}"
    return f"{name} {sc}:{sv}{EN_DASH}{ec}:{ev}"


def main():
    counts = load_counts()
    eras, passages = [], []
    cur_era = None
    pos = 0
    warnings = []

    with open(SRC, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            if line.startswith("# ERA:"):
                body = line[len("# ERA:"):].strip()
                name, _, blurb = body.partition("|")
                name, blurb = name.strip(), blurb.strip()
                cur_era = slug(name)
                eras.append({"id": cur_era, "name": name, "blurb": blurb})
                continue
            if line.startswith("#"):
                continue
            try:
                code, sc, sv, ec, ev = parse_passage(line, counts)
            except ValueError as e:
                warnings.append(str(e))
                continue
            pos += 1
            passages.append({
                "pos": pos, "era": cur_era, "book": code,
                "label": make_label(code, sc, sv, ec, ev, counts),
                "start_ch": sc, "start_v": sv, "end_ch": ec, "end_v": ev,
            })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"eras": eras, "passages": passages}, f,
                  ensure_ascii=False, indent=0)

    print(f"eras: {len(eras)}  passages: {len(passages)}")
    print(f"wrote {os.path.relpath(OUT, HERE)}")
    for w in warnings:
        print("  WARN:", w)
    return 1 if warnings else 0


if __name__ == "__main__":
    sys.exit(main())
