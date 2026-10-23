#!/usr/bin/env bash
# Starts throwaway Wallos and Actual Budget containers on localhost.
# Creates no accounts and writes no credentials.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$here/docker-compose.test.yml"
wallos_url="http://localhost:8282"
actual_url="http://localhost:5006"

command -v docker >/dev/null 2>&1 || { echo "docker is not installed" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker daemon is not running" >&2; exit 1; }

mkdir -p "$here/.local/wallos/db" "$here/.local/wallos/logos" "$here/.local/actual"

docker compose -f "$compose_file" up -d

wait_for() {
  local name="$1" url="$2" code=""
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    case "$code" in 2??|3??) echo "$name ready (HTTP $code)"; return 0 ;; esac
    sleep 2
  done
  echo "$name did not become ready within 60 seconds (last HTTP ${code:-none})" >&2
  return 1
}

failed=0
wait_for Wallos "$wallos_url" || failed=1
wait_for Actual "$actual_url" || failed=1

cat <<MSG

Wallos:        $wallos_url
Actual Budget: $actual_url

Next steps:
  1. Open each URL in the browser and create the Wallos account and the Actual
     password and budget yourself. Add test subscriptions and schedules.
  2. In Wallos, generate an API key in your profile.
  3. Start Walley (npm run dev) and enter the URLs and credentials in Settings.
     Container-to-host note: if Walley runs in Docker, use host.docker.internal.

Stop with test/stop-test-env.sh (add --wipe to delete data).
MSG
exit "$failed"
