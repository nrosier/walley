# Local test environment

Throwaway Wallos and Actual Budget containers for testing Walley.
The scripts create no accounts and store no credentials. You set those up in the browser.

## Prerequisites
- Docker with the compose plugin, and a running daemon
- curl

## Start
    test/start-test-env.sh
Creates `test/.local/` if missing, starts both containers and waits up to 60 seconds for each URL.
Then create the Wallos account and the Actual budget in the browser and enter the URLs and credentials in Walley Settings.

## Stop
    test/stop-test-env.sh
Stops the containers and keeps the data.

## Wipe
    test/stop-test-env.sh --wipe
Stops the containers, then deletes `test/.local/` after a confirmation prompt.

## Ports (localhost only)
- Wallos: 8282 (container 80)
- Actual Budget: 5006 (container 5006)
- Walley dev: 5173 (web), 3000 (API), so no clash
