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

echo "==> Reloading the live site..."
touch /var/www/appssanding720_pythonanywhere_com_wsgi.py

echo "==> Done. Site reloaded."
echo "    (Reminder: after a words-table REBUILD, run health_check.py by hand —"
echo "     it needs the real database and isn't part of this deploy.)"
