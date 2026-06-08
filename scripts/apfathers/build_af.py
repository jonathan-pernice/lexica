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

# book_id -> (Brannan morph file, Lightfoot english html, marker)
#   marker = ("prefix", "<Prefix>")  -> verses tagged "<Prefix> C:V" in the English
#   marker = ("chapter",)            -> "CHAPTER N" headers, then "N:V" verse markers
# (The Shepherd of Hermas is held back -- its Vision/Mandate/Similitude structure needs
# its own handling.)
BOOKS = {
    "clement1":  ("001-i_clement.txt", "en_1clement.html", ("prefix", "1Clem")),
    "clement2":  ("002-ii_clement.txt", "2clement_lightfoot.html", ("prefix", "2Clem")),
    "ign_eph":   ("003-ignatius-ephesians.txt", "en_ignatius-ephesians.html", ("chapter",)),
    "ign_mag":   ("004-ignatius-magnesians.txt", "en_ignatius-magnesians.html", ("chapter",)),
    "ign_tral":  ("005-ignatius-trallians.txt", "en_ignatius-trallians.html", ("chapter",)),
    "ign_rom":   ("006-ignatius-romans.txt", "en_ignatius-romans.html", ("chapter",)),
    "ign_phld":  ("007-ignatius-philadelphians.txt", "en_ignatius-philadelphians.html", ("chapter",)),
    "ign_smyrn": ("008-ignatius-smyrnaeans.txt", "en_ignatius-smyrnaeans.html", ("chapter",)),
    "ign_pol":   ("009-ignatius-polycarp.txt", "en_ignatius-polycarp.html", ("chapter",)),
    "polycarp":  ("010-polycarp-philippians.txt", "en_polycarp.html", ("prefix", "Polycarp")),
    "barnabas":  ("012-barnabas.txt", "en_barnabas.html", ("prefix", "Barnabas")),
    "mpolycarp": ("014-martyrdom.txt", "en_mpolycarp.html", ("prefix", "Polycarp")),
    "diognetus": ("015-diognetus.txt", "en_diognetus.html", ("chapter",)),
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
        if not (len(p[0]) == 9 and p[0].isdigit()):   # skip malformed ref codes
            continue
        ch, vs = int(p[0][3:6]), int(p[0][6:9])
        g = strongs_of(p[6], lem2g)
        words.append({"ref": f"{ch}.{vs}", "greek": p[3], "lemma": p[6],
                      "strongs": g, "gloss": dod.get(g)})
    return words


STOP = re.compile(r"\b(Translation|Roberts-Donaldson|From the Apostolic|Previous|Next|"
                  r"Recommended|Information on)\b")


def _clean(txt):
    return STOP.split(re.sub(r"\s+", " ", txt).strip())[0].strip()


def build_english(html_file, marker):
    raw = (RAW / html_file).read_text(encoding="utf-8", errors="replace")
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<br[^>]*>", "\n", raw)
    raw = re.sub(r"(?is)</?p[^>]*>", "\n", raw)
    t = _h.unescape(re.sub(r"<[^>]+>", " ", raw))
    english = {}
    if marker[0] == "prefix":
        parts = re.split(re.escape(marker[1]) + r"\s+(\d+):(\d+)", t)
        for i in range(1, len(parts), 3):
            seg = _clean(parts[i + 2])
            if seg:
                english[f"{int(parts[i])}.{int(parts[i + 1])}"] = seg
    else:  # "chapter": split on "CHAPTER N", then take this chapter's own "N:V" markers
        cparts = re.split(r"CHAPTER\s+(\d+)", t)
        for i in range(1, len(cparts), 2):
            ch, body = int(cparts[i]), cparts[i + 1]
            vmarks = [(m.start(), m.end(), int(m.group(1)))
                      for m in re.finditer(rf"\b{ch}:(\d+)\b", body)]
            for j, (s, e, v) in enumerate(vmarks):
                end = vmarks[j + 1][0] if j + 1 < len(vmarks) else len(body)
                seg = _clean(body[e:end])
                if seg:
                    english[f"{ch}.{v}"] = seg
    return english


def build_one(book, lem2g, dod):
    morph_file, html_file, marker = BOOKS[book]
    words = build_words(morph_file, lem2g, dod)
    english = build_english(html_file, marker)

    (HERE / f"{book}_tagged_full.json").write_text(
        json.dumps(words, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{book}_english.json").write_text(
        json.dumps(english, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / f"{book}_headings.json").write_text("{}", encoding="utf-8")

    grefs = {w["ref"] for w in words}
    erefs = set(english)
    hitS = sum(1 for w in words if w["strongs"])
    chs = sorted({int(r.split('.')[0]) for r in grefs}) or [0]
    cov = 100 * hitS / len(words) if words else 0
    # Greek-without-English is a real gap; English-without-Greek is expected where only
    # a Latin text survives (Polycarp 10-14) -- report both but don't treat as failure.
    miss_e = sorted(grefs - erefs, key=lambda r: (int(r.split('.')[0]), int(r.split('.')[1])))
    miss_g = sorted(erefs - grefs, key=lambda r: (int(r.split('.')[0]), int(r.split('.')[1])))
    print(f"{book:10} ch {chs[0]}..{chs[-1]:<3} | {len(words):5} gk words {cov:4.0f}% Strong's "
          f"| {len(english):3} en | gk-no-en={len(miss_e)} en-no-gk={len(miss_g)}")
    if miss_e:
        print(f"             gk verses missing English: {miss_e[:12]}")
    return book


def main():
    lem2g, dod = load_strongs()
    books = sys.argv[1:] if len(sys.argv) > 1 else list(BOOKS)
    for book in books:
        build_one(book, lem2g, dod)


if __name__ == "__main__":
    main()
