#!/bin/sh
set -eu

# Railway mounts volumes as root; only initialize the private state directory.
if [ "${RAILWAY_VOLUME_MOUNT_PATH:-}" != /var/lib/machination ]; then
  echo 'Attach the persistent Railway volume at /var/lib/machination before starting.' >&2
  exit 1
fi
if [ "${MACHINATION_DATA:-}" != /var/lib/machination/state/games.json ]; then
  echo 'MACHINATION_DATA must point to /var/lib/machination/state/games.json.' >&2
  exit 1
fi
mkdir -p /var/lib/machination/state
chown node:node /var/lib/machination/state
chmod 700 /var/lib/machination/state
if [ -f "$MACHINATION_DATA" ]; then
  chown node:node "$MACHINATION_DATA"
  chmod 600 "$MACHINATION_DATA"
fi
exec gosu node "$@"
