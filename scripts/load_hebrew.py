#!/usr/bin/env python3
"""
load_hebrew.py — build the Hebrew OT interlinear into its OWN database (heb.db).

Reads the OpenScriptures morphhb Westminster Leningrad Codex (OSIS XML, public
domain) and writes two tables — heb_words and heb_verses — into a SEPARATE heb.db
file. It NEVER reads or writes bible.db. Safe to re-run: it clears and refills only
the book(s) you name.

Each Hebrew word keeps its vowel points but has the cantillation (chanting) accents
stripped, and carries its Strong's H-number, its grammar code, a short English gloss,
and a transliteration (pronunciation). The gloss + transliteration come from the
public-domain Strong's Hebrew dictionary (morphhb itself has no English); common words
use a curated short gloss so the interlinear reads cleanly instead of dumping the full
dictionary definition under every word. The H-number drives the existing BDB sidebar.

Run on PythonAnywhere after cloning the data:
    git clone https://github.com/openscriptures/morphhb ~/morphhb
    # short English glosses + transliterations (public domain) — Strong's Hebrew dict:
    wget -O ~/strongs-hebrew.js \
      https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js
    python3 scripts/load_hebrew.py \
        --morphhb ~/morphhb/wlc \
        --glosses ~/strongs-hebrew.js \
        --out ~/bible-db/heb.db \
        Jonah                 # load ONE book first; omit the name to load all 39

Columns mirror the non-canon <book>_words pattern so the reader can eat the same shape.
"""
import argparse
import json
import re
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path

OSIS_NS = "http://www.bibletechnologies.net/2003/OSIS/namespace"

# morphhb file / osisID name  ->  the book id the app already uses (BOOK_ORDER, 00-core.jsx)
OSIS_TO_APP = {
    "Gen": "Gen", "Exod": "Exo", "Lev": "Lev", "Num": "Num", "Deut": "Deu",
    "Josh": "Jos", "Judg": "Jdg", "Ruth": "Rth", "1Sam": "1Sa", "2Sam": "2Sa",
    "1Kgs": "1Ki", "2Kgs": "2Ki", "1Chr": "1Ch", "2Chr": "2Ch", "Ezra": "Ezr",
    "Neh": "Neh", "Esth": "Est", "Job": "Job", "Ps": "Psa", "Prov": "Pro",
    "Eccl": "Ecc", "Song": "Son", "Isa": "Isa", "Jer": "Jer", "Lam": "Lam",
    "Ezek": "Eze", "Dan": "Dan", "Hos": "Hos", "Joel": "Joe", "Amos": "Amo",
    "Obad": "Oba", "Jonah": "Jon", "Mic": "Mic", "Nah": "Nah", "Hab": "Hab",
    "Zeph": "Zep", "Hag": "Hag", "Zech": "Zec", "Mal": "Mal",
}

