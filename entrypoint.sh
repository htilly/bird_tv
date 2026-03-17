#!/bin/sh
set -e

# Fix ownership of data directory if mounted as root
# This handles the case where a Docker volume is created with root ownership
if [ -d /app/data ]; then
  chown -R birdcam:birdcam /app/data
fi

# Drop to birdcam user and run the app
exec gosu birdcam "$@"
