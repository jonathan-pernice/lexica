#!/usr/bin/env python3
"""Fetch R.H. Charles' 1917 'Book of Enoch' (public domain) chapter wikitext from
English Wikisource and cache each chapter's raw wikitext under raw/. Read-only on
the web; writes only local cache files. Re-run safe (overwrites the cache)."""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw"
RAW.mkdir(exist_ok=True)
API = "https://en.wikisource.org/w/api.php"
BASE = "The Book of Enoch (Charles)/Chapter "


def page_title(n):
    return BASE + (f"{n:02d}" if n < 100 else str(n))


def fetch_batch(titles):
    params = {
        "action": "query", "prop": "revisions", "rvprop": "content",
        "rvslots": "main", "format": "json", "formatversion": "2",
        "titles": "|".join(titles),
    }
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "lexica-enoch-import/1.0 (study app; contact via project)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    nums = list(range(1, 110))  # 1..109; we'll see what 109 holds
    title_to_num = {page_title(n): n for n in nums}
    out = {}
    titles = list(title_to_num)
    for i in range(0, len(titles), 40):
        batch = titles[i:i + 40]
        data = fetch_batch(batch)
        for p in data["query"]["pages"]:
            title = p["title"]
            n = title_to_num.get(title)
            if n is None:
                continue
            if p.get("missing"):
                print(f"  ch {n}: MISSING page")
                continue
            txt = p["revisions"][0]["slots"]["main"]["content"]
            out[n] = txt
            (RAW / f"ch{n:03d}.wikitext").write_text(txt, encoding="utf-8")
        print(f"  fetched batch {i//40 + 1} ({len(batch)} titles)")
        time.sleep(0.5)
    (RAW / "_all_wikitext.json").write_text(
        json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"got {len(out)} chapters: {min(out)}..{max(out)}")


if __name__ == "__main__":
    main()
