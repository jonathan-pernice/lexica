#!/usr/bin/env python3
"""Parse the Life of Adam and Eve (Vita Adae et Evae, R.H. Charles 1913) into
adameve_english.json {"ch.vs": text} + empty headings/tagged files.

Source: raw/p_adamnev.html — the pseudepigrapha.com copy of Charles' APOT edition
(L.S.A. Wells' translation), same Charles family as the rest of our pseudepigrapha.

Layout (one continuous flat text once tags are stripped):
  * chapters are LOWERCASE ROMAN numerals i..li, each immediately followed by its
    verse-1 marker ("i 1 When they were driven out ...");
  * verses are bare arabic integers ("2", "3"); Charles' combined markers ("1,2",
    "2,3") fold the later number onto the first, exactly as printed;
  * numbers inside the prose are all spelled out ("seven days", "twelve angels"),
    so a digit token is always a verse marker.

Three source defects are repaired (pinned to unique phrases, faithful to Charles):
  * "iii I" — the chapter-3 verse-1 marker was scanned as a capital I, not 1;
  * the chapter markers "xxxii" and "xxxvii" were dropped by the scanner (their text
    and inner verse numbers survive) — re-inserted before their opening sentences.
Charles' editorial square brackets ("[the devil]") keep their words, marks dropped;
his supplied parentheses ("(saying)") are kept as printed.
"""
import html
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw" / "p_adamnev.html"


def roman_map():
    units = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"]
    tens = ["", "x", "xx", "xxx", "xl", "l"]
    out = {}
    for t in range(6):
        for u in range(10):
            n = t * 10 + u
            if 1 <= n <= 51:
                out[tens[t] + units[u]] = n
    return out


ROMAN = roman_map()
VNUM = re.compile(r"(\d{1,3})(?:,(\d{1,3}))?$")


def to_text(raw):
    t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    t = t.replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip()


def clean(s):
    s = s.replace("[", "").replace("]", "")
    return re.sub(r"\s+", " ", s).strip()


def main():
    t = to_text(RAW.read_text(encoding="utf-8", errors="replace"))
    t = t[re.search(r"\bi 1 When they were driven", t).start():]   # drop the 1913 header
    fm = re.search(r"Scanned and Edited by", t)
    if fm:
        t = t[:fm.start()]                                         # drop the scanner footer

    # source repairs (pinned to unique phrases)
    t = t.replace("iii I And Adam arose", "iii 1 And Adam arose")
    t = t.replace("And Adam answered and said: 'Hear me, my sons.",
                  "xxxii 1 And Adam answered and said: 'Hear me, my sons.")
    t = t.replace("Then Seth and his mother went off towards the gates of paradise.",
                  "xxxvii 1 Then Seth and his mother went off towards the gates of paradise.")

    toks = t.split()
    english = {}
    ch = v = None
    buf = []

    def flush():
        if ch is not None and v is not None:
            seg = clean(" ".join(buf))
            if seg:
                key = f"{ch}.{v}"
                english[key] = (english[key] + " " + seg) if key in english else seg

    i, n = 0, len(toks)
    while i < n:
        tok = toks[i]
        low = tok.lower()
        # chapter: a lowercase roman numeral followed by a verse-number token
        if tok == low and low in ROMAN and i + 1 < n and re.fullmatch(r"\d[\d,]*", toks[i + 1]):
            flush()
            ch, v, buf = ROMAN[low], None, []
            i += 1
            continue
        mv = VNUM.fullmatch(tok)
        if mv and ch is not None:
            flush()
            v, buf = int(mv.group(1)), []     # combined "1,2": text rides on the first
            i += 1
            continue
        buf.append(tok)
        i += 1
    flush()

    (HERE / "adameve_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "adameve_headings.json").write_text("{}", encoding="utf-8")
    (HERE / "adameve_tagged_full.json").write_text("[]", encoding="utf-8")

    chs = sorted({int(k.split(".")[0]) for k in english})
    print(f"Life of Adam and Eve: wrote {len(english)} verses across {len(chs)} chapters "
          f"({min(chs)}..{max(chs)})")
    missing = [c for c in range(1, 52) if c not in chs]
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
        print("clean: every chapter contiguous 1..max (combined markers aside)")


if __name__ == "__main__":
    main()
