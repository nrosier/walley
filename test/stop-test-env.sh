#!/usr/bin/env bash
# Stops the test containers. Data is kept unless --wipe is given.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$here/docker-compose.test.yml"
wipe=0

for arg in "$@"; do
  case "$arg" in
    --wipe) wipe=1 ;;
    *) echo "usage: $0 [--wipe]" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "docker is not installed" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker daemon is not running" >&2; exit 1; }

docker compose -f "$compose_file" down

if [ "$wipe" -eq 1 ]; then
  read -r -p "Delete all test data in $here/.local? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES) rm -rf "$here/.local"; echo "Test data removed." ;;
    *) echo "Data kept." ;;
  esac
else
  echo "Containers stopped. Data kept in $here/.local"
fi
