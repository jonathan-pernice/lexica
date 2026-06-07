#!/usr/bin/env python3
"""Parse a USFM book file (e.g. ebible.org's public-domain Brenton Septuagint) into the
generic loader's inputs: <book>_english.json {"ch.vs": text}, an empty <book>_headings.json,
and an empty <book>_tagged_full.json (English-only loads).

USFM is uniform and verse-perfect: \\c N starts a chapter, \\v N starts a verse, verse text
runs until the next \\v / \\c. Inline markers are cleaned: footnotes (\\f .. \\f*) and cross
references (\\x .. \\x*) are dropped; character markers (\\add, \\nd, \\wj, \\w ..) keep their
content; section headers (\\s) are harvested as headings.

Usage:
    python parse_usfm.py <book_id> <path/to/file.usfm>
Writes <book_id>_english.json, <book_id>_headings.json, <book_id>_tagged_full.json here.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent

NOTE = re.compile(r"\\(f|x|fe)\b.*?\\\1\*", re.S)   # drop footnotes / cross-refs entirely
CHARTAG = re.compile(r"\\\+?[a-z0-9]+\*?")            # any remaining \marker or \marker*
WS = re.compile(r"\s+")


def clean_inline(t):
    t = NOTE.sub(" ", t)
    t = CHARTAG.sub(" ", t)        # strip \add \add* \nd \wj \w ... leaving their text
    t = t.replace("|", " ")        # \w word|strong="..."\w* leftovers
    t = WS.sub(" ", t)
    return t.strip()


def parse(book, usfm_path):
    lines = Path(usfm_path).read_text(encoding="utf-8").splitlines()
    english, headings = {}, {}
    ch = None
    vnum = None
    buf = []
    pending_heading = None
    bridged = set()      # (ch) that use letter sub-verses (7a, 7b..) -> non-standard numbering
    subverses = 0

    def flush_verse():
        nonlocal buf, vnum
        if ch is not None and vnum is not None:
            seg = clean_inline(" ".join(buf))
            if seg:
                key = f"{ch}.{vnum}"
                english[key] = (english[key] + " " + seg) if key in english else seg
        buf = []

    for ln in lines:
        ln = ln.rstrip("\n")
        m = re.match(r"\\c\s+(\d+)", ln)
        if m:
            flush_verse()
            ch, vnum = int(m.group(1)), None
            continue
        m = re.match(r"\\v\s+(\d+)([a-z]?)\s?(.*)", ln)
        if m:
            flush_verse()
            vnum = int(m.group(1))
            if m.group(2):                      # letter sub-verse (7a, 7b..) -> fold into 7
                subverses += 1
                if ch is not None:
                    bridged.add(ch)
            buf = [m.group(3)]
            if pending_heading and ch is not None:
                headings[f"{ch}.{vnum}"] = pending_heading
                pending_heading = None
            continue
        m = re.match(r"\\s\d*\s+(.*)", ln)     # section heading -> attach to next verse
        if m:
            h = clean_inline(m.group(1))
            if h:
                pending_heading = h
            continue
        if re.match(r"\\(id|ide|h|toc|mt|ms|mr|imt|is|ip|rem|usfm|sts)\b", ln):
            continue                            # book front-matter / titles -> skip
        if vnum is not None:                    # continuation line of the current verse
            buf.append(ln)
    flush_verse()
    return english, headings, bridged, subverses


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: parse_usfm.py <book_id> <file.usfm>")
    book, usfm_path = sys.argv[1], sys.argv[2]
    english, headings, bridged, subverses = parse(book, usfm_path)

    (HERE / f"{book}_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{book}_headings.json").write_text(
        json.dumps(headings, ensure_ascii=False, indent=2), encoding="utf-8")
    (HERE / f"{book}_tagged_full.json").write_text("[]", encoding="utf-8")

    chs = sorted({int(k.split(".")[0]) for k in english})
    # report any chapter whose verses aren't a clean 1..max run
    issues = []
    for c in chs:
        if c in bridged:           # Brenton's letter sub-verses make integers non-contiguous by design
            continue
        vs = sorted(int(k.split(".")[1]) for k in english if int(k.split(".")[0]) == c)
        gaps = [v for v in range(1, max(vs) + 1) if v not in vs]
        if gaps:
            issues.append((c, len(vs), max(vs), gaps))
    print(f"{book}: wrote {len(english)} verses across {len(chs)} chapters "
          f"({min(chs)}..{max(chs)}); {len(headings)} headings")
    if subverses:
        print(f"  ({subverses} letter sub-verses folded into their integer verse, like 1 Enoch; "
              f"{len(bridged)} chapters affected -- faithful to Brenton)")
    if issues:
        print(f"REVIEW ({len(issues)} chapters with true verse gaps):")
        for c, n, mx, gaps in issues:
            print(f"  ch {c}: {n} verses, max {mx} -- missing {gaps}")
    else:
        print("clean: every standard-numbered chapter contiguous 1..max")


if __name__ == "__main__":
    main()
