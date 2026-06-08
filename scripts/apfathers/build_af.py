#!/usr/bin/env python3
"""build_af.py — build a Greek-tagged interlinear for an Apostolic Father, the same
shape the Didache uses (load_extra: <id>_tagged_full.json + <id>_english.json +
<id>_headings.json).

Greek + lemma + morphology come from RickBrannan/apostolic-fathers (CC-BY-SA, built on
the Tauber/Lake text). That source has no Strong's numbers and no English, so we add:
  * Strong's number  — map each lemma to a G-number via the openscriptures Strong's
    Greek dictionary (matched on the accent-stripped lemma, with a small alias table for
    elisions like δι'->διά and a few classical spellings).
  * gloss            — the brief definition from the Dodson lexicon, keyed by that
    G-number (clean modern glosses: ὡς -> "as, like", θεός -> "God").
  * English per verse — the Lightfoot translation (public domain), whose "<Prefix> C:V"
    markers share the Greek's versification, so it aligns one-to-one.
Words with no Strong's match (~5%: Brannan lemmatisation gaps + genuine non-NT words)
ship as plain chips, exactly like the Didache's no-Strong's words.

Raw inputs live in raw/ (gitignored); only the JSON outputs are committed.
    python build_af.py <book_id>
"""
import csv
import html as _h
import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw"

# book_id -> (Brannan morph file, Lightfoot english html, verse-marker prefix)
BOOKS = {
    "clement2": ("002-ii_clement.txt", "2clement_lightfoot.html", "2Clem"),
}

# elisions and a few classical->Koine spellings, accent-stripped both sides
ALIAS = {
    "δι": "δια", "αλλ": "αλλα", "παρ": "παρα", "απ": "απο", "επ": "επι", "υπ": "υπο",
    "μετ": "μετα", "μεθ": "μετα", "κατ": "κατα", "καθ": "κατα", "ανθ": "αντι",
    "ουτω(σ)": "ουτωσ", "δ": "δε", "γιγνωσκω": "γινωσκω", "σοω": "σωζω",
    "θελεω": "θελω", "φοβεομαι": "φοβεω", "ελεαω": "ελεεω", "οιδα": "ειδω",
}


def deaccent(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().replace("ς", "σ")


def load_strongs():
    js = (RAW / "strongs_greek.js").read_text(encoding="utf-8")
    data = json.loads(re.search(r"\{.*\}", js, re.S).group(0))
    lem2g = {}
    for g, v in data.items():
        if v.get("lemma"):
            lem2g.setdefault(deaccent(v["lemma"]), g)
    dod = {}
    with (RAW / "dodson.csv").open(encoding="utf-8") as f:
        r = csv.reader(f, delimiter="\t")
        next(r)
        for row in r:
            if len(row) >= 4 and row[0].isdigit():
                dod["G" + str(int(row[0]))] = row[3].strip()
    return lem2g, dod


def strongs_of(lemma, lem2g):
    d = deaccent(lemma)
    if d in lem2g:
        return lem2g[d]
    if d in ALIAS and ALIAS[d] in lem2g:
        return lem2g[ALIAS[d]]
    return None


def build_words(morph_file, lem2g, dod):
    words = []
    for line in (RAW / morph_file).read_text(encoding="utf-8").splitlines():
        p = line.split()
        if len(p) < 8 or p[7] == "lat":      # skip blanks and Latin-only portions
            continue
        ch, vs = int(p[0][3:6]), int(p[0][6:9])
        g = strongs_of(p[6], lem2g)
        words.append({"ref": f"{ch}.{vs}", "greek": p[3], "lemma": p[6],
                      "strongs": g, "gloss": dod.get(g)})
    return words


def build_english(html_file, prefix):
    raw = (RAW / html_file).read_text(encoding="utf-8", errors="replace")
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<br[^>]*>", "\n", raw)
    raw = re.sub(r"(?is)</?p[^>]*>", "\n", raw)
    t = _h.unescape(re.sub(r"<[^>]+>", " ", raw))
    parts = re.split(re.escape(prefix) + r"\s+(\d+):(\d+)", t)
    english = {}
    for i in range(1, len(parts), 3):
        ch, vs, txt = parts[i], parts[i + 1], parts[i + 2]
        txt = re.sub(r"\s+", " ", txt).strip()
        txt = re.split(r"\b(Translation|Roberts-Donaldson|From the Apostolic|Previous|Next)\b", txt)[0].strip()
        if txt:
            english[f"{ch}.{vs}"] = txt
    return english


def main():
    book = sys.argv[1] if len(sys.argv) > 1 else "clement2"
    morph_file, html_file, prefix = BOOKS[book]
    lem2g, dod = load_strongs()

    words = build_words(morph_file, lem2g, dod)
    english = build_english(html_file, prefix)

    (HERE / f"{book}_tagged_full.json").write_text(
        json.dumps(words, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{book}_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{book}_headings.json").write_text("{}", encoding="utf-8")

    grefs = {w["ref"] for w in words}
    erefs = set(english)
    hitS = sum(1 for w in words if w["strongs"])
    chs = sorted({int(r.split('.')[0]) for r in grefs})
    print(f"{book}: {len(words)} Greek words, {len(english)} English verses, "
          f"chapters {chs[0]}..{chs[-1]}")
    print(f"  Strong's coverage: {hitS}/{len(words)} = {100*hitS/len(words):.0f}%")
    miss_e = sorted(grefs - erefs)
    miss_g = sorted(erefs - grefs)
    if miss_e:
        print(f"  WARN Greek verses with no English: {miss_e[:10]}")
    if miss_g:
        print(f"  WARN English verses with no Greek: {miss_g[:10]}")
    if not miss_e and not miss_g:
        print("  Greek/English verses align one-to-one.")


if __name__ == "__main__":
    main()
