#!/usr/bin/env python3
"""Merge the per-chapter Didache tag files into one master file, in order."""
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

all_words = []
for p in PARTS:
    all_words.extend(json.loads((HERE / p).read_text(encoding="utf-8")))

out = HERE / "didache_tagged_full.json"
out.write_text(json.dumps(all_words, ensure_ascii=False, indent=0), encoding="utf-8")

linked = sum(1 for w in all_words if w.get("strongs"))
print(f"wrote {out.name}: {len(all_words)} words, {linked} linked, "
      f"{len(all_words)-linked} no-Strong's ({round(linked/len(all_words)*100)}%)")
