#!/bin/bash
# Run the sync server on this computer for testing (no Docker).
# Creates server/.env with a random SYNC_KEY on first run, then starts on port 8787.
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "SYNC_KEY=$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')" > .env
  echo "Created server/.env with a new SYNC_KEY."
fi
set -a; . ./.env; set +a
[ -d node_modules ] || npm install
echo "Server URL: http://localhost:${PORT:-8787}"
echo "Sync key:   $SYNC_KEY"
exec node index.js
