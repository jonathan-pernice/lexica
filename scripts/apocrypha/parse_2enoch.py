#!/usr/bin/env python3
"""Parse 2 Enoch (Slavonic Enoch / Secrets of Enoch, W.R. Morfill translation) into
enochs2_english.json {"ch.vs": text} + empty headings/tagged files.

Source: raw/p_2enoch.html (pseudepigrapha.com). Layout after tag-strip:
  * a table-of-contents block of bare numbers "01".."68" at the top -> skipped (we
    start at the first "Chapter 1, I" marker).
  * "Chapter N, ROMAN"  -> chapter start.
  * "V text..."         -> verse V on the SAME line (number then a space then text);
    a line with no leading number is a continuation of the current verse.
  * "Translated from the Slavonic ..." -> credits, end of text -> stop.

The source file has literal U+FFFD replacement characters where the original Word
export's apostrophes were lost (Lord<FFFD>s -> Lord's); these are restored to ' .
Inline tags (the <A> glossary links) are stripped to nothing so "Lord</A>'s" reads
"Lord's"; only block tags become line breaks.
"""
import html as _h
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw" / "p_2enoch.html"
OUT = "enoch2"

CHAP = re.compile(r"^Chapter\s+(\d+)\b")
VERSE = re.compile(r"^(\d{1,3})\s+(.*)$")
BLOCK = re.compile(r"(?is)</?(p|br|div|td|tr|table|h\d|li)[^>]*>")


def to_lines(raw):
    raw = raw.replace("�", "'")                       # restore lost apostrophes
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    raw = BLOCK.sub("\n", raw)                              # block tags -> line breaks
    raw = re.sub(r"<[^>]+>", "", raw)                       # inline tags -> nothing
    raw = _h.unescape(raw)
    out = []
    for l in raw.splitlines():
        l = re.sub(r"[ \t\xa0]+", " ", l).strip()
        if l:
            out.append(l)
    return out


def main():
    lines = to_lines(RAW.read_text(encoding="utf-8"))
    start = next(i for i, l in enumerate(lines) if re.match(r"^Chapter 1\b", l))

    english = {}
    ch = v = None
    buf = []

    def flush():
        if ch is not None and v is not None:
            seg = re.sub(r"\s+", " ", " ".join(buf)).strip()
            if seg:
                english[f"{ch}.{v}"] = seg

    for l in lines[start:]:
        if l.startswith("Translated from") or l.startswith("Further corrected"):
            break
        mc = CHAP.match(l)
        if mc:
            flush()
            ch, v, buf = int(mc.group(1)), None, []
            continue
        mv = VERSE.match(l)
        if mv:
            flush()
            v, buf = int(mv.group(1)), [mv.group(2)]
            continue
        if v is not None:
            buf.append(l)
    flush()

    (HERE / f"{OUT}_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{OUT}_headings.json").write_text("{}", encoding="utf-8")
    (HERE / f"{OUT}_tagged_full.json").write_text("[]", encoding="utf-8")

    chs = sorted({int(k.split('.')[0]) for k in english})
    print(f"2 Enoch: wrote {len(english)} verses across {len(chs)} chapters "
          f"({min(chs)}..{max(chs)})")
    gaps = [c for c in range(min(chs), max(chs) + 1) if c not in chs]
    print("MISSING chapters:", gaps if gaps else "none")
    report = []
    for c in chs:
        vs = sorted(int(k.split('.')[1]) for k in english if int(k.split('.')[0]) == c)
        miss = [x for x in range(1, max(vs) + 1) if x not in vs]
        if miss:
            report.append((c, max(vs), miss))
    if report:
        print(f"REVIEW ({len(report)} chapters with verse gaps):")
        for c, mx, miss in report:
            print(f"  ch {c}: max {mx} -- missing {miss}")
    else:
        print("clean: every chapter contiguous 1..max")


if __name__ == "__main__":
    main()
