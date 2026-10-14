#!/bin/sh
# Brings the database schema up to date, then starts the API (or whatever command was given).
# SEED_DEMO=true loads the "Bar Restaurant Las Vegas" demo, but only into an empty database:
# restarting the container never touches existing data.
set -e

node dist/db/cli.js migrate

if [ "$SEED_DEMO" = "true" ]; then
  node dist/db/cli.js demo
fi

exec "$@"
