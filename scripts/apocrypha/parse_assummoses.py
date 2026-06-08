#!/usr/bin/env python3
"""Parse the Assumption of Moses (a.k.a. Testament of Moses, R.H. Charles) into
assummoses_english.json {"ch.vs": text} + empty headings/tagged files.

Source: raw/p_assummoses.html (pseudepigrapha.com). CHAPTER-LEVEL ONLY: this is the
clean, complete Charles text, but it carries no verse numbers, and no freely-reachable
copy is versified (the only verse-divided text is the 1897 critical edition, whose OCR
is saturated with scholarly apparatus and is a different Charles revision -- aligning it
would yield wrong citations). So each of the 12 chapters is stored as a single unit
("C.1"); we do NOT invent verse boundaries. Re-import if a versified source turns up.
"""
import html as _h
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw" / "p_assummoses.html"
OUT = "assummoses"


def main():
    raw = RAW.read_text(encoding="utf-8", errors="replace")
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<br[^>]*>", "\n", raw)
    raw = re.sub(r"(?is)</?p[^>]*>", "\n", raw)
    raw = re.sub(r"(?is)</td>|</tr>", "\n", raw)
    t = _h.unescape(re.sub(r"<[^>]+>", " ", raw))
    lines = [re.sub(r"[ \t\xa0]+", " ", l).strip() for l in t.splitlines() if l.strip()]

    # the text breaks off mid-sentence ("...the oath which . . ."); everything after is
    # credits / editorial apparatus -> stop there so it doesn't ride on chapter 12.
    footer = re.compile(r"^(Translation$|adapted from R\. H\. Charles|Edited and adapted"
                        r"|Chapters \d|HTML Layout|Copyright \d|Wesley$)")
    start = next(i for i, l in enumerate(lines) if l == "1")
    chapters = {}
    cur = None
    for l in lines[start:]:
        if footer.match(l):
            break
        if re.fullmatch(r"\d{1,2}", l) and (cur is None or int(l) == cur + 1) and int(l) <= 12:
            cur = int(l)
            chapters[cur] = []
        elif cur is not None:
            chapters[cur].append(l)

    english = {}
    for c in sorted(chapters):
        text = re.sub(r"\s+", " ", " ".join(chapters[c])).strip()
        text = text.replace("[", "").replace("]", "")    # unwrap Charles' bracketed variants
        if text:
            english[f"{c}.1"] = text

    (HERE / f"{OUT}_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{OUT}_headings.json").write_text("{}", encoding="utf-8")
    (HERE / f"{OUT}_tagged_full.json").write_text("[]", encoding="utf-8")

    chs = sorted(int(k.split('.')[0]) for k in english)
    print(f"Assumption of Moses: wrote {len(english)} chapters ({min(chs)}..{max(chs)}), "
          f"one block each")
    gaps = [c for c in range(1, 13) if c not in chs]
    print("MISSING chapters:", gaps if gaps else "none")


if __name__ == "__main__":
    main()
