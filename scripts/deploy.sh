#!/bin/bash
# Lexica deploy — run this ON PythonAnywhere instead of the three commands by hand.
#   bash ~/bible-db/scripts/deploy.sh
#
# It pulls the latest code, runs the invariant tests (no database needed), and
# only reloads the live site if everything passed. A broken build never goes live.
set -e

cd ~/bible-db

echo "==> Pulling latest code..."
before=$(git rev-parse HEAD)
git pull
after=$(git rev-parse HEAD)
changed=$(git diff --name-only "$before" "$after")

echo "==> Running invariant tests..."
python3 tests/test_strongs_join.py >/dev/null
python3 tests/test_build_invariants.py >/dev/null
echo "    tests passed."

# Load non-canonical texts ONLY when this pull changed their files (a new book, or a
# fix to a book's text). The data already lives in the database between deploys, so
# re-loading unchanged books is just busywork. Each loader rebuilds only its OWN
# <book>_words/<book>_verses tables; a hiccup warns but never blocks the reload.
echo "==> Checking for changed non-canonical books..."
set +e
run_if_changed() {  # $1 = folder to watch; rest = loaders to run if anything there changed
  local prefix="$1"; shift
  echo "$changed" | grep -q "^$prefix" || return 0
  for loader in "$@"; do
    [ -f "$loader" ] || continue
    if python3 "$loader" bible.db >/dev/null 2>&1 ; then
      echo "    ok: $loader"
    else
      echo "    WARNING: $loader failed (skipped)"
    fi
  done
}
run_if_changed "scripts/apocrypha/"     scripts/apocrypha/load_apocrypha.py scripts/apocrypha/load_pseudepigrapha.py
run_if_changed "scripts/apfathers/"     scripts/apfathers/load_apfathers.py
run_if_changed "scripts/enoch/"         scripts/enoch/load_enoch.py
run_if_changed "scripts/didache_proof/" scripts/didache_proof/load_didache.py
[ -z "$changed" ] && echo "    (no code pulled — nothing to load)"
set -e

echo "==> Reloading the live site..."
touch /var/www/www_lexica_bible_wsgi.py

echo "==> Done. Site reloaded."
echo "    (Reminder: after a words-table REBUILD, run health_check.py by hand —"
echo "     it needs the real database and isn't part of this deploy.)"
