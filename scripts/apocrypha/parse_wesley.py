#!/usr/bin/env python3
"""Parse a Wesley Center Online (wesley.nnu.edu) non-canonical text page into the
generic loader's inputs: <book>_english.json {"ch.vs": text}, <book>_headings.json,
and an empty <book>_tagged_full.json (these are English-only loads).

The Wesley pages share one CMS layout:
  * the book body runs from the first "[Chapter N]" marker to the "<!-- Text: [end] -->"
    comment (everything before/after is site nav + the scholarly introduction);
  * chapters are flagged inline as "[Chapter N]";
  * verses are BARE inline integers surrounded by whitespace (no trailing period) —
    Charles' verse splits often fall mid-sentence, exactly as printed;
  * Charles' editorial dates are bracketed and START WITH A DIGIT ("[2450 Anno Mundi]")
    -> dropped as scholarly apparatus; restoration brackets START WITH A LETTER
    ("Sin[ai]") -> kept, brackets stripped, letters retained.

Readable-text choices mirror scripts/enoch/parse_charles.py: words are Charles'
verbatim, only presentation noise is removed.

Usage:
    python parse_wesley.py <book_id> [raw/<book_id>.html]
Writes <book_id>_english.json, <book_id>_headings.json, <book_id>_tagged_full.json
next to this script.
"""
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent

TAG = re.compile(r"<[^>]+>")
CHAP = re.compile(r"\[Chapter\s+(\d+)\]")
# a bare verse number: integer (1-3 digits) bounded by whitespace, NOT inside a word
VERSE_MARK = re.compile(r"(?:(?<=\s)|^)(\d{1,3})(?=\s)")
# editorial bracket = opens with a digit (date / AM count); restoration opens with a letter
DIGIT_BRACKET = re.compile(r"\[\d[^\]]*\]")
LETTER_BRACKET = re.compile(r"\[([A-Za-z][^\]]*)\]")
END_MARK = "<!--  Text: [end] -->"


def pre_clean(t):
    """Strip tags/entities and editorial apparatus BEFORE verse-splitting, so that a
    verse number sitting right after '&nbsp;' or a tag (and the '[NN A.M.]' dates that
    would otherwise look like a 2-digit verse) don't corrupt the split."""
    t = TAG.sub(" ", t)                 # strip html tags
    t = html.unescape(t)                # &nbsp; &amp; etc.
    t = t.replace("\xa0", " ")
    t = DIGIT_BRACKET.sub(" ", t)       # drop "[2450 Anno Mundi]" editorial dates
    t = LETTER_BRACKET.sub(r"\1", t)    # "Sin[ai]" -> "Sinai"
    t = re.sub(r"\s+", " ", t)
    return t.strip()


NUMTOK = re.compile(r"^(\d{1,3}),?$")
GAP_TOL = 6   # accept a forward jump up to this many verses (the scan drops some markers)


def split_verses(body):
    """Verse-splitter robust to Charles' real prose numbers and his dropped/combined
    markers. A bare integer is the next verse marker only when it is STRICTLY GREATER
    than the last accepted verse and within GAP_TOL of it — so a measurement like '203
    bricks' (far above the current verse) stays in the prose, while a genuine 2-3 verse
    gap from a dropped marker (11 -> 14) is still followed. Adjacent same-step numbers
    with no words between them are Charles' combined markers ('10, 11' / '18, 19'): the
    text rides on the first and the rest are returned in `combined` (expected, not gaps).
    Returns (verses{n:text}, order[], combined[])."""
    body = pre_clean(body)
    toks = body.split()
    verses, order, combined = {}, [], []
    cur, buf, last = None, [], 0

    def flush():
        if cur is None:
            return
        seg = " ".join(buf).strip()
        if not seg:
            return
        if cur in verses:
            verses[cur] += " " + seg
        else:
            verses[cur] = seg
            order.append(cur)

    i, n = 0, len(toks)
    while i < n:
        m = NUMTOK.match(toks[i])
        val = int(m.group(1)) if m else None
        if val is not None and last < val <= last + GAP_TOL:
            flush()
            cur, buf, last = val, [], val
            # fold combined markers: immediately-following numbers (no words between)
            j = i + 1
            while j < n:
                m2 = NUMTOK.match(toks[j])
                if m2 and int(m2.group(1)) == last + 1:
                    last += 1
                    combined.append(last)
                    j += 1
                else:
                    break
            i = j
            continue
        buf.append(toks[i])
        i += 1
    flush()
    return verses, order, combined


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: parse_wesley.py <book_id> [raw/<book_id>.html]")
    book = sys.argv[1]
    raw_path = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "raw" / f"{book}.html"
    raw = raw_path.read_text(encoding="utf-8")

    start = raw.find("[Chapter 1]")
    if start < 0:
        sys.exit("no '[Chapter 1]' marker found")
    end = raw.find(END_MARK)
    body = raw[start:end if end > 0 else len(raw)]

    # split into chapters by the [Chapter N] markers
    pieces = CHAP.split(body)           # [pre, '1', text1, '2', text2, ...]
    english = {}
    report = []
    for cnum, ctext in zip(pieces[1::2], pieces[2::2]):
        ch = int(cnum)
        verses, order, combined = split_verses(ctext)
        nums = sorted(verses)
        mx = max(nums + combined) if (nums or combined) else 0
        cset = set(combined)
        gaps = [v for v in range(1, mx + 1) if v not in verses and v not in cset]
        ooo = order != sorted(order)   # out-of-order numbers => probable false split
        report.append((ch, len(nums), mx, gaps, ooo, combined))
        for v in nums:
            english[f"{ch}.{v}"] = verses[v]

    (HERE / f"{book}_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{book}_headings.json").write_text("{}", encoding="utf-8")
    (HERE / f"{book}_tagged_full.json").write_text("[]", encoding="utf-8")

    total = len(english)
    chs = [r[0] for r in report]
    print(f"{book}: wrote {total} verses across {len(report)} chapters "
          f"({min(chs)}..{max(chs)})")
    ncomb = sum(len(r[5]) for r in report)
    if ncomb:
        print(f"  ({ncomb} verses folded into Charles' combined 'N, M' markers -- expected, not gaps)")
    flagged = [r for r in report if r[3] or r[4]]
    if flagged:
        print(f"REVIEW ({len(flagged)} chapters with true gaps or out-of-order numbers):")
        for ch, cnt, mx, gaps, ooo, combined in flagged:
            note = []
            if gaps:
                note.append(f"missing {gaps}")
            if ooo:
                note.append("OUT-OF-ORDER")
            print(f"  ch {ch}: {cnt} verses, max {mx} -- {'; '.join(note)}")
    else:
        print("clean: every chapter contiguous 1..max (combined markers aside), in order")


if __name__ == "__main__":
    main()
