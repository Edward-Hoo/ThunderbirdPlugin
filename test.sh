#!/usr/bin/env bash
# Runs every automated check from README §11.
set -u
cd "$(dirname "$0")"
status=0
echo "## Static check (call sites, forbidden APIs)"; python3 tests/static-check.py || status=1
echo; echo "## Unit + background tests (gjs)"; gjs -m tests/unit.test.js || status=1
echo; echo "## Dashboard + crypto tests (headless Chrome)"; tests/run-browser.sh || status=1
echo; echo "## End-to-end in a real, separate headless Thunderbird"; ./build.sh >/dev/null && python3 tests/e2e/run.py || status=1
echo; [ $status = 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $status
