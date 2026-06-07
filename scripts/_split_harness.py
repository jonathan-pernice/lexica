#!/usr/bin/env python3
"""_split_harness.py — LOCAL dev tool. READ-ONLY on the DB.

Runs the real build pipeline (parse_abp_line -> build_verse_words -> the split/
redistribute passes) over the WHOLE ABP source, using the lexicon from a local
bible.db. It needs NO bh_scrape.db / Rahlfs / TAGNT — those only add formatting
and pronoun numbers, which don't affect the English split we're testing.

Two uses:
  * snapshot:  python scripts/_split_harness.py bible.db --snapshot out.json
       writes a per-verse signature [(pos, sbase, english), ...] for every verse.
       Run once on the CURRENT code (baseline), edit _split_compounds, run again
       to a second file, then --diff the two to see EXACTLY which verses changed.
  * verse:     python scripts/_split_harness.py bible.db --verse 1Sa:28:13
       prints one verse's slots (quick spot-check).
  * diff:      python scripts/_split_harness.py --diff base.json new.json
       lists every verse whose split changed between two snapshots.
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_words_from_abp as B


def _args(flag):
    a = sys.argv[1:]
    return a[a.index(flag) + 1] if flag in a and a.index(flag) + 1 < len(a) else None


def _signature(bible_db):
    conn = sqlite3.connect(bible_db)
    lex = B.load_lexicon(conn)
    conn.close()
    ot, nt = B._abp_sources()
    sig = {}
    for book, ch, vs, words in B.iter_verses(ot, nt):
        rows = B.build_verse_words(words, [], lex)
        key = f"{book} {ch}:{vs}"
        sig[key] = [[r[0], r[4], r[1]] for r in rows]  # pos, sbase, english
    return sig


def main():
    if "--diff" in sys.argv:
        i = sys.argv.index("--diff")
        base = json.loads(Path(sys.argv[i + 1]).read_text(encoding="utf-8"))
        new = json.loads(Path(sys.argv[i + 2]).read_text(encoding="utf-8"))
        changed = [k for k in base if base.get(k) != new.get(k)]
        print(f"Changed verses: {len(changed)}\n")
        for k in changed:
            print(f"=== {k} ===")
            b = {r[0]: (r[1], r[2]) for r in base[k]}
            n = {r[0]: (r[1], r[2]) for r in new[k]}
            for pos in sorted(set(b) | set(n)):
                if b.get(pos) != n.get(pos):
                    print(f"  pos {pos:>2}  OLD {b.get(pos)!r}")
                    print(f"          NEW {n.get(pos)!r}")
            print()
        return

    bible_db = next((a for a in sys.argv[1:] if not a.startswith("--")), "bible.db")

    snap = _args("--snapshot")
    if snap:
        sig = _signature(bible_db)
        Path(snap).write_text(json.dumps(sig, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {len(sig)} verses -> {snap}")
        return

    target = _args("--verse")
    if target:
        bk, ch, vs = target.split(":")
        conn = sqlite3.connect(bible_db)
        lex = B.load_lexicon(conn)
        conn.close()
        ot, nt = B._abp_sources()
        for book, c, v, words in B.iter_verses(ot, nt):
            if book == bk and c == int(ch) and v == int(vs):
                rows = B.build_verse_words(words, [], lex)
                print(f"{bk} {ch}:{vs}\n")
                for r in rows:
                    print(f"  pos {r[0]:>2}  {('G'+r[4]) if r[4] and r[4][0].isdigit() else r[4]:<8} "
                          f"eng={r[1]!r:<26} head={r[2]!r}")
                return
        print("verse not found")
        return

    print(__doc__)


if __name__ == "__main__":
    main()
