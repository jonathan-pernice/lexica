#!/usr/bin/env python3
"""Clear cached Library reading-pane summaries (book blurbs + chapter summaries).

Run this on PA after changing the summary system prompt in views_summary.py —
those summaries are cached (and deliberately survive code-version bumps), so old
text keeps showing until the cached rows are removed. Reloading the site clears
the in-memory copy; this clears the saved copy.

Safe: only deletes rows whose key starts with 'summary_' — leaves the AI search
and cross-reference caches untouched. They simply regenerate on next view.

Usage:
    python3 scripts/clear_summary_cache.py bible.db
"""
import sqlite3
import sys

if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(1)

conn = sqlite3.connect(sys.argv[1])
cur = conn.execute("DELETE FROM ai_search_cache WHERE query LIKE 'summary\\_%' ESCAPE '\\'")
conn.commit()
print(f"Cleared {cur.rowcount} cached summary rows. Reload the site to refresh in-memory.")
conn.close()
