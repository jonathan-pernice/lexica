#!/usr/bin/env python3
"""Parse 2 Baruch (Syriac Apocalypse of Baruch, R.H. Charles 1913) into
baruch2_english.json {"ch.vs": text} + empty headings/tagged files.

Source: raw/p_2baruch.html — the pseudepigrapha.com copy of the SAME Wesley Center /
Charles edition the rest of the apocrypha use, but with CLEAN markers (the plain
raw/baruch2.html Wesley page carries chapter numbers only inside its section
headings, so 10 chapters that fall mid-range have no body marker at all and can't be
bounded from it — this copy fixes that). Layout, one item per line after tag-strip:
  * "Chapter N"               -> chapter start
  * a bare integer "V"        -> verse marker; following lines are that verse's text
  * "1-4. Announcement ..."   -> section heading (digits, then '. Title') -> dropped
  * "finish"                  -> end of text (footer/credits follow) -> stop
Charles' editorial brackets are unwrapped (kept words, dropped the [ ]); his bracketed
dates are dropped — same treatment parse_wesley gives the other apocrypha.
"""
import html as _h
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw" / "p_2baruch.html"

CHAP = re.compile(r"^Chapter\s+(\d+)$")
VNUM = re.compile(r"^(\d{1,3})$")
# "1a", "11a" — sub-verse markers of the interleaved Oxyrhynchus Greek-fragment
# parallel in chapters 12-14 ("Chapter 12a/13a/14a"). The plain numeric verses are
# Charles' main text; these lettered alternates are dropped (we ship one text).
ALT = re.compile(r"^\d{1,3}[a-z]$")
# section heading: a reference (digits, ':', ',', '-', spaces) then '.' then a Title word
HEADING = re.compile(r"^\d[\d:,\-–—\s]*\.\s+[A-Z]")
DIGIT_BRACKET = re.compile(r"\[\d[^\]]*\]")     # editorial date -> drop
LETTER_BRACKET = re.compile(r"\[")              # restoration bracket -> just drop the marks


def to_lines(raw):
    t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    t = re.sub(r"(?is)<br[^>]*>", "\n", t)
    t = re.sub(r"(?is)<p[^>]*>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = _h.unescape(t)
    out = []
    for l in t.splitlines():
        l = re.sub(r"[ \t\xa0]+", " ", l).strip()
        if l:
            out.append(l)
    return out


def clean(text):
    text = DIGIT_BRACKET.sub(" ", text)
    text = text.replace("[", "").replace("]", "")
    return re.sub(r"\s+", " ", text).strip()


def main():
    lines = to_lines(RAW.read_text(encoding="utf-8", errors="replace"))
    start = next(i for i, l in enumerate(lines) if l == "Chapter 1")
    # the chapter-1 section title sits just before the "Chapter 1" marker -> include it
    if start and HEADING.match(lines[start - 1]):
        start -= 1

    english = {}
    headings = {}
    ch = v = None
    buf = []

    def flush():
        if ch is not None and v is not None:
            seg = clean(" ".join(buf))
            if seg:
                english[f"{ch}.{v}"] = seg

    for l in lines[start:]:
        if l == "finish":
            break
        mc = CHAP.match(l)
        if mc:
            flush()
            ch, v, buf = int(mc.group(1)), None, []
            continue
        if HEADING.match(l):
            # harvest the section title; its leading reference is the anchor verse
            # ("1-4. Announcement" -> 1.1, "4:2-7. The heavenly Jerusalem" -> 4.2)
            mh = re.match(r"^\s*(\d+)(?::(\d+))?[\d:,\-–—\s]*\.\s+(.+)$", l)
            if mh:
                key = f"{int(mh.group(1))}.{int(mh.group(2)) if mh.group(2) else 1}"
                headings.setdefault(key, mh.group(3).strip())
            continue
        if ALT.match(l):       # Oxyrhynchus fragment alternate -> drop until next real verse
            flush()
            v, buf = None, []
            continue
        mv = VNUM.match(l)
        if mv:
            flush()
            v, buf = int(mv.group(1)), []
            continue
        if v is not None:
            buf.append(l)
    flush()

    (HERE / "baruch2_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    # keep only headings whose anchor verse actually exists in the text
    headings = {k: t for k, t in headings.items() if k in english}
    (HERE / "baruch2_headings.json").write_text(
        json.dumps(headings, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "baruch2_tagged_full.json").write_text("[]", encoding="utf-8")

    chs = sorted({int(k.split('.')[0]) for k in english})
    print(f"2 Baruch: wrote {len(english)} verses across {len(chs)} chapters "
          f"({min(chs)}..{max(chs)})")
    gaps = [c for c in range(min(chs), max(chs) + 1) if c not in chs]
    if gaps:
        print("MISSING chapters:", gaps)
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
