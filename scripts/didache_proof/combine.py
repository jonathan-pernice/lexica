#!/usr/bin/env python3
"""Merge the per-chapter Didache tag files into one master file, in order, and
restore sentence punctuation onto each word's English gloss from the Greek source
(the hand-tagged words are stored bare). The interlinear chip shows the gloss, so
punctuation on the gloss is what makes the reading flow. Source and tagged words
line up 1:1 per verse. Greek-specific marks are mapped for English: ';' (Greek
question mark) -> '?', '·' (ano teleia) -> ';'."""
import json
from pathlib import Path

HERE = Path(__file__).parent
PARTS = [
    "didache_ch1_tagged.json",
    "didache_ch2_tagged.json",
    "didache_ch3-4_tagged.json",
    "didache_ch5-8_tagged.json",
    "didache_ch9-12_tagged.json",
    "didache_ch13-16_tagged.json",
]

_PUNC = set(".,;:·!?")
_GLOSS_MAP = {";": "?", "·": ";"}


def _trail(tok):
    """Return the run of trailing punctuation on a source token (may be empty)."""
    i = len(tok)
    while i > 0 and tok[i - 1] in _PUNC:
        i -= 1
    return tok[i:]


def attach_punct(all_words):
    src = {}
    for line in (HERE / "didache_greek_source.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        ref, rest = line.split(" ", 1)
        src[ref] = rest.split()
    byref = {}
    for w in all_words:
        byref.setdefault(w["ref"], []).append(w)
    n = 0
    for ref, toks in src.items():
        tw = byref.get(ref, [])
        if len(toks) != len(tw):
            print(f"  WARN {ref}: {len(toks)} source vs {len(tw)} tagged — punctuation skipped")
            continue
        for t, w in zip(toks, tw):
            p = _trail(t)
            if not p:
                continue
            w["gloss"] = (w.get("gloss") or "") + "".join(_GLOSS_MAP.get(c, c) for c in p)
            n += 1
    print(f"  restored punctuation on {n} glosses")


all_words = []
for p in PARTS:
    all_words.extend(json.loads((HERE / p).read_text(encoding="utf-8")))

attach_punct(all_words)

out = HERE / "didache_tagged_full.json"
out.write_text(json.dumps(all_words, ensure_ascii=False, indent=0), encoding="utf-8")

linked = sum(1 for w in all_words if w.get("strongs"))
print(f"wrote {out.name}: {len(all_words)} words, {linked} linked, "
      f"{len(all_words)-linked} no-Strong's ({round(linked/len(all_words)*100)}%)")
