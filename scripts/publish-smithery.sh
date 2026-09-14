#!/bin/bash
# Publishes build/roundcut-mcp-<version>.mcpb to Smithery as araluma/roundcut-mcp.
# Goes straight to the release API instead of `smithery mcp publish`: the CLI copies the manifest's
# tools into the server card, and a manifest carrying the inputSchema Smithery requires fails the
# mcpb validator. The payload is built from the running server (scripts/smithery-payload.mjs).
# Key: SMITHERY_API_KEY, or /root/.config/smithery/api-key (root only).
# Usage: sudo -u claude bash scripts/build-mcpb.sh && sudo bash scripts/publish-smithery.sh
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
API="https://api.smithery.ai/servers/araluma%2Froundcut-mcp"
KEY_FILE=/root/.config/smithery/api-key
# sharp needs Node >=20; a bare `node` under sudo resolves to the apt Node 18 on this box.
NODE=${NODE:-/opt/node22/bin/node}

VERSION=$("$NODE" -p "require('$REPO/package.json').version")
BUNDLE="$REPO/build/roundcut-mcp-$VERSION.mcpb"
[ -f "$BUNDLE" ] || { echo "missing $BUNDLE: run scripts/build-mcpb.sh first"; exit 1; }
KEY=${SMITHERY_API_KEY:-$(tr -d '\n\r ' < "$KEY_FILE")}

PAYLOAD=$(mktemp)
trap 'rm -f "$PAYLOAD"' EXIT
"$NODE" "$REPO/scripts/smithery-payload.mjs" "$REPO/dist/index.js" "$VERSION" > "$PAYLOAD"

echo "publishing roundcut-mcp $VERSION"
curl -sS --fail-with-body --max-time 300 -X PUT -H "Authorization: Bearer $KEY" \
  -F "payload=<$PAYLOAD;type=application/json" \
  -F "bundle=@$BUNDLE;type=application/octet-stream;filename=server.mcpb" \
  "$API/releases"
echo
curl -sS --fail-with-body -X PUT -H "Authorization: Bearer $KEY" \
  -F "icon=@$REPO/mcpb/icon.png;type=image/png" "$API/icon" >/dev/null
echo "listing: https://smithery.ai/servers/araluma/roundcut-mcp"
