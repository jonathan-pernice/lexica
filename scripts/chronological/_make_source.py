#!/usr/bin/env python3
"""
One-off: turn the standard One-Year-Chronological passage order into OUR
source_oneyear.txt, inserting our own era headers at chosen boundaries.

Input  : _source_raw.json  (the standard plan's flat passage order, a build
         input only — NOT committed; the references are the widely-published
         chronological plan, pointing into our own Bible text).
Output : source_oneyear.txt (committed) -> fed to build_chronological.py.

Re-run only if re-deriving the source. Normal edits happen in source_oneyear.txt.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "_source_raw.json")
OUT = os.path.join(HERE, "source_oneyear.txt")

# (start index into the flat passage list, era name, blurb). Boundaries chosen
# from the plan's book/event spine.
ERAS = [
    (0,    "Primeval History",         "Creation, the Fall, the Flood, and the Tower of Babel"),
    (14,   "The Patriarchs",           "Abraham, Isaac, Jacob, Joseph — and Job"),
    (61,   "The Exodus & Wilderness",  "Out of Egypt, the Law, and forty years of wandering"),
    (118,  "The Conquest",             "Joshua and the taking of the promised land"),
    (130,  "The Judges",               "The cycle of judges, and the story of Ruth"),
    (141,  "The United Kingdom",       "Samuel, Saul, and the reign of David"),
    (290,  "The Reign of Solomon",     "The temple and the wisdom books"),
    (338,  "The Divided Kingdom",      "Israel and Judah split, and the early prophets"),
    (552,  "Judah's Fall & the Exile", "The last kings, Jerusalem falls, and Babylon"),
    (669,  "The Return",               "Home from exile — temple, walls, and the last prophets"),
    (706,  "The Gospels",              "The life, death, and resurrection of Jesus"),
    (1025, "The Early Church",         "Acts and the apostles' letters"),
    (1096, "Revelation",               "John's vision and the close of the age"),
]

HEADER = """\
# Chronological reading order — passage sequence (event order, interleaved).
# Lines starting with "# ERA:" set the era for the passages that follow, as
#   # ERA: <Era name> | <short blurb>
# Everything else is one passage: "<Book> <ch>:<v>-<ch>:<v>" (single-book ranges).
# Book names map to the app's codes in build_chronological.py.
#
# These passages are the standard One-Year-Chronological arrangement (a widely
# published reading plan); the era grouping is ours. The passages are pointers
# into the reader's existing ABP/KJV/BSB text — no Bible text is stored here.
"""


def main():
    data = json.load(open(RAW, encoding="utf-8"))["data"]
    starts = {idx: (name, blurb) for idx, name, blurb in ERAS}
    lines = [HEADER]
    for i, passage in enumerate(data):
        if i in starts:
            name, blurb = starts[i]
            lines.append(f"\n# ERA: {name} | {blurb}")
        lines.append(passage)
    open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"wrote source_oneyear.txt: {len(data)} passages, {len(ERAS)} eras")


if __name__ == "__main__":
    main()
