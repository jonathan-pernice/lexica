#!/usr/bin/env python3
"""
Create and populate the books table with metadata for every ABP book loaded
into bible.db. Run once after loading new books to refresh metadata.

    python seed_books.py [path/to/bible.db]

Only inserts rows for books already present in the verses table.
Existing rows are replaced (INSERT OR REPLACE) so re-running is safe.
"""
import os
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "bible.db"
)

# Canonical metadata for every book that may ever be loaded.
# re_alt  — regex alternative used to match this book in AI-generated text
# narrative — key narrative sections injected into the AI system prompt
KNOWN_BOOKS: dict[str, dict] = {
    "Gen": {
        "name": "Genesis",
        "re_alt": r"Gen(?:esis)?",
        "narrative": (
            "  Creation          ch 1–2      Garden of Eden   ch 2–3\n"
            "  Cain & Abel       ch 4        Flood            ch 6–9\n"
            "  Tower of Babel    ch 11       Abrahamic call   ch 12\n"
            "  Covenant of fire  ch 15       Hagar/Ishmael    ch 16, 21\n"
            "  Sodom             ch 18–19    Binding of Isaac ch 22\n"
            "  Jacob & Esau      ch 25–27    Jacob's ladder   ch 28\n"
            "  Joseph            ch 37–50"
        ),
    },
    "Exo": {
        "name": "Exodus",
        "re_alt": r"Exo(?:dus)?",
        "narrative": (
            "  Oppression        ch 1–2      Moses' call      ch 3–4\n"
            "  Plagues           ch 7–12     Passover         ch 12\n"
            "  Red Sea crossing  ch 14–15    Sinai arrival    ch 19\n"
            "  Covenant/law      ch 20–24    Golden calf      ch 32\n"
            "  Tabernacle design ch 25–31    Tabernacle built ch 35–40"
        ),
    },
    "Lev": {
        "name": "Leviticus",
        "re_alt": r"Lev(?:iticus)?",
        "narrative": (
            "  Burnt/sin offerings ch 1–7    Priestly ordination ch 8–10\n"
            "  Purity laws       ch 11–15    Day of Atonement    ch 16\n"
            "  Holiness Code     ch 17–26    Vows & tithes       ch 27"
        ),
    },
    "Num": {
        "name": "Numbers",
        "re_alt": r"Num(?:bers)?",
        "narrative": (
            "  Census            ch 1–4      Nazarite vow     ch 6\n"
            "  Spies/Canaan      ch 13–14    Korah's revolt   ch 16\n"
            "  Bronze serpent    ch 21       Balaam           ch 22–24\n"
            "  Phinehas          ch 25       Second census    ch 26"
        ),
    },
    "Deu": {
        "name": "Deuteronomy",
        "re_alt": r"Deu(?:t(?:eronomy)?)?",
        "narrative": (
            "  Moses' retrospect ch 1–3      Shema            ch 6\n"
            "  Covenant renewal  ch 4–5      Blessings/curses ch 27–28\n"
            "  Song of Moses     ch 32       Blessing/death   ch 33–34"
        ),
    },
    "Jos": {
        "name": "Joshua",
        "re_alt": r"Jos(?:hua)?",
        "narrative": (
            "  Crossing Jordan   ch 3–4      Fall of Jericho  ch 6\n"
            "  Conquest          ch 7–12     Land allotment   ch 13–22\n"
            "  Covenant at Shechem ch 24"
        ),
    },
    "Jdg": {
        "name": "Judges",
        "re_alt": r"Jdg|Judg(?:es)?",
        "narrative": (
            "  Othniel/Ehud      ch 3        Deborah/Barak    ch 4–5\n"
            "  Gideon            ch 6–8      Abimelech        ch 9\n"
            "  Jephthah          ch 11       Samson           ch 13–16"
        ),
    },
    "Rth": {
        "name": "Ruth",
        "re_alt": r"Rth|Rut(?:h)?",
        "narrative": (
            "  Naomi & Ruth      ch 1        Ruth & Boaz      ch 2–3\n"
            "  Kinsman-redeemer  ch 4"
        ),
    },
    "1Sa": {
        "name": "1 Samuel",
        "re_alt": r"1\s*Sam?(?:uel)?",
        "narrative": (
            "  Samuel's birth    ch 1–3      Ark narrative    ch 4–7\n"
            "  Saul anointed     ch 9–10     David & Goliath  ch 17\n"
            "  David & Saul      ch 18–31"
        ),
    },
    "2Sa": {
        "name": "2 Samuel",
        "re_alt": r"2\s*Sam?(?:uel)?",
        "narrative": (
            "  David crowned     ch 2        Ark brought up   ch 6\n"
            "  Davidic covenant  ch 7        Bathsheba        ch 11–12\n"
            "  Absalom           ch 13–19"
        ),
    },
    "1Ki": {
        "name": "1 Kings",
        "re_alt": r"1\s*Ki(?:ngs?)?",
        "narrative": (
            "  Solomon's temple  ch 6–8      Kingdom split    ch 12\n"
            "  Elijah            ch 17–19    Naboth's vineyard ch 21"
        ),
    },
    "2Ki": {
        "name": "2 Kings",
        "re_alt": r"2\s*Ki(?:ngs?)?",
        "narrative": (
            "  Elisha            ch 2–8      Fall of Israel   ch 17\n"
            "  Hezekiah          ch 18–20    Fall of Judah    ch 24–25"
        ),
    },
    "Psa": {
        "name": "Psalms",
        "re_alt": r"Psa(?:lms?)?",
        "narrative": (
            "  Creation/Torah    Ps 1, 8, 19, 119\n"
            "  Lament            Ps 22, 44, 88\n"
            "  Enthronement      Ps 2, 45, 72, 110\n"
            "  Praise/Hallel     Ps 113–118, 146–150"
        ),
    },
    "Pro": {
        "name": "Proverbs",
        "re_alt": r"Pro(?:verbs?)?",
        "narrative": (
            "  Wisdom poems      ch 1–9      Solomonic proverbs ch 10–22\n"
            "  Words of Agur     ch 30       Virtuous woman   ch 31"
        ),
    },
    "Isa": {
        "name": "Isaiah",
        "re_alt": r"Isa(?:iah)?",
        "narrative": (
            "  Isaiah's call     ch 6        Immanuel         ch 7\n"
            "  Servant songs     ch 42, 49, 50, 52–53\n"
            "  New creation      ch 65–66"
        ),
    },
    "Jer": {
        "name": "Jeremiah",
        "re_alt": r"Jer(?:emiah)?",
        "narrative": (
            "  Temple sermon     ch 7        New covenant     ch 31\n"
            "  Fall of Jerusalem ch 39, 52"
        ),
    },
    "Eze": {
        "name": "Ezekiel",
        "re_alt": r"Eze(?:kiel)?",
        "narrative": (
            "  Throne-chariot    ch 1        Valley of bones  ch 37\n"
            "  New temple        ch 40–48"
        ),
    },
    "Dan": {
        "name": "Daniel",
        "re_alt": r"Dan(?:iel)?",
        "narrative": (
            "  Fiery furnace     ch 3        Writing on wall  ch 5\n"
            "  Lion's den        ch 6        Four beasts      ch 7\n"
            "  Seventy weeks     ch 9"
        ),
    },
    "1Ch": {
        "name": "1 Chronicles",
        "re_alt": r"1\s*Chr?(?:on(?:icles)?)?",
        "narrative": (
            "  Genealogies       ch 1–9      David's reign    ch 10–29\n"
            "  Ark brought up    ch 15–16    Temple plans     ch 22–29"
        ),
    },
    "2Ch": {
        "name": "2 Chronicles",
        "re_alt": r"2\s*Chr?(?:on(?:icles)?)?",
        "narrative": (
            "  Solomon's temple  ch 2–7      Kingdom split    ch 10\n"
            "  Hezekiah's reform ch 29–31    Josiah's reform  ch 34–35\n"
            "  Fall of Jerusalem ch 36"
        ),
    },
    "Ezr": {
        "name": "Ezra",
        "re_alt": r"Ezr(?:a)?",
        "narrative": (
            "  Return from exile ch 1–2      Temple rebuilt   ch 3–6\n"
            "  Ezra's mission    ch 7–8      Mixed marriages  ch 9–10"
        ),
    },
    "Neh": {
        "name": "Nehemiah",
        "re_alt": r"Neh(?:emiah)?",
        "narrative": (
            "  Wall rebuilt      ch 1–7      Covenant renewal ch 8–10\n"
            "  Repopulation      ch 11–12    Nehemiah's reforms ch 13"
        ),
    },
    "Est": {
        "name": "Esther",
        "re_alt": r"Est(?:h(?:er)?)?",
        "narrative": (
            "  Esther made queen ch 1–2      Haman's plot     ch 3\n"
            "  Esther's plea     ch 4–5      Haman's fall     ch 7\n"
            "  Purim established ch 8–9"
        ),
    },
    "Job": {
        "name": "Job",
        "re_alt": r"Job",
        "narrative": (
            "  Prologue/wager    ch 1–2      Job's complaint  ch 3\n"
            "  Three friends     ch 4–31     Elihu            ch 32–37\n"
            "  God speaks        ch 38–41    Restoration      ch 42"
        ),
    },
    "Ecc": {
        "name": "Ecclesiastes",
        "re_alt": r"Ecc(?:l(?:es(?:iastes)?)?)?",
        "narrative": (
            "  Vanity of wisdom  ch 1–2      A time for all   ch 3\n"
            "  Riches & toil     ch 4–5      Fear God         ch 12"
        ),
    },
    "Son": {
        "name": "Song of Solomon",
        "re_alt": r"Son(?:g(?:\s+of\s+Sol(?:omon)?)?)?|Cant(?:icles?)?",
        "narrative": (
            "  Mutual longing    ch 1–2      Seeking beloved  ch 3\n"
            "  Wedding praise    ch 4–5      Reunion          ch 6–8"
        ),
    },
    "Lam": {
        "name": "Lamentations",
        "re_alt": r"Lam(?:entations?)?",
        "narrative": (
            "  Jerusalem fallen  ch 1–2      God's faithfulness ch 3\n"
            "  Desolation        ch 4        Plea for restoration ch 5"
        ),
    },
    "Hos": {
        "name": "Hosea",
        "re_alt": r"Hos(?:ea)?",
        "narrative": (
            "  Hosea & Gomer     ch 1–3      Israel's unfaithfulness ch 4–7\n"
            "  Judgment          ch 8–10     God's love       ch 11\n"
            "  Restoration call  ch 14"
        ),
    },
    "Joe": {
        "name": "Joel",
        "re_alt": r"Joe(?:l)?",
        "narrative": (
            "  Locust plague     ch 1        Day of the Lord  ch 2\n"
            "  Spirit poured out ch 2        Nations judged   ch 3"
        ),
    },
    "Amo": {
        "name": "Amos",
        "re_alt": r"Amo(?:s)?",
        "narrative": (
            "  Oracles on nations ch 1–2     Woes against Israel ch 3–6\n"
            "  Five visions      ch 7–9      Restoration promise ch 9"
        ),
    },
    "Oba": {
        "name": "Obadiah",
        "re_alt": r"Oba(?:d(?:iah)?)?",
        "narrative": (
            "  Edom's pride      v 1–9       Edom's violence  v 10–14\n"
            "  Day of the Lord   v 15–21"
        ),
    },
    "Jon": {
        "name": "Jonah",
        "re_alt": r"Jon(?:ah)?",
        "narrative": (
            "  Jonah's flight    ch 1        Great fish       ch 1–2\n"
            "  Nineveh repents   ch 3        God's rebuke     ch 4"
        ),
    },
    "Mic": {
        "name": "Micah",
        "re_alt": r"Mic(?:ah)?",
        "narrative": (
            "  Judgment on Judah ch 1–3      Future peace     ch 4–5\n"
            "  Bethlehem ruler   ch 5        God's case       ch 6\n"
            "  Restoration       ch 7"
        ),
    },
    "Nah": {
        "name": "Nahum",
        "re_alt": r"Nah(?:um)?",
        "narrative": (
            "  God's vengeance   ch 1        Fall of Nineveh  ch 2–3"
        ),
    },
    "Hab": {
        "name": "Habakkuk",
        "re_alt": r"Hab(?:akkuk)?",
        "narrative": (
            "  Prophet's complaint ch 1      Chaldean judgment ch 1\n"
            "  Five woes         ch 2        Prayer/theophany ch 3"
        ),
    },
    "Zep": {
        "name": "Zephaniah",
        "re_alt": r"Zep(?:h(?:aniah)?)?",
        "narrative": (
            "  Day of the Lord   ch 1–2      Woe to Jerusalem ch 3\n"
            "  Restoration joy   ch 3"
        ),
    },
    "Hag": {
        "name": "Haggai",
        "re_alt": r"Hag(?:gai)?",
        "narrative": (
            "  Call to rebuild   ch 1        Future glory     ch 2\n"
            "  Zerubbabel chosen ch 2"
        ),
    },
    "Zec": {
        "name": "Zechariah",
        "re_alt": r"Zec(?:h(?:ariah)?)?",
        "narrative": (
            "  Eight visions     ch 1–6      Fasts & feasts   ch 7–8\n"
            "  King comes humble ch 9        Thirty pieces    ch 11\n"
            "  Mourning/cleansing ch 12–13   Day of the Lord  ch 14"
        ),
    },
    "Mal": {
        "name": "Malachi",
        "re_alt": r"Mal(?:achi)?",
        "narrative": (
            "  Israel's unfaith  ch 1–2      Messenger coming ch 3\n"
            "  Tithing           ch 3        Day of the Lord  ch 4"
        ),
    },
}


