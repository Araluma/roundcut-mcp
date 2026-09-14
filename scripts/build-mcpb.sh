#!/bin/bash
# Builds build/roundcut-mcp-<version>.mcpb, the bundle Smithery distributes.
# Only macOS arm64 and Windows x64: Smithery caps a bundle at 25 MB and each platform's libvips
# adds ~8 MB compressed, so a third platform does not fit. Linux users install from npm.
# The macOS and Windows sharp binaries are fetched with `npm pack`, since npm refuses to install
# packages for another OS. Run as the repo owner: sudo -u claude bash scripts/build-mcpb.sh
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
MCPB_CLI="@anthropic-ai/mcpb@2.1.2"
SMITHERY_MAX_BYTES=26214400
BUNDLED_PLATFORMS="darwin-arm64 win32-x64"

VERSION=$(node -p "require('$REPO/package.json').version")
SHARP_PKG="$REPO/node_modules/sharp/package.json"
SHARP_VERSION=$(node -p "require('$SHARP_PKG').version")
LIBVIPS_VERSION=$(node -p "require('$SHARP_PKG').optionalDependencies['@img/sharp-libvips-darwin-arm64']")
OUT="$REPO/build/roundcut-mcp-$VERSION.mcpb"
STAGE=$(mktemp -d /tmp/roundcut-mcpb-stage-XXXX)
PACKS=$(mktemp -d /tmp/roundcut-mcpb-packs-XXXX)

(cd "$REPO" && npm run build >/dev/null)
cp -r "$REPO/dist" "$REPO/package.json" "$REPO/package-lock.json" "$REPO/README.md" "$REPO/LICENSE" "$STAGE/"
cp "$REPO/mcpb/.mcpbignore" "$REPO/mcpb/icon.png" "$STAGE/"
node -e '
  const fs = require("fs");
  const [src, dst, version] = process.argv.slice(1);
  const m = JSON.parse(fs.readFileSync(src, "utf8"));
  m.version = version;
  fs.writeFileSync(dst, JSON.stringify(m, null, 2) + "\n");
' "$REPO/mcpb/manifest.json" "$STAGE/manifest.json" "$VERSION"

(cd "$STAGE" && npm ci --omit=dev --ignore-scripts >/dev/null 2>&1)

extract_img_package() {
  local spec=$1 name=${1%@*} tarball
  tarball=$(cd "$PACKS" && npm pack -q "@img/$spec" | tail -1)
  mkdir -p "$STAGE/node_modules/@img/$name"
  tar -xzf "$PACKS/$tarball" -C "$STAGE/node_modules/@img/$name" --strip-components=1
}
extract_img_package "sharp-darwin-arm64@$SHARP_VERSION"
extract_img_package "sharp-libvips-darwin-arm64@$LIBVIPS_VERSION"
extract_img_package "sharp-win32-x64@$SHARP_VERSION"  # libvips ships inside the win32 package

mkdir -p "$REPO/build"
(cd "$STAGE" && npx -y "$MCPB_CLI" validate manifest.json >/dev/null)
(cd "$STAGE" && npx -y "$MCPB_CLI" pack . "$OUT" | grep -E 'package size|shasum')

# Guard the two things a silent mistake would break: the size cap and the platform binaries.
BYTES=$(stat -c %s "$OUT")
[ "$BYTES" -lt "$SMITHERY_MAX_BYTES" ] || { echo "bundle is $BYTES bytes, over Smithery's 25 MB cap"; exit 1; }
FOUND=$(unzip -Z1 "$OUT" | sed -n 's#^node_modules/@img/sharp-\([a-z0-9-]*\)/lib/sharp-.*\.node$#\1#p' | sort | tr '\n' ' ')
EXPECTED=$(echo "$BUNDLED_PLATFORMS" | tr ' ' '\n' | sort | tr '\n' ' ')
[ "$FOUND" = "$EXPECTED" ] || { echo "native binaries are [$FOUND], expected [$EXPECTED]"; exit 1; }

echo "ok: $OUT ($BYTES bytes, platforms: $FOUND)"
echo "staging left in $STAGE and $PACKS (tmp, cleaned by the OS)"