# Short, clean glosses for the most common Hebrew words. The raw Strong's definition
# for particles/prepositions is explanatory prose ("(by implication) very widely used
# as a relative conjunction...") — useless as an interlinear gloss — so these override
# it. These are the highest-frequency words across the OT, so curating them cleans up
# most of the running text. Everything else falls back to a trimmed definition.
CURATED_GLOSS = {
    # particles, prepositions, conjunctions
    "H853": "[obj]", "H854": "with", "H413": "to, toward", "H5921": "on, over",
    "H4480": "from", "H3588": "that, because", "H3808": "not", "H408": "do not",
    "H834": "which, who", "H3605": "all, every", "H3651": "so, thus", "H5704": "until",
    "H310": "after", "H8478": "under, instead", "H996": "between", "H1571": "also, even",
    "H389": "surely, only", "H7535": "only", "H518": "if", "H3863": "if only",
    "H6258": "now", "H8033": "there", "H6311": "here", "H4100": "what", "H4310": "who",
    "H335": "where", "H3651b": "so", "H1115": "so as not", "H4994": "please, now",
    "H2009": "behold", "H2005": "behold", "H1887": "behold",
    # pronouns
    "H1931": "he, it", "H1932": "she, it", "H1992": "they", "H2007": "they (f)",
    "H859": "you", "H589": "I", "H595": "I", "H2088": "this", "H2063": "this",
    "H428": "these", "H4310b": "who",
    # very common verbs
    "H1961": "to be", "H559": "to say", "H1696": "to speak", "H6213": "to do, make",
    "H1980": "to go, walk", "H935": "to come, go in", "H3318": "to go out",
    "H5927": "to go up", "H3381": "to go down", "H7725": "to return", "H5414": "to give",
    "H3947": "to take", "H7200": "to see", "H8085": "to hear", "H3045": "to know",
    "H5375": "to lift, carry", "H7121": "to call", "H5046": "to tell", "H3427": "to dwell, sit",
    "H5975": "to stand", "H4191": "to die", "H2421": "to live", "H2425": "to live",
    "H3372": "to fear", "H1288": "to bless", "H6965": "to arise", "H5066": "to draw near",
    "H4672": "to find", "H398": "to eat", "H8104": "to keep, guard", "H6680": "to command",
    "H7965": "peace, welfare",
    # very common nouns + names of God
    "H430": "God", "H410": "God", "H3068": "the LORD", "H136": "Lord", "H113": "lord, master",
    "H120": "man, mankind", "H376": "man", "H802": "woman, wife", "H1121": "son",
    "H1323": "daughter", "H1": "father", "H517": "mother", "H251": "brother",
    "H5971": "people", "H4428": "king", "H5650": "servant", "H3548": "priest",
    "H5030": "prophet", "H776": "earth, land", "H8064": "heavens", "H3220": "sea",
    "H4325": "water", "H5892": "city", "H1004": "house", "H3117": "day", "H3915": "night",
    "H8141": "year", "H6256": "time", "H3027": "hand", "H7218": "head", "H3820": "heart",
    "H5315": "soul, life", "H7307": "spirit, wind", "H6963": "voice, sound", "H8034": "name",
    "H1697": "word, thing", "H1818": "blood", "H6086": "tree, wood", "H68": "stone",
    "H2416": "living, life", "H7451": "evil, calamity", "H2896": "good", "H1419": "great",
    "H6635": "host, army", "H6440": "face, before",
    # Jonah's vocabulary (so the proof book reads clean)
    "H3124": "Jonah", "H573": "Amittai", "H5210": "Nineveh", "H8659": "Tarshish",
    "H591": "ship", "H4419": "sailor", "H2904": "to hurl, throw", "H3627": "vessel, article",
    "H5591": "storm, tempest", "H5590": "to storm", "H1272": "to flee", "H8367": "to be calm",
    "H2803": "to think, plan", "H5680": "Hebrew", "H3375": "Jonah",
    # Creation / Genesis 1 vocabulary (the most-read chapter — keep it clean)
    "H7225": "beginning", "H1254": "to create", "H216": "light", "H2822": "darkness",
    "H8414": "formless", "H922": "void", "H7549": "expanse", "H3974": "luminary",
    "H4327": "kind", "H6754": "image", "H1823": "likeness", "H929": "beast, cattle",
    "H7431": "creeping thing", "H1710": "fish", "H5775": "bird",
}

# Cantillation (chanting) accents + structural marks we DROP. We KEEP the niqqud
# (vowel points U+05B0-05BC, the shin/sin dots U+05C1/05C2, qamats-qatan U+05C7).
_DROP = set(range(0x0591, 0x05B0))  # te'amim / cantillation accents
_DROP |= {0x05BD, 0x05BF, 0x05C0, 0x05C3, 0x05C4, 0x05C5, 0x05C6}  # meteg/rafe/paseq/sof-pasuq/...


def clean_hebrew(text):
    # morphhb splits prefixes/suffixes with "/" inside the word — join them, drop accents.
    text = text.replace("/", "")
    return "".join(ch for ch in text if ord(ch) not in _DROP).strip()


def main_strongs(lemma):
    # lemma looks like "c/1961", "1121 a", "d/5892 b", "m/l/6440", or just "b".
    # The single letters are prefix particles; the content word is the number.
    if not lemma:
        return None
    first = lemma.split()[0]                       # drop the " a"/" b" homonym marker
    nums = [p for p in first.split("/") if p.isdigit()]
    return ("H" + nums[-1]) if nums else None      # content piece is the last number


def short_gloss(strongs_def, kjv_def):
    """Boil a verbose Strong's definition down to a 1-3 word interlinear gloss."""
    for src in (strongs_def, kjv_def):
        if not src:
            continue
        g = re.split(r"[;(]", src)[0]              # drop the "(by implication…)" tail / clauses after ;
        g = g.split(",")[0].strip().strip(".")     # first comma-clause
        g = re.sub(r"\s+", " ", g)
        if g and len(g) <= 24:
            return g
    # nothing short enough — take the head of the definition and cap it
    g = re.sub(r"\s+", " ", (strongs_def or kjv_def or "").split(";")[0]).strip()
    return g[:24].rstrip(" ,") if g else ""


