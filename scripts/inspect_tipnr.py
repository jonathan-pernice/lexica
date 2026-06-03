"""Inspect TIPNR file format — run on PythonAnywhere to see first 80 lines."""
import urllib.request

URL = (
    "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/"
    "Proper%20Nouns/TIPNR%20-%20Translators%20Individualised%20Proper%20Names"
    "%20with%20all%20References%20-%20STEPBible.org%20CC%20BY.txt"
)

print("Fetching TIPNR...")
with urllib.request.urlopen(URL) as r:
    content = r.read().decode("utf-8-sig")  # handle BOM if present

lines = content.splitlines()
print(f"Total lines: {len(lines)}\n")

for i, line in enumerate(lines[:80]):
    print(f"{i:4}: {line[:140]}")
