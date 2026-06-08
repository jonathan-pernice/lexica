#!/usr/bin/env python3
"""Parse 3 Baruch (Greek Apocalypse of Baruch, H.M. Hughes in R.H. Charles' APOT 1913)
into baruch3_english.json {"ch.vs": text} + baruch3_headings.json + empty tagged file.

Source: raw/p_3baruch.html — the pseudepigrapha.com copy of the Charles/Wesley edition.
The page's own footer explains its markup: "Red numbers identify chapters. Black numbers
within the text refer to verses." After an HTML tag-strip BOTH would become bare inline
integers and be indistinguishable, so we FIRST turn every red <span> chapter number into
a "@@CHAP N@@" marker, then strip tags. What remains:
  * "@@CHAP N@@"            -> chapter N (the next inline integer is its verse 1);
  * a "Prologue." section before chapter 1 -> kept as chapter 0 (Didache convention);
  * bare inline integers    -> verse markers, running through the prose; each chapter's
    text is joined and split on a sequential token stream (the verse number precedes its
    sentence, per the source note).
"""
import html
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw" / "p_3baruch.html"
RED_CHAP = re.compile(r"<span[^>]*color:\s*red[^>]*>\s*(\d+)\.?", re.I)
GAP_TOL = 4


def to_text(raw):
    raw = RED_CHAP.sub(r" @@CHAP \1@@ ", raw)
    t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    return re.sub(r"\s+", " ", t).strip()


def clean(s):
    s = s.replace("[", "").replace("]", "")
    s = re.sub(r"\s+([,.;:])", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def split_verses(body, start_v=1):
    toks = body.split()
    verses, cur, buf, last = {}, None, [], start_v - 1

    def flush():
        if cur is not None:
            seg = clean(" ".join(buf))
            if seg:
                verses[cur] = (verses[cur] + " " + seg) if cur in verses else seg

    for tok in toks:
        m = re.fullmatch(r"(\d{1,3})[.,]?", tok)   # verse nums may carry a trailing , or .
        val = int(m.group(1)) if m else None
        if val is not None and last < val <= last + GAP_TOL:
            flush()
            cur, buf, last = val, [], val
        else:
            buf.append(tok)
    flush()
    return verses


def main():
    t = to_text(RAW.read_text(encoding="utf-8", errors="replace"))
    # body runs from the Prologue to the Wesley footer
    t = t[re.search(r"\bPrologue\.", t).start():]
    fm = re.search(r"This text.*?Wesley|Red numbers identify chapters|Edited", t)
    if fm:
        t = t[:fm.start()]

    # segment: everything before the first @@CHAP@@ is the Prologue (chapter 0)
    parts = re.split(r"@@CHAP (\d+)@@", t)
    segments = [("0", parts[0])]
    for num, body in zip(parts[1::2], parts[2::2]):
        segments.append((num, body))

    english, headings = {}, {}
    for num, body in segments:
        ch = int(num)
        if ch == 0:
            body = re.sub(r"^\s*Prologue\.", " ", body)
            headings["0.1"] = "Prologue"
        for v, text in split_verses(body).items():
            english[f"{ch}.{v}"] = text

    headings = {k: t for k, t in headings.items() if k in english}

    (HERE / "baruch3_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "baruch3_headings.json").write_text(
        json.dumps(headings, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "baruch3_tagged_full.json").write_text("[]", encoding="utf-8")

    chs = sorted({int(k.split(".")[0]) for k in english})
    print(f"3 Baruch: wrote {len(english)} verses across {len(chs)} chapters "
          f"({min(chs)}..{max(chs)}); {len(headings)} headings")
    missing = [c for c in range(0, 18) if c not in chs]
    if missing:
        print("MISSING chapters:", missing)
    report = []
    for c in chs:
        vs = sorted(int(k.split(".")[1]) for k in english if int(k.split(".")[0]) == c)
        gaps = [x for x in range(1, max(vs) + 1) if x not in vs]
        if gaps:
            report.append((c, max(vs), gaps))
    if report:
        print(f"REVIEW ({len(report)} chapters with verse gaps):")
        for c, mx, gaps in report:
            print(f"  ch {c}: max {mx} -- missing {gaps}")
    else:
        print("clean: every chapter contiguous 1..max")


if __name__ == "__main__":
    main()
