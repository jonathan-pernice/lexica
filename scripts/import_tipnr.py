#!/usr/bin/env python3
"""
import_tipnr.py — Import STEPBible TIPNR proper noun data into bible.db

Phase 1: Create tipnr lookup table, populate from TIPNR file
Phase 2: Match words.strongs_base='*' against tipnr names
         → update strongs_base to real H/G number, set is_pn=1
Phase 3: Mark remaining unmatched * words as is_pn=1 (metaV still works by name)

Usage:
  python3 scripts/import_tipnr.py bible.db --dry-run   # preview matches
  python3 scripts/import_tipnr.py bible.db              # apply changes
"""

import re
import sys
import sqlite3
import urllib.request
from collections import defaultdict

DB       = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "bible.db"
DRY_RUN  = "--dry-run" in sys.argv

TIPNR_URL = (
    "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/"
    "Proper%20Nouns/TIPNR%20-%20Translators%20Individualised%20Proper%20Names"
    "%20with%20all%20References%20-%20STEPBible.org%20CC%20BY.txt"
)

NT_BOOKS = {
    "Mat","Mar","Luk","Joh","Act","Rom","1Co","2Co","Gal",
    "Eph","Php","Col","1Th","2Th","1Ti","2Ti","Tit","Phm",
    "Heb","Jas","1Pe","2Pe","1Jo","2Jo","3Jo","Jud","Rev",
}

def norm_strongs(s):
    """H0175A -> H175, G0002 -> G2. Returns None if not parseable."""
    if not s:
        return None
    m = re.match(r"^([GH])0*(\d+)[A-Za-z]?$", s.strip())
    if m:
        return f"{m.group(1)}{int(m.group(2))}"
    return None

def extract_strongs_from_field(field):
    """Extract eStrong from 'dStrong«eStrong=Hebrew' format."""
    if "«" not in field:
        return None
    after = field.split("«", 1)[1]
    estrong = after.split("=")[0].strip()
    return norm_strongs(estrong)

def parse_tipnr(lines):
    """
    Returns:
      lookup    : {lower_name -> {"h": str|None, "g": str|None, "type": str}}
      tipnr_rows: [(strongs, primary_name, entity_type), ...]
    """
    lookup     = {}   # lower(name) -> entry dict
    tipnr_rows = []   # for tipnr table

    section = "other"   # current $=== section
    cur     = None      # current main record

    def save(cur):
        if not cur:
            return
        for nm in cur["names"]:
            key = nm.lower()
            if key not in lookup:
                lookup[key] = {"h": None, "g": None, "type": cur["type"]}
            e = lookup[key]
            if cur["h"] and not e["h"]:
                e["h"] = cur["h"]
            if cur["g"] and not e["g"]:
                e["g"] = cur["g"]
        for s in filter(None, [cur["h"], cur["g"]]):
            tipnr_rows.append((s, cur["name"], cur["type"]))

    for line in lines:
        # Section delimiter
        if line.startswith("$=========="):
            save(cur); cur = None
            low = line.lower()
            section = "person" if "person" in low else "place" if "place" in low else "other"
            continue

        if not line.strip():
            continue

        # Skip pure header / comment lines
        stripped = line.lstrip()
        if stripped[0] in ("=", "‖", "#", "*") or stripped.startswith("–") or stripped.startswith("UnifiedName"):
            continue

        is_sub = line[0] in (" ", "\t")
        parts  = line.split("\t")

        if not is_sub:
            # ── Main record ──────────────────────────────────────────
            save(cur); cur = None
            f0 = parts[0].strip()
            if "@" not in f0:
                continue
            name = f0.split("@")[0].strip()
            if not name:
                continue

            # uStrong comes after the last "=" in field 0
            primary = norm_strongs(f0.rsplit("=", 1)[-1]) if "=" in f0 else None

            cur = {
                "name":  name,
                "names": {name},
                "type":  section,
                "h":     primary if primary and primary[0] == "H" else None,
                "g":     primary if primary and primary[0] == "G" else None,
            }

            # Also check the dStrong«eStrong column in main record (index 11)
            for col in parts[9:14]:
                s = extract_strongs_from_field(col.strip())
                if s:
                    if s[0] == "H" and not cur["h"]:
                        cur["h"] = s
                    elif s[0] == "G" and not cur["g"]:
                        cur["g"] = s

        else:
            # ── Sub-record ───────────────────────────────────────────
            if not cur or len(parts) < 3:
                continue

            significance = parts[1].strip() if len(parts) > 1 else ""

            # Grab strongs from whichever column contains «
            for col in parts[2:7]:
                s = extract_strongs_from_field(col.strip())
                if s:
                    if s[0] == "H" and not cur["h"]:
                        cur["h"] = s
                    elif s[0] == "G" and not cur["g"]:
                        cur["g"] = s

            # Collect alternate name spellings for better matching
            # "Greek" captures LXX forms of OT names (e.g. Elias for Elijah)
            # which the ABP uses throughout since it's LXX-based
            if significance in ("Named", "Spelled", "Spelled combined",
                                 "Name combined", "Aramaic", "Greek"):
                unique = parts[2].strip() if len(parts) > 2 else ""
                alt = unique.split("|")[0].split("@")[0].strip()
                if alt and alt != cur["name"]:
                    cur["names"].add(alt)

    save(cur)
    return lookup, tipnr_rows


