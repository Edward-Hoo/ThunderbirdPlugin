#!/usr/bin/env bash
# Packages src/ into dist/eds-mail-helper.xpi, the only file to load or install.
# It is overwritten IN PLACE (same file, new contents): Thunderbird's
# "Reload" on a temporary add-on, especially the snap version, keeps pointing at the
# exact file it loaded, so it must never be deleted or replaced by a new file.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
(cd src && zip -qr -X "$TMP/pkg.xpi" . -x '*.DS_Store')
OUT=dist/eds-mail-helper.xpi
cat "$TMP/pkg.xpi" > "$OUT"
echo "$OUT"
