#!/usr/bin/env python3
"""build_hermas.py — build the Shepherd of Hermas Greek interlinear (its own builder,
because Hermas doesn't fit the simple book/chapter/verse model the other Apostolic
Fathers use).

Hermas has THREE sub-books (Visions, Mandates, Similitudes), each numbered from 1, and
inside them chapters and verses — a 4-level reference. Brannan encodes it as a 15-digit
ref `BBB SSS NNN CCC VVV` (section 1/2/3, number, chapter, verse). We flatten it to the
standard CONTINUOUS chapter numbering 1..114 (each section·number·chapter, in order),
which is exactly what the Lightfoot English uses in its "C[NNN]:V" verse markers — so
the two line up. The Greek's section-0 entries are just the unit titles ("Ὅρασις α´"):
we drop them as words and instead emit a clean section heading ("Vision 1" ...) at each
unit's first chapter.

Greek+Strong's+gloss exactly as build_af.py (lemma -> Strong's -> Dodson). English from
Lightfoot (en_shepherd.html). Run:  python build_hermas.py
"""
import html as _h
import json
import re
from pathlib import Path

import build_af   # load_strongs, strongs_of (shared lexicon plumbing)

HERE = Path(__file__).parent
RAW = HERE / "raw"
SEC_NAME = {1: "Vision", 2: "Mandate", 3: "Similitude"}


def ref5(code):
    return tuple(int(code[i:i + 3]) for i in (0, 3, 6, 9, 12))


def build():
    lem2g, dod = build_af.load_strongs()

    # walk the Greek in order: assign each (section, number, chapter>=1) the next
    # continuous chapter; collect words; remember where each unit (section, number)
    # first starts so we can drop a heading there.
    cont = {}
    words = []
    headings = {}
    seen_units = set()
    for line in (RAW / "013-shepherd.txt").read_text(encoding="utf-8").splitlines():
        p = line.split()
        if len(p) < 8 or len(p[0]) != 15 or not p[0].isdigit() or p[7] == "lat":
            continue
        sec, num, ch, vs = ref5(p[0])[1:]
        if ch == 0:                       # unit-title entry -> not a word
            continue
        key = (sec, num, ch)
        if key not in cont:
            cont[key] = len(cont) + 1
        c = cont[key]
        if (sec, num) not in seen_units:  # first chapter of a Vision/Mandate/Similitude
            seen_units.add((sec, num))
            headings[f"{c}.1"] = f"{SEC_NAME[sec]} {num}"
        g = build_af.strongs_of(p[6], lem2g)
        words.append({"ref": f"{c}.{vs}", "greek": p[3], "lemma": p[6],
                      "strongs": g, "gloss": dod.get(g)})

    english = build_english(set(cont.values()))

    (HERE / "shepherd_tagged_full.json").write_text(
        json.dumps(words, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "shepherd_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "shepherd_headings.json").write_text(
        json.dumps(headings, ensure_ascii=False, indent=0), encoding="utf-8")

    grefs = {w["ref"] for w in words}
    hitS = sum(1 for w in words if w["strongs"])
    miss_e = sorted(grefs - set(english), key=lambda r: (int(r.split('.')[0]), int(r.split('.')[1])))
    print(f"Shepherd of Hermas: {len(words)} Greek words across {len(cont)} chapters "
          f"(1..{len(cont)}), {len(headings)} section headings")
    print(f"  Strong's coverage: {hitS}/{len(words)} = {100*hitS/len(words):.0f}%")
    print(f"  English verses: {len(english)} | Greek verses without English: {len(miss_e)} "
          f"(Lightfoot/Greek edition split differences)")


def build_english(valid_chapters):
    """Lightfoot marks verses as 'C[NNN]:V' (NNN = continuous chapter) in most of the
    book and plain 'C:V' in Vision 1 (where C already equals the continuous chapter).
    Take the continuous number, keep markers in forward order (filters stray scripture
    'C:V' that would jump backwards), and slice the text between them."""
    raw = (RAW / "en_shepherd.html").read_text(encoding="utf-8", errors="replace")
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<br[^>]*>", "\n", raw)
    raw = re.sub(r"(?is)</?p[^>]*>", "\n", raw)
    t = _h.unescape(re.sub(r"<[^>]+>", " ", raw))

    marks = []
    for m in re.finditer(r"\b(\d+)(?:\[(\d+)\])?:(\d+)\b", t):
        c = int(m.group(2)) if m.group(2) else int(m.group(1))
        v = int(m.group(3))
        if c in valid_chapters:
            marks.append((m.start(), m.end(), c, v))
    # keep a forward-progressing run (chapter never goes backwards)
    kept, lastc = [], 0
    for s, e, c, v in marks:
        if c >= lastc:
            kept.append((s, e, c, v))
            lastc = c
    english = {}
    for i, (s, e, c, v) in enumerate(kept):
        end = kept[i + 1][0] if i + 1 < len(kept) else len(t)
        seg = build_af._clean(t[e:end])
        if seg:
            english[f"{c}.{v}"] = seg
    return english


if __name__ == "__main__":
    build()