def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}import_tipnr.py → {DB}\n")

    # ── Download ──────────────────────────────────────────────────────
    print("Downloading TIPNR...")
    with urllib.request.urlopen(TIPNR_URL) as r:
        lines = r.read().decode("utf-8-sig").splitlines()
    print(f"  {len(lines)} lines\n")

    # ── Parse ─────────────────────────────────────────────────────────
    print("Parsing...")
    lookup, tipnr_rows = parse_tipnr(lines)
    print(f"  {len(lookup):,} name entries (incl. alternates)")
    print(f"  {len(tipnr_rows):,} strongs entries for tipnr table\n")

    # Spot-check key names + known problematic ones
    checks = ["Jesus","Israel","Edom","Abraham","Jerusalem","Moses",
               "Elijah","David","Mary","Judah","Ephraim","Aaron",
               "Zion","Abram","Levi","Pharisee","Canaan","Heth",
               "Assyria","Chaldea","Hivite","Amorite","Moab","Ammon"]
    print("Spot checks:")
    for nm in checks:
        print(f"  {nm:12} → {lookup.get(nm.lower())}")
    print()

    # ── DB work ───────────────────────────────────────────────────────
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    # Schema: add is_pn column
    if not DRY_RUN:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(words)").fetchall()}
        if "is_pn" not in cols:
            print("Adding is_pn column to words...")
            conn.execute("ALTER TABLE words ADD COLUMN is_pn INTEGER DEFAULT 0")

        print("Creating tipnr table...")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tipnr (
                strongs     TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                entity_type TEXT
            )
        """)
        conn.execute("DELETE FROM tipnr")
        conn.executemany(
            "INSERT OR REPLACE INTO tipnr(strongs,name,entity_type) VALUES(?,?,?)",
            tipnr_rows,
        )
        conn.commit()
        print(f"  Inserted {len(tipnr_rows):,} rows\n")

    # ── Match words ───────────────────────────────────────────────────
    print("Matching words.strongs_base='*'...")
    word_rows = conn.execute("""
        SELECT w.rowid AS word_id, w.english, v.book
        FROM words w
        JOIN verses v ON v.id = w.verse_id
        WHERE w.strongs_base = '*'
          AND w.english IS NOT NULL AND w.english != ''
    """).fetchall()
    print(f"  {len(word_rows):,} words to match\n")

    matched        = []   # (new_strongs, rowid)
    unmatched_cnt  = defaultdict(int)

    # Direct Strong's for entries missing from parsed TIPNR (confirmed numbers)
    DIRECT = {
        "zion":          "H6726",  "abram":        "H87",
        "sarai":         "H8297",  "hivite":       "H2340",
        "hivites":       "H2340",  "amorite":      "H567",
        "amorites":      "H567",   "jebusite":     "H2983",
        "jebusites":     "H2983",  "perizzite":    "H6522",
        "perizzites":    "H6522",  "girgashite":   "H1622",
        "girgashites":   "H1622",  "hermon":       "H2768",
        "shushan":       "H7800",  "necho":        "H5224",
        "neco":          "H5224",  "meshach":      "H4336",
        "shadrach":      "H7714",  "abednego":     "H5665",
        "syrian":        "H761",   "syrians":      "H761",
        # Additional missing entries
        "horeb":         "H2722",  "iscariot":     "G2469",
        "ishbosheth":    "H378",   "arphaxad":     "H775",
        "caesar":        "G2541",  "magdalene":    "G3094",
        "hinnom":        "H2011",  "tishbite":     "H8664",
        "bethhoron":     "H1032",  "edomite":      "H130",
        "edomites":      "H130",   "nethinim":     "H5411",
        "ezion":         "H6100",  "helkiah":      "H2518",
        "hilkiah":       "H2518",  "jabesh":       "H3003",
        "jabish":        "H3003",   "hor":          "H2023",
        "aholiab":       "H171",    "nazarene":     "G3480",
        "hormah":        "H2767",   "jaalam":       "H3281",
        "josedech":      "H3087",   "jehozadak":    "H3087",
        "hadarezer":     "H1928",   "pashur":       "H6583",
        "netophah":      "H5199",   "jerubbaal":    "H3378",
        "cana":          "G2580",   "barnea":       "H1251",
        "jeconiah":      "H3204",   "jechoniah":    "H3204",
        "anakim":        "H6062",   "anak":         "H6062",
        "shethar":       "H8370",   "melchisedek":  "H4442",
        "hodijah":       "H1941",   "aholibamah":   "H173",
        "bama":          "H1117",   "hagarite":     "H1905",
        "hagarites":     "H1905",
    }

    # Gentilics and common variants not stored under their ABP form in TIPNR
    ALIASES = {
        # Demonyms → root place/person in TIPNR
        "levite":      "levi",       "levites":     "levi",
        "jew":         "judah",      "jews":        "judah",
        "egyptian":    "egypt",      "egyptians":   "egypt",
        "assyrian":    "assyria",    "assyrians":   "assyria",
        "chaldean":    "chaldea",    "chaldeans":   "chaldea",
        "canaanite":   "canaan",     "canaanites":  "canaan",
        "hittite":     "heth",       "hittites":    "heth",
        "hivite":      "hivite",     "hivites":     "hivite",
        "amorite":     "amorite",    "amorites":    "amorite",
        "moabite":     "moab",       "moabites":    "moab",
        "ammonite":    "ammon",      "ammonites":   "ammon",
        "philistine":  "philistia",  "philistines": "philistia",
        "israelite":   "israel",     "israelites":  "israel",
        "pharisee":      "pharisee",   "pharisees":     "pharisee",
        "sadducee":      "sadducee",   "sadducees":     "sadducee",
        "persian":       "persia",     "persians":      "persia",
        "gileadite":     "gilead",     "gileadites":    "gilead",
        "elamite":       "elam",       "elamites":      "elam",
        "cushite":       "cush",       "cushites":      "cush",
        "midianite":     "midian",     "midianites":    "midian",
        "edomite":       "edom",       "edomites":      "edom",
        "baalim":        "baal",
        # Spelling variants (ABP/LXX vs ESV/Hebrew forms)
        "michaiah":      "micaiah",    "nabuzaradan":   "nebuzaradan",
        "nabuzar-adan":  "nebuzaradan","jabish":        "jabesh",
        "helkiah":       "hilkiah",    "pharez":        "perez",
        "zarah":         "zerah",      "bezaleel":      "bezalel",
        "urijah":        "uriah",      "neriah":        "neriah",
        "maachah":       "maacah",     "josedech":      "jehozadak",
        "tizrah":        "tirzah",     "baldad":        "bildad",
        "nethaneel":     "nethanel",   "netophathite":  "netophah",
        "netophathites": "netophah",   "hadarezer":     "hadadezer",
        "nazarene":      "nazareth",   "elias":         "elijah",
        "elisaios":      "elisha",     "esaias":        "isaiah",
        "jeremias":      "jeremiah",   "ezechias":      "hezekiah",
        "ozias":         "uzziah",     "josias":        "josiah",
        "jechonias":     "jehoiachin", "joatham":       "jotham",
        "ethiopia":      "cush",       "ethiopian":     "cush",
        "ethiopians":    "cush",       "sidonian":      "sidon",
        "sidonians":     "sidon",      "mede":          "media",
        "medes":         "media",      "median":        "media",
        "gittite":       "gath",       "gittites":      "gath",
        "carmelite":     "carmel",     "carmelites":    "carmel",
        "maachathite":   "maacah",     "maachathites":  "maacah",
        "kirjathjearim": "kiriath-jearim",
        "melchisedek":   "melchizedek",
    }

    def find_entry(english):
        """Try progressively looser matches against the TIPNR lookup."""
        # Normalise once: strip trailing punct + dashes, strip leading particles
        def _strip_trail(s):
            return re.sub(r"[\s,.:;!?'\"–\-]+$", "", s).strip()

        def _strip_lead(s):
            for prefix in ("land of the ", "land of ", "of the ", "of ", "to ",
                           "in the ", "in ", "for ", "both ", "and ", "this ",
                           "the ", "a ", "O ", "o "):
                if s.lower().startswith(prefix):
                    return s[len(prefix):]
            return s

        def _no_hyphen(s):
            return s.replace("-", "")

        # 1. Exact
        e = lookup.get(english.lower());
        if e: return e
        # 2. Strip trailing punctuation/dashes
        clean = _strip_trail(english)
        e = lookup.get(clean.lower())
        if e: return e
        # 3. Strip leading particle from cleaned
        bare = _strip_lead(clean)
        if bare != clean:
            e = lookup.get(bare.lower())
            if e: return e
        # 4. Remove hyphens: 'Beth-el' -> 'Bethel'
        e = lookup.get(_no_hyphen(bare).lower())
        if e: return e
        # 5. Strip particle from original then clean trailing
        bare2 = _strip_trail(_strip_lead(english))
        e = lookup.get(bare2.lower())
        if e: return e
        # 6. Try singular (strip trailing 's'): 'Pharisees' -> 'Pharisee'
        for candidate in (bare, bare2, clean):
            if candidate.endswith("s"):
                e = lookup.get(candidate[:-1].lower())
                if e: return e
        # 7. Manual alias table for gentilics and name variants
        for candidate in (bare.lower(), bare2.lower(), clean.lower(), english.lower()):
            mapped = ALIASES.get(candidate)
            if mapped:
                e = lookup.get(mapped)
                if e: return e
        # 8. Direct Strong's map for entries missing from parsed TIPNR
        # Also try no-hyphen variant for compound names like 'Abed-nego', 'Beth-horon'
        candidates_direct = {bare.lower(), bare2.lower(), clean.lower(), english.lower(),
                              _no_hyphen(bare).lower(), _no_hyphen(clean).lower()}
        for candidate in candidates_direct:
            s = DIRECT.get(candidate)
            if s:
                return {"h": s if s[0] == "H" else None,
                        "g": s if s[0] == "G" else None,
                        "type": "place"}
        return None

    for row in word_rows:
        english = row["english"].strip()
        book    = row["book"]
        entry   = find_entry(english)

        if not entry:
            unmatched_cnt[english] += 1
            continue

        is_nt   = book in NT_BOOKS
        strongs = entry["g"] if is_nt else entry["h"]

        # Fallback: if preferred side missing, use whatever exists
        if not strongs:
            strongs = entry["g"] or entry["h"]

        if strongs:
            matched.append((strongs, row["word_id"]))
        else:
            unmatched_cnt[english] += 1

    total_unmatched = sum(unmatched_cnt.values())
    print(f"  Matched  : {len(matched):,}")
    print(f"  Unmatched: {total_unmatched:,} words  ({len(unmatched_cnt):,} distinct names)\n")

    top = sorted(unmatched_cnt.items(), key=lambda x: -x[1])[:25]
    print("Top unmatched (may need aliases or stay as *):")
    for nm, cnt in top:
        print(f"  {nm!r:30}  {cnt}")
    print()

    if DRY_RUN:
        print("── Sample matches ──────────────────────────────────────")
        for new_s, rowid in matched[:30]:
            r = conn.execute("""
                SELECT w.english, v.book, v.chapter, v.verse
                FROM words w JOIN verses v ON v.id=w.verse_id
                WHERE w.rowid=?
            """, (rowid,)).fetchone()
            print(f"  {r['english']:20} {r['book']} {r['chapter']}:{r['verse']:3}  →  {new_s}")
        print("\n[DRY RUN] No changes written.")
        conn.close()
        return

    # ── Apply ─────────────────────────────────────────────────────────
    print(f"Applying {len(matched):,} strongs updates...")
    conn.executemany(
        "UPDATE words SET strongs_base=?, is_pn=1 WHERE rowid=?",
        matched,
    )

    # Mark remaining * words as is_pn=1 even without a match
    conn.execute("UPDATE words SET is_pn=1 WHERE strongs_base='*'")

    remaining = conn.execute(
        "SELECT COUNT(*) FROM words WHERE strongs_base='*'"
    ).fetchone()[0]

    conn.commit()
    conn.close()

    print(f"  {remaining:,} words still strongs_base='*' (unmatched — metaV by name still works)")
    print("\nDone.")


if __name__ == "__main__":
    main()