def main() -> None:
    print(f"Target database: {DB}")
    conn = sqlite3.connect(DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS books (
            id        INTEGER PRIMARY KEY,
            abbrev    TEXT NOT NULL UNIQUE,
            name      TEXT NOT NULL,
            re_alt    TEXT NOT NULL,
            narrative TEXT
        )
    """)

    present = {r[0] for r in conn.execute("SELECT DISTINCT abbrev FROM books")}
    loaded  = [r[0] for r in conn.execute(
        "SELECT book FROM (SELECT book, MIN(id) AS first FROM verses GROUP BY book) ORDER BY first"
    ).fetchall()]

    inserted = updated = skipped = 0
    for abbrev in loaded:
        if abbrev not in KNOWN_BOOKS:
            print(f"  WARNING: no metadata defined for book '{abbrev}' — skipping")
            skipped += 1
            continue
        m = KNOWN_BOOKS[abbrev]
        conn.execute(
            "INSERT OR REPLACE INTO books (abbrev, name, re_alt, narrative) VALUES (?,?,?,?)",
            (abbrev, m["name"], m["re_alt"], m.get("narrative")),
        )
        if abbrev in present:
            updated += 1
        else:
            inserted += 1

    conn.commit()
    conn.close()
    print(f"Done — {inserted} inserted, {updated} updated, {skipped} skipped")
    print(f"Books in DB: {', '.join(loaded)}")


if __name__ == "__main__":
    main()
