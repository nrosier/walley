# Walley

Walley is a multi-user web app that keeps recurring subscriptions in sync between [Wallos](https://github.com/ellite/Wallos) and [Actual Budget](https://actualbudget.org). It matches Wallos subscriptions to Actual Budget schedules, flags drift between them, and creates the missing side in either direction.

Each user connects their own Wallos and Actual Budget instances. Credentials are encrypted at rest.

> **Status:** early development. The server, database, secret encryption and the web shell run. Sign-in (M3) and the sync features are not built yet, so there is no sign-in or sync screen to use.

## Features

- Match Wallos subscriptions with Actual Budget schedules, automatically by saved pairs and by suggestion from name and amount.
- Detect mismatches on a manual sync check and resolve them: overwrite either side, ignore the difference, or unlink.
- Create an Actual schedule from a Wallos subscription, or a Wallos subscription from an Actual schedule, with the fields pre-filled.
- Convert multi-currency prices to the Actual Budget base currency.
- Light and dark themes, with dark as the default.

## Requirements

- Node.js 24.7 or later
- npm
- A Wallos instance with API access and an API key
- An Actual Budget server with a budget and either its password or sync key

## Getting started

These commands run the app locally. `npm run dev` starts the API and the Vite dev server together.

```bash
npm ci
cp .env.example .env   # then set APP_SECRET, PUBLIC_ORIGIN and DATABASE_PATH
npm run dev
```

The dev server starts the Fastify backend and the Vite frontend. Open the URL that Vite prints.

Local development needs `PUBLIC_ORIGIN=http://127.0.0.1:5173`, the Vite dev server origin.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the backend and the Vite dev server |
| `npm run build` | Build the backend and the frontend |
| `npm test` | Run the test suite |
| `npm run lint` | Lint the source |
| `npx tsc --noEmit` | Type check without emitting files |
| `npm run typecheck` | Type check every folder with its own tsconfig |

## Configuration

Copy `.env.example` to `.env` and set the values below. Walley refuses to start if a required variable is missing, if `APP_SECRET` is shorter than 32 characters, or if only some of the four OIDC variables are set.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `APP_SECRET` | Yes | none | Master key for deriving per-user encryption keys. Use at least 32 random characters. |
| `DATABASE_PATH` | Yes | none | Path to the SQLite file, for example `./data/walley.db`. Walley creates the parent folder and the file, and runs the database migrations at start |
| `PUBLIC_ORIGIN` | Yes | none | Required. Public origin of Walley, for example `https://walley.example.com`. Use https, or http only for `localhost`, `127.0.0.1` or `[::1]`. No path, query, fragment, credentials or trailing dot. |
| `PORT` | No | `3000` | Port to listen on, an integer from 1 to 65535 |
| `HOST` | No | `127.0.0.1` | Address to bind. Docker deployments set `0.0.0.0` in compose. |
| `ALLOW_REGISTRATION` | No | `false` | Set to `true` to allow new accounts. In local mode this opens the register form. In OIDC mode it lets a first single sign-on create an account. |
| `NODE_ENV` | No | unset | Set to `production` to serve the built web app from `dist/web`. Any other value, or none, serves the API only. Use it for built or Docker runs. |
| `TRUST_PROXY` | No | none | Comma-separated IP addresses or CIDR ranges of the reverse proxies in front of Walley. Leave unset when Walley is reached directly. List only the addresses of those proxies, never a client network. The proxy must append the real client address to `X-Forwarded-For`, or overwrite it. Walley trusts the entry added by the nearest untrusted hop. Any client inside a trusted range can forge its address and get past the per-IP rate limit. Ranges need an IPv4 prefix of at least /8 or an IPv6 prefix of at least /32, no zone IDs (`%`), and no host bits (write `10.0.0.0/8`, not `10.0.0.1/8`). |
| `OIDC_ISSUER` | All four or none | none | OIDC issuer URL. It must use `https`; `http` is allowed only for `localhost`, `127.0.0.1` or `[::1]`. Setting all four OIDC variables turns on OIDC mode and turns off password login. |
| `OIDC_CLIENT_ID` | All four or none | none | OIDC client ID |
| `OIDC_CLIENT_SECRET` | All four or none | none | OIDC client secret |
| `OIDC_CALLBACK_URL` | All four or none | none | OIDC callback URL registered with your identity provider. The path must be `/api/auth/oidc/callback`, and its origin must match `PUBLIC_ORIGIN`. |
| `WALLEY_HOSTNAME` | Compose only | none | Public hostname for the Traefik route and the Cloudflare tunnel. Read by `compose.yml`, not by Walley. |
| `DOCKFLARE_SERVICE` | Compose only | none | Origin URL that DockFlare points the tunnel at, for example `https://<traefik LAN IP>`. Read by `compose.yml`, not by Walley. |

Upgrading: this version requires `PUBLIC_ORIGIN`. Walley exits at startup if it is missing or invalid. Set it before you start the new version.

For Docker, copy `compose.example.yml` to `compose.yml`, then fill in `.env`, including the compose-only `WALLEY_HOSTNAME` and `DOCKFLARE_SERVICE`. `compose.yml` is git-ignored, so your hostnames stay out of the repo.

### Sign-in modes

Walley uses one of two sign-in modes, depending on the OIDC variables.

- **Local mode** (no OIDC variables set): people sign in with an email and password. New accounts can register only when `ALLOW_REGISTRATION` is `true`.
- **OIDC mode** (all four OIDC variables set): single sign-on is the only way in. Password login, registration and password change are turned off. A first sign-on creates a new account only when `ALLOW_REGISTRATION` is `true`.

Registration is off by default. Turn it on only for an instance you trust, or to create the first account and then turn it off again.

**Moving from local mode to OIDC mode.** An existing account is linked on its first single sign-on if your identity provider reports the same email address as verified. The account keeps its saved connections and matches. Accounts that are not linked cannot sign in until the email addresses match. Password sessions end when Walley restarts in OIDC mode.

**Warning: account takeover risk.** In OIDC mode, a sign-in whose ID token has `email_verified: true` and whose email matches an existing local account (case-insensitive) is linked to that account and signed in. This includes accounts created through local registration. Review existing local accounts before you enable OIDC, and enable it only with an identity provider that verifies email addresses.

### Generating `APP_SECRET`

```bash
openssl rand -base64 48
```

Store `APP_SECRET` somewhere safe. If it changes, every stored Wallos key and Actual Budget password becomes unreadable, and users must enter them again.

## Connecting your accounts

1. Sign in, then open **Settings**.
2. Under **Wallos**, enter your instance URL and API key, then choose **Test Connection**.
3. Under **Actual Budget**, enter your server URL and password or sync key. Pick a budget from the list. Walley detects the base currency.
4. Under **Matching**, set the amount tolerance. The default is 5%.

Your credentials are encrypted before they are stored. They are never sent back to the browser.

## Security

- Local passwords are hashed with Argon2id. In OIDC mode, password login, registration and password change are turned off.
- Wallos API keys, Actual Budget passwords and sync keys are encrypted with AES-256-GCM. Each user's key is derived from `APP_SECRET` with HKDF-SHA256 and a per-user salt.
- Sessions use HTTP-only cookies bound to the user.
- Every query is scoped to the signed-in user.
- Login and registration rate limiting is planned, not built yet.

Do not open a public issue for a security problem. Contact the maintainer directly instead.

## Project layout

```text
src/server/   Fastify backend, routes and services
src/web/      React and Vite frontend
src/lib/      Shared code, including the frequency mapper
```

## Contributing

Work is tracked as GitHub issues, grouped into milestones M1 to M9. Each issue lists its acceptance criteria. Pick an open issue in the earliest milestone that has no unresolved `needs-decision` label.

Branching rules:

- Issue and milestone work goes on a branch named after the issue, for example `issue-5-fastify-setup`, and merges to `main` through a pull request.
- Small changes that are not tied to an issue, such as docs or agent definitions, may be committed directly to `main` once the checks in the release checklist pass.

## License

MIT. See [LICENSE](LICENSE).
