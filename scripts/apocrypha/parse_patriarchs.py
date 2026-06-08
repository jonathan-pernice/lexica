#!/usr/bin/env python3
"""Parse the Testaments of the Twelve Patriarchs (R.H. Charles, APOT vol. II) into the
twelve per-testament <id>_english.json {"ch.vs": text} files (+ empty headings/tagged).

Source: raw/ec_patriarchs_charles.html (earlychristianwritings.com -- the same Charles
edition as the rest of the corpus). Structure:
  * each testament opens with an all-caps heading "THE TESTAMENT OF <NAME> ...";
  * chapter numbers are BOLD ("<B>1</B>"); verse numbers are PLAIN inline integers
    sitting mid-sentence, in Charles' usual style.
We split the body by the bold chapter markers and number chapters by ORDER of
appearance (the printed bold value is ignored -- it fixes Judah, whose ch 25 is
mislabelled "26" in the source). Inside each chapter the inline verse numbers are
resolved by parse_wesley.split_verses (the windowed splitter that tells a real prose
number from a verse marker and folds Charles' combined "N, M" markers).
"""
import json
import re
from pathlib import Path

import parse_wesley   # split_verses (windowed) + pre_clean

HERE = Path(__file__).parent
RAW = HERE / "raw" / "ec_patriarchs_charles.html"

# heading caps-name -> (book id, display name, mobile abbr)
BOOKS = {
    "REUBEN":   ("treuben",   "Testament of Reuben",   "TReu"),
    "SIMEON":   ("tsimeon",   "Testament of Simeon",   "TSim"),
    "LEVI":     ("tlevi",     "Testament of Levi",     "TLevi"),
    "JUDAH":    ("tjudah",    "Testament of Judah",    "TJud"),
    "ISSACHAR": ("tissachar", "Testament of Issachar", "TIss"),
    "ZEBULUN":  ("tzebulun",  "Testament of Zebulun",  "TZeb"),
    "DAN":      ("tdan",      "Testament of Dan",      "TDan"),
    "NAPHTALI": ("tnaphtali", "Testament of Naphtali", "TNaph"),
    "GAD":      ("tgad",      "Testament of Gad",      "TGad"),
    "ASHER":    ("tasher",    "Testament of Asher",    "TAsh"),
    "JOSEPH":   ("tjoseph",   "Testament of Joseph",   "TJos"),
    "BENJAMIN": ("tbenjamin", "Testament of Benjamin", "TBen"),
}

HEAD = re.compile(r"THE TESTAMENT OF ([A-Z]{3,})")     # case-sensitive: real headings only
BOLDCH = re.compile(r"<B>\s*\d+\s*</B>", re.I)
# footer noise that can trail the final testament once tags are gone
FOOTER = re.compile(r"\b(Information on|From The Apocrypha|Recommended Books|Please buy)\b")


def main():
    raw = RAW.read_text(encoding="utf-8", errors="replace")
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)

    # carve the file into [heading-name, body] runs
    marks = [(m.start(), m.group(1)) for m in HEAD.finditer(raw)]
    summary = []
    for idx, (pos, name) in enumerate(marks):
        end = marks[idx + 1][0] if idx + 1 < len(marks) else len(raw)
        if name not in BOOKS:
            continue
        bid, disp, _ = BOOKS[name]
        body = raw[pos:end]
        # split into chapters on the bold markers; pieces[0] is the heading/preamble
        pieces = BOLDCH.split(body)
        # pieces[0] is the heading/preamble before chapter 1 -> dropped
        english = {}
        for ch, piece in enumerate(pieces[1:], start=1):
            text = parse_wesley.TAG.sub(" ", piece)
            text = FOOTER.split(text)[0]
            # Two source glitches drop a chapter's opening text (it sits before the
            # first marker the splitter recognises, so it is never flushed):
            #   * the verse-1 number OCR'd as a letter l / I  -> restore to "1";
            #   * a no-space combined marker "1,2" -> space it to "1, 2" so it
            #     tokenises (Charles' usual form is "1, 2").
            text = re.sub(r"^\s*[lI](?=\s+[A-Z])", " 1", text)
            text = re.sub(r"^\s*(\d{1,3})(?=[A-Za-z])", r" \1 ", text)  # "1For" -> "1 For"
            text = re.sub(r"(?<=\d),(?=\d)", ", ", text)
            verses, order, combined = parse_wesley.split_verses(text)
            for v, seg in verses.items():
                english[f"{ch}.{v}"] = seg
        write(bid, english)
        chs = sorted({int(k.split('.')[0]) for k in english})
        summary.append((disp, bid, len(chs), len(english), chs))

    print("Testaments of the Twelve Patriarchs:")
    for disp, bid, nch, nv, chs in summary:
        gaps = [c for c in range(1, max(chs) + 1) if c not in chs] if chs else []
        flag = f"  MISSING CH {gaps}" if gaps else ""
        print(f"  {disp:24} ({bid:10}) {nch:2} ch / {nv:3} v{flag}")


def write(bid, english):
    (HERE / f"{bid}_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{bid}_headings.json").write_text("{}", encoding="utf-8")
    (HERE / f"{bid}_tagged_full.json").write_text("[]", encoding="utf-8")


if __name__ == "__main__":
    main()
