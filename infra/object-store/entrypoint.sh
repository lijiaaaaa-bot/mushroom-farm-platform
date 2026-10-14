#!/bin/sh
set -eu
if [ "$#" -eq 0 ]; then
  exec /usr/local/bin/silo server /data --console-address ":9001"
fi
exec /usr/local/bin/silo "$@"
