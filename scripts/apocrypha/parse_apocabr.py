#!/usr/bin/env python3
"""Parse the Apocalypse of Abraham into apocabr_english.json {"ch.vs": text} + empty
headings/tagged files.

Source: raw/p_apocabr.html (pseudepigrapha.com). The page lays TWO English
translations side by side in a table; every cell is anchored, e.g.
  <A Name="T1_C1_V2">2. </A>...   (Translation 1, chapter 1, verse 2)
  <A Name="T2_C0_V62">62. </A>... (Translation 2 -- the parallel column)
We ship Translation 1 only. Two source quirks force a document-order walk rather than
trusting the anchor name's chapter:
  * the chapter comes from the visible "Chapter N" heading anchor (<A Name="T1_Cn">),
    because the verse anchors under "Chapter 32" are mis-named C31 in the source;
  * each verse's text runs from its anchor to the NEXT anchor of any kind, so the
    interleaved T2 cells correctly bound (and are then skipped).
Combined verses keep the source's own label (e.g. "2.(3.)" -> stored as verse 2; 3 is
folded, shown by the label), so a chapter may legitimately skip a number.
The source carries literal U+FFFD where the Word export's apostrophes were lost
(father<FFFD>s -> father's); these are restored to ' .
"""
import html as _h
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw" / "p_apocabr.html"
OUT = "apocabr"

ANCHOR = re.compile(r'<A\s+Name="([^"]+)"[^>]*>', re.I)
CHAP = re.compile(r"^T1_C(\d+)$", re.I)
VERSE = re.compile(r"^T1_C\d+_V(\d+)$", re.I)
TAG = re.compile(r"<[^>]+>")
LABEL = re.compile(r"^[\s\d.()]+")        # leading "2.(3.) " verse label remnant


def clean(seg):
    seg = TAG.sub(" ", seg)
    seg = _h.unescape(seg)
    seg = re.sub(r"[\s\xa0]+", " ", seg).strip()
    seg = LABEL.sub("", seg)              # drop the leading verse-number label
    return seg.strip()


def main():
    raw = RAW.read_text(encoding="utf-8").replace("�", "'")
    # strip the trailing credits table so the last verse doesn't absorb them
    raw = re.split(r"Converted to HTML by", raw)[0]
    anchors = [(m.start(), m.end(), m.group(1)) for m in ANCHOR.finditer(raw)]

    english = {}
    cur_ch = None
    for i, (s, e, name) in enumerate(anchors):
        mc = CHAP.match(name)
        if mc:
            cur_ch = int(mc.group(1))
            continue
        mv = VERSE.match(name)
        if not mv or cur_ch is None:
            continue                      # T2 cells and stray anchors -> skip
        v = int(mv.group(1))
        nxt = anchors[i + 1][0] if i + 1 < len(anchors) else len(raw)
        seg = clean(raw[e:nxt])
        if seg:
            english[f"{cur_ch}.{v}"] = seg

    (HERE / f"{OUT}_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{OUT}_headings.json").write_text("{}", encoding="utf-8")
    (HERE / f"{OUT}_tagged_full.json").write_text("[]", encoding="utf-8")

    chs = sorted({int(k.split('.')[0]) for k in english})
    print(f"Apocalypse of Abraham: wrote {len(english)} verses across {len(chs)} "
          f"chapters ({min(chs)}..{max(chs)})")
    gaps = [c for c in range(min(chs), max(chs) + 1) if c not in chs]
    print("MISSING chapters:", gaps if gaps else "none")
    for c in chs:
        vs = sorted(int(k.split('.')[1]) for k in english if int(k.split('.')[0]) == c)
        miss = [x for x in range(1, max(vs) + 1) if x not in vs]
        if miss:
            print(f"  ch {c}: max {max(vs)} -- verse gaps {miss} (combined-verse labels)")


if __name__ == "__main__":
    main()
