#!/bin/bash
# Lexica deploy — run this ON PythonAnywhere instead of the three commands by hand.
#   bash ~/bible-db/scripts/deploy.sh
#
# It pulls the latest code, runs the invariant tests (no database needed), and
# only reloads the live site if everything passed. A broken build never goes live.
set -e

cd ~/bible-db

echo "==> Pulling latest code..."
git pull

echo "==> Running invariant tests..."
python3 tests/test_strongs_join.py >/dev/null
python3 tests/test_build_invariants.py >/dev/null
echo "    tests passed."

# Load the non-canonical texts (Apostolic Fathers, apocrypha, pseudepigrapha, etc.).
# Each loader only rebuilds its OWN <book>_words/<book>_verses tables and is safe to
# re-run, so this just keeps every book current — no need to run them by hand when a
# new book is added. A loader hiccup warns but does NOT block the site reload.
echo "==> Loading non-canonical books..."
set +e
for loader in \
    scripts/apocrypha/load_apocrypha.py \
    scripts/apocrypha/load_pseudepigrapha.py \
    scripts/apfathers/load_apfathers.py \
    scripts/enoch/load_enoch.py \
    scripts/didache_proof/load_didache.py ; do
  if [ -f "$loader" ]; then
    if python3 "$loader" bible.db >/dev/null 2>&1 ; then
      echo "    ok: $loader"
    else
      echo "    WARNING: $loader failed (skipped)"
    fi
  fi
done
set -e

echo "==> Reloading the live site..."
touch /var/www/appssanding720_pythonanywhere_com_wsgi.py

echo "==> Done. Site reloaded."
echo "    (Reminder: after a words-table REBUILD, run health_check.py by hand —"
echo "     it needs the real database and isn't part of this deploy.)"