def load_lexicon(path):
    """Build {H-number: {gloss, xlit}} from the openscriptures Strong's Hebrew dict.
    Accepts the file as plain .json or as the .js that wraps it (`var x = { ... };`).
    gloss = a short interlinear gloss (curated for common words, else a trimmed def);
    xlit  = the academic transliteration (drives the Interlinear pronunciation line).
    A missing/unreadable file is not fatal — the Hebrew still loads, bare."""
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        print(f"note: gloss file '{path}' not found — loading Hebrew with no glosses for now")
        return {}
    try:
        text = p.read_text(encoding="utf-8")
        i, j = text.find("{"), text.rfind("}")
        raw = json.loads(text[i:j + 1])
    except Exception as e:
        print(f"note: could not read glosses ({e}) — continuing without")
        return {}
    out = {}
    for key, entry in raw.items():                 # key = "H1", "H430", ...
        gloss = CURATED_GLOSS.get(key) or short_gloss(entry.get("strongs_def"), entry.get("kjv_def"))
        out[key] = {"gloss": gloss, "xlit": (entry.get("xlit") or "").strip()}
    return out


def parse_book(xml_path, lex):
    tree = ET.parse(xml_path)
    wtag, vtag = f"{{{OSIS_NS}}}w", f"{{{OSIS_NS}}}verse"
    wrows, vrows = [], []
    for verse in tree.iter(vtag):
        osis = verse.get("osisID")                 # "Jonah.1.1"
        if not osis:
            continue
        bk, ch, vs = osis.split(".")
        app_book = OSIS_TO_APP.get(bk)
        if not app_book:
            continue
        ch, vs = int(ch), int(vs)
        pos, words = 0, []
        for child in verse:
            if child.tag != wtag:                  # skip <seg> punctuation (maqaf, sof-pasuq)
                continue
            heb = clean_hebrew("".join(child.itertext()))
            if not heb:
                continue
            sn = main_strongs(child.get("lemma", ""))
            info = lex.get(sn) if sn else None
            gloss = (info or {}).get("gloss", "")
            translit = (info or {}).get("xlit", "")
            morph = child.get("morph", "")
            wrows.append((app_book, ch, vs, pos, heb, sn, morph, gloss, translit))
            words.append(heb)
            pos += 1
        vrows.append((app_book, ch, vs, " ".join(words)))
    return wrows, vrows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--morphhb", required=True, help="path to the morphhb wlc/ directory")
    ap.add_argument("--out", required=True, help="output heb.db path")
    ap.add_argument("--glosses", help="Strong's Hebrew dict, .js or .json (optional but recommended)")
    ap.add_argument("books", nargs="*", help="OSIS book names to load (default: all 39)")
    args = ap.parse_args()

    lex = load_lexicon(args.glosses)
    wlc = Path(args.morphhb)
    books = args.books or list(OSIS_TO_APP.keys())

    conn = sqlite3.connect(args.out)
    cur = conn.cursor()
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS heb_words (
            book TEXT, chapter INTEGER, verse INTEGER, position INTEGER,
            hebrew TEXT, strongs TEXT, morph TEXT, gloss TEXT, translit TEXT
        );
        CREATE TABLE IF NOT EXISTS heb_verses (
            book TEXT, chapter INTEGER, verse INTEGER, hebrew TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_heb_words_bcv  ON heb_words(book, chapter, verse);
        CREATE INDEX IF NOT EXISTS idx_heb_verses_bcv ON heb_verses(book, chapter, verse);
    """)
    # add the translit column to a heb.db that predates it (so re-running upgrades in place)
    if "translit" not in [r[1] for r in cur.execute("PRAGMA table_info(heb_words)")]:
        cur.execute("ALTER TABLE heb_words ADD COLUMN translit TEXT")

    total = 0
    for osis in books:
        app_book = OSIS_TO_APP.get(osis)
        if not app_book:
            print(f"skip unknown book '{osis}'")
            continue
        xml_path = wlc / f"{osis}.xml"
        if not xml_path.exists():
            print(f"missing {xml_path}")
            continue
        # clear just this book in this isolated db, then refill (so re-running is safe)
        cur.execute("DELETE FROM heb_words  WHERE book=?", (app_book,))
        cur.execute("DELETE FROM heb_verses WHERE book=?", (app_book,))
        wrows, vrows = parse_book(xml_path, lex)
        cur.executemany("INSERT INTO heb_words  VALUES (?,?,?,?,?,?,?,?,?)", wrows)
        cur.executemany("INSERT INTO heb_verses VALUES (?,?,?,?)", vrows)
        total += len(wrows)
        print(f"{osis:6} -> {app_book:4}  {len(wrows):6} words  {len(vrows):4} verses")

    conn.commit()
    nomatch = cur.execute("SELECT count(*) FROM heb_words WHERE strongs IS NULL").fetchone()[0]
    conn.close()
    print(f"done: {total} Hebrew words; {nomatch} with no Strong's (prefix/suffix-only words — expected)")


if __name__ == "__main__":
    main()
