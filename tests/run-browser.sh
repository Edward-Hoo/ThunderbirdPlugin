#!/usr/bin/env bash
# Runs the headless-Chrome dashboard tests. Usage: tests/run-browser.sh
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8765}
PROFILE=$(mktemp -d)
python3 tests/server.py "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$PROFILE"' EXIT
sleep 0.7
status=0
for page in "dashboard.test.html" "dashboard.test.html?tab=person&person=jane%40example.com" "dashboard.test.html?tab=activity" "dashboard.test.html?tab=bogus&x=%3Cscript%3E" "crypto.test.html"; do
  case "$page" in crypto*) timing="" ;; *) timing="--virtual-time-budget=120000" ;; esac
  out=$(timeout 90 google-chrome --headless=new --disable-gpu --no-first-run --user-data-dir="$PROFILE" \
    $timing --dump-dom "http://127.0.0.1:$PORT/tests/browser/$page" 2>/dev/null \
    | python3 -c 'import sys,re,html; m=re.search(r"<pre id=\"result\">(.*?)</pre>", sys.stdin.read(), re.S); print(html.unescape(m.group(1)) if m else "NO RESULT")')
  echo "== $page"
  echo "$out"
  case "$out" in *PASSED*) ;; *) status=1 ;; esac
done
exit $status
