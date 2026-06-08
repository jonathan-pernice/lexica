#!/usr/bin/env python3
"""Parse the Sibylline Oracles (Milton S. Terry, 2nd ed. 1899, English blank verse) into
sibylline_english.json {"book.line": text} + sibylline_headings.json + empty tagged file.

Source: raw/sib_book<N>.html — the Wikisource proofread transcription of Terry's edition
(public domain). The collection's manuscripts number the books 1-8 and 11-14 (there is no
Book 9 or 10), and each is cited by BOOK and LINE, so we model chapter = book, verse =
Terry's running line number. Wikisource's structured markup makes this exact:
  * <span class="ws-poem-line"> ... </span>      = one verse line;
  * <span class="ws-poem-versenum">N </span>     = Terry's marginal line number (every 5th
    line) -- it anchors the running line count;
  * <sup class="reference"> ... </sup>            = footnote markers, dropped;
  * <div class="wst-chapter-summary-list"><li>Title, START-END.</li> = the per-book
    "argument", harvested as section headings keyed to each section's START line.
Books 9 and 10 get a one-line note explaining they are not part of the collection.
"""
import html
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
BOOKS = [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14]
DASH = r"[\-–—]"

VERSENUM = re.compile(r'<span class="ws-poem-versenum">\s*(\d+)[^<]*</span>')
BREAK = re.compile(r'(?is)<span class="ws-poem-break">.*?</span>')
SUP = re.compile(r"(?is)<sup\b.*?</sup>")
TAG = re.compile(r"<[^>]+>")


def clean(s):
    s = s.replace("​", "").replace(" ", " ").replace(" ", " ").replace(" ", " ")
    s = re.sub(r"\[\s*\d+\s*\]", " ", s)        # any leftover footnote brackets
    s = s.replace("[", "").replace("]", "")
    s = re.sub(r"\s+([,.;:])", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_book(raw, book):
    english, headings = {}, {}

    # headings from the chapter-summary "argument" list
    am = re.search(r'(?is)<div class="wst-chapter-summary-list">(.*?)</div>', raw)
    if am:
        for it in re.findall(r"(?is)<li>(.*?)</li>", am.group(1)):
            it = clean(html.unescape(TAG.sub(" ", it)))
            mh = re.match(rf"^(.*?),\s*(\d+)\s*{DASH}\s*\d+\.?$", it)
            if mh:
                headings.setdefault(f"{book}.{int(mh.group(2))}", mh.group(1).strip())

    # poem body: from the first verse line to the footnotes (back up to the '<' that
    # opens the reflist div so its tag can't dangle into the last line)
    s = raw.find('<span class="ws-poem-line">')
    ref = raw.find('class="reflist', s)
    e = raw.rfind("<", s, ref) if ref > 0 else len(raw)
    region = raw[s:e]
    region = re.sub(r"(?is)<(style|script)[^>]*>.*?</\1>", " ", region)
    region = SUP.sub("", region)
    region = VERSENUM.sub(r" @@LN\1@@ ", region)
    region = BREAK.sub("\n", region)
    region = html.unescape(TAG.sub("", region)).replace("​", "")

    ln = 0
    for chunk in region.split("\n"):
        m = re.match(r"\s*@@LN(\d+)@@\s*(.*)", chunk, re.S)
        if m:
            ln, text = int(m.group(1)), m.group(2)
        else:
            text = chunk
            if clean(text):
                ln += 1
        text = clean(text)
        if text:
            english.setdefault(f"{book}.{ln}", text)

    headings = {k: t for k, t in headings.items() if k in english}
    return english, headings


def main():
    english, headings = {}, {}
    per_book = []
    for b in BOOKS:
        raw = (HERE / "raw" / f"sib_book{b}.html").read_text(encoding="utf-8", errors="replace")
        be, bh = parse_book(raw, b)
        english.update(be)
        headings.update(bh)
        lns = sorted(int(k.split(".")[1]) for k in be)
        per_book.append((b, len(be), lns[-1] if lns else 0, len(bh)))

    note = "(There is no Book {n} of the Sibylline Oracles: the manuscript tradition numbers the collection 1–8 and 11–14.)"
    for b in (9, 10):
        english[f"{b}.1"] = note.format(n=b)

    (HERE / "sibylline_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "sibylline_headings.json").write_text(
        json.dumps(headings, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "sibylline_tagged_full.json").write_text("[]", encoding="utf-8")

    total = sum(n for _, n, _, _ in per_book)
    print(f"Sibylline Oracles: wrote {total} lines across {len(BOOKS)} books + 9/10 notes; "
          f"{len(headings)} headings")
    for b, n, mx, nh in per_book:
        lns = sorted(int(k.split(".")[1]) for k in english if k.startswith(f"{b}."))
        gaps = [x for x in range(1, mx + 1) if x not in lns]
        flag = f"  GAPS {len(gaps)} (e.g. {gaps[:8]})" if gaps else ""
        print(f"  Book {b:>2}: {n:>4} lines (1..{mx}), {nh} headings{flag}")


if __name__ == "__main__":
    main()
