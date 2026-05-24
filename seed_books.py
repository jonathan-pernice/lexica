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
    # ── New Testament ──────────────────────────────────────────────────────────
    "Mat": {
        "name": "Matthew",
        "re_alt": r"Mat(?:t(?:hew)?)?",
        "narrative": (
            "  Genealogy/birth   ch 1–2      Sermon on Mount  ch 5–7\n"
            "  Twelve sent out   ch 10       Parables         ch 13\n"
            "  Peter's confession ch 16      Transfiguration  ch 17\n"
            "  Triumphal entry   ch 21       Olivet discourse ch 24–25\n"
            "  Passion/death     ch 26–27    Resurrection     ch 28"
        ),
    },
    "Mar": {
        "name": "Mark",
        "re_alt": r"Mar(?:k)?",
        "narrative": (
            "  Baptism/temptation ch 1       Twelve appointed ch 3\n"
            "  Feeding 5000      ch 6        Transfiguration  ch 9\n"
            "  Triumphal entry   ch 11       Olivet discourse ch 13\n"
            "  Passion/death     ch 14–15    Resurrection     ch 16"
        ),
    },
    "Luk": {
        "name": "Luke",
        "re_alt": r"Luk(?:e)?",
        "narrative": (
            "  Birth narratives  ch 1–2      Sermon on Plain  ch 6\n"
            "  Good Samaritan    ch 10       Prodigal son     ch 15\n"
            "  Rich man/Lazarus  ch 16       Zacchaeus        ch 19\n"
            "  Passion/death     ch 22–23    Emmaus road      ch 24"
        ),
    },
    "Joh": {
        "name": "John",
        "re_alt": r"Joh(?:n)?",
        "narrative": (
            "  Logos prologue    ch 1        Wedding at Cana  ch 2\n"
            "  Born again        ch 3        Bread of life    ch 6\n"
            "  Light of world    ch 8        Lazarus raised   ch 11\n"
            "  Upper room disc.  ch 13–17    Passion/death    ch 18–19\n"
            "  Resurrection      ch 20–21"
        ),
    },
    "Act": {
        "name": "Acts",
        "re_alt": r"Act(?:s)?",
        "narrative": (
            "  Pentecost         ch 2        Stephen martyred ch 7\n"
            "  Philip/eunuch     ch 8        Paul's conversion ch 9\n"
            "  Peter/Cornelius   ch 10       Jerusalem council ch 15\n"
            "  Paul's journeys   ch 13–21    Rome imprisonment ch 28"
        ),
    },
    "Rom": {
        "name": "Romans",
        "re_alt": r"Rom(?:ans?)?",
        "narrative": (
            "  All have sinned   ch 1–3      Justification    ch 3–5\n"
            "  Death to sin      ch 6        Spirit's life    ch 8\n"
            "  Israel's future   ch 9–11     Living sacrifice ch 12"
        ),
    },
    "1Co": {
        "name": "1 Corinthians",
        "re_alt": r"1\s*Cor?(?:inthians?)?",
        "narrative": (
            "  Church divisions  ch 1–4      Sexual ethics    ch 5–6\n"
            "  Marriage          ch 7        Idol food        ch 8–10\n"
            "  Lord's supper     ch 11       Spiritual gifts  ch 12–14\n"
            "  Resurrection      ch 15"
        ),
    },
    "2Co": {
        "name": "2 Corinthians",
        "re_alt": r"2\s*Cor?(?:inthians?)?",
        "narrative": (
            "  Ministry/suffering ch 1–7     Collection       ch 8–9\n"
            "  Boasting/weakness ch 10–12    Apostolic auth.  ch 13"
        ),
    },
    "Gal": {
        "name": "Galatians",
        "re_alt": r"Gal(?:atians?)?",
        "narrative": (
            "  Gospel defended   ch 1–2      Justification    ch 2–3\n"
            "  Law & promise     ch 3–4      Fruit of Spirit  ch 5\n"
            "  Sowing/reaping    ch 6"
        ),
    },
    "Eph": {
        "name": "Ephesians",
        "re_alt": r"Eph(?:esians?)?",
        "narrative": (
            "  Chosen in Christ  ch 1        One body         ch 2\n"
            "  Mystery revealed  ch 3        Church unity     ch 4\n"
            "  Armor of God      ch 6"
        ),
    },
    "Php": {
        "name": "Philippians",
        "re_alt": r"Php|Phi|Phil(?:ippians?)?",
        "narrative": (
            "  Joy in suffering  ch 1        Christ's humility ch 2\n"
            "  Righteousness     ch 3        Peace of God     ch 4"
        ),
    },
    "Col": {
        "name": "Colossians",
        "re_alt": r"Col(?:ossians?)?",
        "narrative": (
            "  Christ supremacy  ch 1        Against false teaching ch 2\n"
            "  New self          ch 3        Household code   ch 3–4"
        ),
    },
    "1Th": {
        "name": "1 Thessalonians",
        "re_alt": r"1\s*Th(?:ess(?:alonians?)?)?",
        "narrative": (
            "  Model church      ch 1        Paul's ministry  ch 2\n"
            "  Timothy's report  ch 3        Sexual holiness  ch 4\n"
            "  Day of the Lord   ch 5"
        ),
    },
    "2Th": {
        "name": "2 Thessalonians",
        "re_alt": r"2\s*Th(?:ess(?:alonians?)?)?",
        "narrative": (
            "  Persecution       ch 1        Man of lawlessness ch 2\n"
            "  Work ethic        ch 3"
        ),
    },
    "1Ti": {
        "name": "1 Timothy",
        "re_alt": r"1\s*Ti(?:m(?:othy)?)?",
        "narrative": (
            "  False teachers    ch 1        Prayer/worship   ch 2\n"
            "  Elders/deacons    ch 3        Sound doctrine   ch 4\n"
            "  Widows/elders     ch 5        Contentment      ch 6"
        ),
    },
    "2Ti": {
        "name": "2 Timothy",
        "re_alt": r"2\s*Ti(?:m(?:othy)?)?",
        "narrative": (
            "  Fan the flame     ch 1        Approved worker  ch 2\n"
            "  Last days         ch 3        Scripture useful ch 3\n"
            "  Preach the word   ch 4"
        ),
    },
    "Tit": {
        "name": "Titus",
        "re_alt": r"Tit(?:us)?",
        "narrative": (
            "  Elders in Crete   ch 1        Sound teaching   ch 2\n"
            "  Good deeds        ch 3"
        ),
    },
    "Phm": {
        "name": "Philemon",
        "re_alt": r"Phm|Philem(?:on)?",
        "narrative": (
            "  Onesimus returned v 1–25"
        ),
    },
    "Heb": {
        "name": "Hebrews",
        "re_alt": r"Heb(?:rews?)?",
        "narrative": (
            "  Son superior      ch 1–2      Sabbath rest     ch 3–4\n"
            "  High priest       ch 4–7      New covenant     ch 8\n"
            "  Tabernacle/blood  ch 9        Faith chapter    ch 11\n"
            "  Discipline        ch 12"
        ),
    },
    "Jas": {
        "name": "James",
        "re_alt": r"Jas(?:ames?)?|Jam(?:es)?",
        "narrative": (
            "  Trials & wisdom   ch 1        Faith & works    ch 2\n"
            "  Taming the tongue ch 3        Worldliness      ch 4\n"
            "  Rich oppressors   ch 5        Prayer           ch 5"
        ),
    },
    "1Pe": {
        "name": "1 Peter",
        "re_alt": r"1\s*Pe(?:t(?:er)?)?",
        "narrative": (
            "  Living hope       ch 1        Holy nation      ch 2\n"
            "  Suffering unjustly ch 2–3     Fiery trial      ch 4\n"
            "  Elders/humility   ch 5"
        ),
    },
    "2Pe": {
        "name": "2 Peter",
        "re_alt": r"2\s*Pe(?:t(?:er)?)?",
        "narrative": (
            "  Virtues           ch 1        False prophets   ch 2\n"
            "  Day of the Lord   ch 3"
        ),
    },
    "1Jn": {
        "name": "1 John",
        "re_alt": r"1\s*Joh?n?",
        "narrative": (
            "  God is light      ch 1–2      Love one another ch 3–4\n"
            "  Born of God       ch 5        Eternal life     ch 5"
        ),
    },
    "2Jn": {
        "name": "2 John",
        "re_alt": r"2\s*Joh?n?",
        "narrative": (
            "  Walk in truth     v 1–13      Deceivers warned v 7–11"
        ),
    },
    "3Jn": {
        "name": "3 John",
        "re_alt": r"3\s*Joh?n?",
        "narrative": (
            "  Gaius commended   v 1–12      Diotrephes rebuked v 9–10"
        ),
    },
    "Jud": {
        "name": "Jude",
        "re_alt": r"Jud(?:e)?",
        "narrative": (
            "  Contend for faith v 1–25      False teachers   v 4–16\n"
            "  Doxology          v 24–25"
        ),
    },
    "Rev": {
        "name": "Revelation",
        "re_alt": r"Rev(?:elation)?",
        "narrative": (
            "  Seven churches    ch 2–3      Throne vision    ch 4–5\n"
            "  Seven seals       ch 6–8      Seven trumpets   ch 8–11\n"
            "  Dragon/beast      ch 12–13    Seven bowls      ch 15–16\n"
            "  Babylon falls     ch 17–18    New Jerusalem    ch 21–22"
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
