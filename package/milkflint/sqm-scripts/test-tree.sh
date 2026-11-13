#!/bin/sh
# sqm-scripts as the image builds it from this package: upstream at the
# Makefile's PKG_SOURCE_VERSION, with patches/ applied in order, put in
# <dir> (emptied first). Applied without fuzz, so a patch that applies here
# applies in the build too. The upstream clone is kept in $SQM_SCRIPTS_CACHE
# (~/.cache/milkflint/sqm-scripts.git), fetched once from $SQM_SCRIPTS_GIT
# (the Makefile's PKG_SOURCE_URL unless set). For the tests of the patched
# scripts (the web interface's tests/sqm-scripts.test.ts). Not part of the
# package's build.
#
#   test-tree.sh <dir>
set -eu

out=${1:?usage: test-tree.sh <dir>}
pkg=$(cd "$(dirname "$0")" && pwd)
sha=$(sed -n 's/^PKG_SOURCE_VERSION:=//p' "$pkg/Makefile")
url=${SQM_SCRIPTS_GIT:-$(sed -n 's/^PKG_SOURCE_URL:=//p' "$pkg/Makefile")}
git=${SQM_SCRIPTS_CACHE:-$HOME/.cache/milkflint/sqm-scripts.git}

[ -d "$git" ] || { mkdir -p "$(dirname "$git")" && git clone -q --bare "$url" "$git"; }
git --git-dir="$git" cat-file -e "$sha^{commit}" 2> /dev/null || git --git-dir="$git" fetch -q "$url"
rm -rf "$out"
mkdir -p "$out"
git --git-dir="$git" archive "$sha" | tar -x -C "$out"
for p in "$pkg"/patches/*.patch; do
	[ -f "$p" ] || continue
	patch -s -p1 -F0 -d "$out" -i "$p" > /dev/null || { echo "test-tree.sh: ${p##*/} doesn't apply" >&2; exit 1; }
done
