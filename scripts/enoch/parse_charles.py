#!/usr/bin/env python3
"""Parse the cached Charles 1917 'Book of Enoch' wikitext (raw/_all_wikitext.json)
into enoch_english.json {"chap.verse": text} + enoch_headings.json (5 sections) +
an empty enoch_tagged_full.json (no Greek interlinear in this English-only load).

Readable-text choices (words are Charles' verbatim — only presentation marks change):
  * Charles' corner-brackets ⌈ ⌉ (doubtful/restored words) and daggers † (corrupt
    text) are dropped — they're scholarly apparatus glyphs, noise for a reader.
  * Parentheses ( ) and square brackets [ ] are KEPT as Charles printed them.
  * Letter sub-verses (6a, 6b…) are merged into their integer verse.
  * Each chunk is keyed by its OWN verse number, so Charles' few reordered verses
    (e.g. ch 106 prints 14, 17, 15, 16…) sort back into numeric order.
  * Parallel-column tables (Ethiopic | Greek/Latin) keep the first (English) column.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw" / "_all_wikitext.json"

# 5 major divisions of 1 Enoch — anchor heading on the first verse of each. These
# always win over Charles' finer section titles when they land on the same verse.
BIG5 = {
    "1.1":  "Book of the Watchers (1–36)",
    "37.1": "Book of Parables (37–71)",
    "72.1": "Astronomical Book (72–82)",
    "83.1": "Book of Dream Visions (83–90)",
    "91.1": "Epistle of Enoch (91–108)",
}

WIKI_HEADER = re.compile(r"^\s*=+\s*(.+?)\s*=+\s*$", re.M)
# a leading "reference span" = romans/digits + range/list punctuation, up to a '. '
# (e.g. 'XII-XVI. ', 'LIII—LIV. 6. ', 'XCIII, XCI. 12-17. '). Lowercase letters in a
# real title word (Dream-, Vision, Michael…) stop the match, so titles aren't eaten.
REF_PREFIX = re.compile(r"^([IVXLCDM\d][IVXLCDM\d.,\s–—-]*?)\.\s+")
REF_ONLY = re.compile(r"^[IVXLCDM\d.,\s–—-]+$")


def clean_heading(h):
    """Charles' titles read 'XII-XVI. Dream-Vision of Enoch…' — strip the leading
    chapter/verse range(s) and trailing period, keep the descriptive title."""
    h = h.strip()
    for g in "⌈⌉†":
        h = h.replace(g, "")
    while True:
        m = REF_PREFIX.match(h)
        if m and REF_ONLY.match(m.group(1)):
            h = h[m.end():]
        else:
            break
    return h.strip().rstrip(".").strip()


def harvest_headings(allc):
    """Charles' own '=== … ===' section titles become pericopes, attached to the
    verse they precede. Skips the redundant 'Section N / Introduction' lines (the
    5 big divisions are covered by BIG5)."""
    headings = dict(BIG5)
    for ch in sorted(allc, key=int):
        t = allc[ch]
        for m in WIKI_HEADER.finditer(t):
            title = m.group(1)
            if re.match(r"^(Section|Introduction)\b", title):
                continue
            nxt = re.search(r"(\d{1,3})\.\s", t[m.end():])   # first verse after the title
            if not nxt:
                continue
            cleaned = clean_heading(title)
            if not cleaned:
                continue
            key = f"{ch}.{int(nxt.group(1))}"
            if key in BIG5:                 # never override a big-division anchor
                continue
            headings[key] = (headings[key] + " — " + cleaned) if key in headings else cleaned
    return headings

VERSE_MARK = re.compile(r"(?:(?<=\s)|^)(\d{1,3})([a-z]?)\.(?=\s)")


_VNUMS = re.compile(r"(?:(?<=\s)|^)(\d{1,3})[a-z]?\.(?=\s)")


def process_table(table_block):
    """Reduce a wikitable to readable English. Column 1 is always Charles' main
    (Ethiopic) text. Column 2 is kept ONLY when it carries NEW verse numbers — i.e.
    ch 90's English 'doublet' verses (16–18) — and dropped when it's a same-numbered
    variant reading or a Greek/Latin apparatus column (ch 22, 89, 106)."""
    rows = []
    for row in re.split(r"\n\|-", table_block):
        row = row.replace("|}", "").strip()
        row = re.sub(r"^\{\|[^\n]*", "", row).strip()   # drop the "{| class=…" opener
        if not row or row.startswith("!"):              # header row
            continue
        row = re.sub(r"^\|", "", row)                   # drop leading cell pipe
        rows.append([c.strip() for c in row.split("||")])
    col1 = " ".join(r[0] for r in rows if r)
    col2 = " ".join(r[1] for r in rows if len(r) > 1)
    n1 = set(_VNUMS.findall(col1))
    n2 = set(_VNUMS.findall(col2))
    has_greek = re.search(r"[Ͱ-Ͽἀ-῿]", col2)
    real_verses = n2 and all(int(x) <= 120 for x in n2)   # excludes stray page-citation numbers
    if col2 and not has_greek and real_verses and not (n2 & n1):
        return col1 + " " + col2          # ch 90's English 'doublet' verses
    return col1                           # Greek/Latin apparatus or same-numbered variant


def clean_chapter(t):
    t = re.sub(r"^\{\{header.*?\}\}", "", t, flags=re.S)   # drop the page header template
    t = re.sub(r"\{\|.*?\|\}", lambda m: process_table(m.group(0)), t, flags=re.S)
    keep = []
    for ln in t.split("\n"):
        s = ln.strip()
        if s.startswith("=") or re.match(r"^CHAPTER\b", s):
            continue
        keep.append(ln)
    t = "\n".join(keep)
    t = re.sub(r"\[\[[^\]]*\]\]", "", t)     # any stray wiki links
    t = re.sub(r"\{\{[^}]*\}\}", "", t)      # any stray templates
    t = re.sub(r"'''+|''", "", t)            # bold / italic markup
    t = re.sub(r"<[^>]+>", " ", t)           # html tags
    for g in "⌈⌉†‡":
        t = t.replace(g, "")
    return t


def split_verses(body):
    verses, order = {}, []
    parts = VERSE_MARK.split(body)
    # parts = [pre, num, letter, text, num, letter, text, ...]
    for num, _letter, text in zip(parts[1::3], parts[2::3], parts[3::3]):
        v = int(num)
        seg = re.sub(r"\s+", " ", text).strip()
        if not seg:
            continue
        if v in verses:
            verses[v] += " " + seg
        else:
            verses[v] = seg
            order.append(v)
    return verses


def main():
    allc = json.loads(RAW.read_text(encoding="utf-8"))
    english = {}
    report = []
    for n in sorted(allc, key=int):
        verses = split_verses(clean_chapter(allc[n]))
        nums = sorted(verses)
        gaps = [v for v in range(1, (max(nums) if nums else 0) + 1) if v not in verses]
        report.append((int(n), len(nums), max(nums) if nums else 0, gaps))
        for v in nums:
            english[f"{n}.{v}"] = verses[v]

    headings = harvest_headings(allc)
    # keep only headings that land on a real verse we actually have
    headings = {k: v for k, v in headings.items() if k in english}

    out_en = HERE / "enoch_english.json"
    out_en.write_text(json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "enoch_headings.json").write_text(
        json.dumps(headings, ensure_ascii=False, indent=2), encoding="utf-8")
    (HERE / "enoch_tagged_full.json").write_text("[]", encoding="utf-8")

    total = len(english)
    print(f"wrote enoch_english.json: {total} verses across {len(report)} chapters")
    print(f"wrote enoch_headings.json: {len(headings)} headings (5 big + Charles' sections); "
          f"enoch_tagged_full.json: [] (English-only)")
    flagged = [r for r in report if r[3]]
    if flagged:
        print(f"\nCHAPTERS WITH VERSE-NUMBER GAPS ({len(flagged)}) — review:")
        for n, cnt, mx, gaps in flagged:
            print(f"  ch {n}: {cnt} verses, max {mx}, missing {gaps}")
    else:
        print("\nno verse-number gaps — every chapter is contiguous 1..max")


if __name__ == "__main__":
    main()
