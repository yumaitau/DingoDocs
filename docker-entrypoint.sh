#!/bin/sh
set -eu

if [ ! -f /app/dist/enforce-marketplace-license.cjs ]; then
  echo "DingoDocs shutting down because Marketplace licensing could not be maintained" >&2
  echo "reason=enforcer_missing" >&2
  exit 1
fi

# migrate.cjs performs its own entitlement check and returns its contract seat.
if [ "${1:-}" = "node" ] && [ "${2:-}" = "dist/migrate.cjs" ]; then
  exec "$@"
fi

node /app/dist/enforce-marketplace-license.cjs
exec "$@"
