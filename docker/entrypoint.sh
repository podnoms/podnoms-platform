#!/bin/sh
set -eu

node /app/migrate.mjs

exec "$@"
