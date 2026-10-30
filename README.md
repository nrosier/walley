# Walley

Walley is a multi-user web app that keeps recurring subscriptions in sync between [Wallos](https://github.com/ellite/Wallos) and [Actual Budget](https://actualbudget.org). It matches Wallos subscriptions to Actual Budget schedules, flags drift between them, and creates the missing side in either direction.

Each user connects their own Wallos and Actual Budget instances. Credentials are encrypted at rest.

> **Status:** early development. Sign-in works in both modes: email and password with email verification (local), and single sign-on (OIDC). The sync features are still in progress.

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

These steps run Walley on your machine. You need Node.js 24.7 or later (see [Requirements](#requirements)).

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Create your local settings file:

   ```bash
   cp .env.example .env
   ```

3. In `.env`, set `APP_SECRET` to a random value of at least 32 characters. Generate one with Node's crypto module:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
   ```

   Paste the output after `APP_SECRET=`. See [Generating `APP_SECRET`](#generating-app_secret) before you store a real value.

4. Set `PUBLIC_ORIGIN=http://127.0.0.1:5173` (see the note below). `DATABASE_PATH` and `DATA_DIR` already have working local defaults in `.env.example`.

5. Start the app:

   ```bash
   npm run dev
   ```

Open **http://127.0.0.1:5173** in your browser. `npm run dev` runs the Fastify API (on `PORT`, default `3000`) and the Vite dev server together. Vite serves the web app and proxies `/api` to the API.

Local development needs `PUBLIC_ORIGIN=http://127.0.0.1:5173`, the Vite dev server origin. Verification links in email use `PUBLIC_ORIGIN`, so they only work when it matches the origin you open.

**To sign in on a first run**, the `.env.example` defaults are not enough: registration is off and no mail server is set. In `.env`, also set `ALLOW_REGISTRATION=true`, `ADMIN_EMAILS` to your email address, `SMTP_URL` and `MAIL_FROM`. Local registration needs a mail server, because you sign in only after you open the verification link in the email. A local mail catcher such as Mailpit or MailHog can receive that mail: point `SMTP_URL` at it with an `smtp:` URL. Your email in `ADMIN_EMAILS` may register while the Settings toggle is still off, so you can create your account before turning registration on. Then follow [First run in local mode](#first-run-in-local-mode).

With no OIDC variables set, Walley starts in local mode, where no account exists until you register. To create your first account, follow [First run in local mode](#first-run-in-local-mode). Optional: `npm test` runs the test suite.

Outside production, Walley reads `.env.local` instead of `.env` when `.env.local` exists. Keep your settings in one of them, not both.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the backend and the Vite dev server |
| `npm run build` | Build the backend and the frontend |
| `npm start` | Run the built backend from `dist/server` |
| `npm test` | Run the test suite |
| `npm run lint` | Lint the source |
| `npx tsc --noEmit` | Type check without emitting files |
| `npm run typecheck` | Type check every folder with its own tsconfig |

## Configuration

Copy `.env.example` to `.env` and set the values below. Walley refuses to start if a required variable is missing, if `APP_SECRET` is shorter than 32 characters, or if only some of the four OIDC variables are set.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `APP_SECRET` | Yes | none | Master key for deriving per-user encryption keys. Use at least 32 random characters. Generate one with the command under [Generating `APP_SECRET`](#generating-app_secret). |
| `DATABASE_PATH` | Yes | none | Path to the SQLite file, for example `./data/walley.db`. Walley creates the parent folder and the file, and runs the database migrations at start |
| `DATA_DIR` | Yes | none | Folder for per-user Actual Budget data, for example `./data`. Walley creates `actual/<userId>` under it for each user. Only one Walley process may use it. |
| `PUBLIC_ORIGIN` | Yes | none | Required. Public origin of Walley, for example `https://walley.example.com`. Use https, or http only for `localhost`, `127.0.0.1` or `[::1]`. No path, query, fragment, credentials or trailing dot. |
| `PORT` | No | `3000` | Port to listen on, an integer from 1 to 65535 |
| `HOST` | No | `127.0.0.1` | Address to bind. Docker deployments set `0.0.0.0` in compose. |
| `ALLOW_REGISTRATION` | No | `false` | The ceiling for new accounts. Must be `true` or `false`. Set to `true` to let an admin turn registration on in Settings; with `false` registration stays off whatever the setting says. In local mode this allows the register form, and requires `SMTP_URL` and `MAIL_FROM`. In OIDC mode it lets a first single sign-on create an account. See [Registration](#registration). |
| `ADMIN_EMAILS` | No | none | Comma-separated emails (case-insensitive) of the admins who can switch registration on or off in Settings. Empty means nobody can, so registration stays off. See `ALLOW_REGISTRATION`. |
| `SMTP_URL` | Local mode with registration only | none | SMTP connection URL for verification mail, for example `smtps://user:password@smtp.example.com:465`. Use `smtp:` or `smtps:`. The URL can hold credentials: keep it out of logs and version control. |
| `MAIL_FROM` | Local mode with registration only | none | From address on verification mail, for example `walley@example.com`. Use a bare address with no display name: `<`, `>`, spaces and commas are rejected. |
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

### Production run

`npm run build` builds the backend into `dist/server` and the web app into `dist/web`. `npm start` runs the built backend. Set `NODE_ENV=production` so the backend serves the built web app:

```bash
npm install
npm run build
NODE_ENV=production npm start
```

In production Walley reads `.env` only. Set `PUBLIC_ORIGIN` to the address users open, not a local one.

The `Dockerfile` builds the app with `npm run build` and runs `node dist/server/index.js` in a Node 24 image. The image sets `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `DATABASE_PATH=/data/walley.db` and `DATA_DIR=/data`. Keep `/data` on persistent storage, because it holds the database and the per-user Actual Budget data.

### Registration

Registration has two switches, and both must be on before a new account can be created:

- `ALLOW_REGISTRATION=true` in `.env` (the ceiling). Without it, no one can register, whatever the Settings toggle says.
- The **New accounts** toggle in Settings under **Account / Security**, which only an admin can change. It starts off, applies at once, and survives a restart.

Admins are the emails listed in `ADMIN_EMAILS`. Empty means nobody is an admin, so registration stays off.

**First admin on a fresh install (local mode).** Set `ALLOW_REGISTRATION=true`, `SMTP_URL`, `MAIL_FROM`, and put your email in `ADMIN_EMAILS`. While the ceiling is on, an email in `ADMIN_EMAILS` may register through the form even when the toggle is off. Register with that email, verify it, then turn registration on or off in Settings as needed. The toggle still governs every other account.

### Sign-in modes

Walley runs in one of two sign-in modes, chosen at startup from the OIDC variables. The rule is all four or none:

- **Local mode** (none of `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_CALLBACK_URL` set): people sign in with an email and password, hashed with Argon2id. New accounts can register only when `ALLOW_REGISTRATION=true`, an admin has turned registration on in Settings, and mail is configured (`SMTP_URL` and `MAIL_FROM`). Registering does not sign you in. Walley answers `202` with the same message whatever the outcome, and you must open the verification link in the email before you can sign in. The link is single-use and expires after 24 hours.
- **OIDC mode** (all four OIDC variables set): single sign-on is the only way in. Local password login, local registration and password change are disabled. A first sign-on creates a new account only when registration is effectively on (see [Registration](#registration)). The **New accounts** toggle in Settings must be on for that, because it starts off and only an admin can turn it on. Otherwise a matching verified account must already exist. Admins cannot be bootstrapped through OIDC alone: the `ADMIN_EMAILS` exception applies only to the local register form.

**All four or none.** Set all four OIDC variables, or none of them. If only some are set, Walley refuses to start and names the missing variables in its error message. It never prints their values. An empty value counts as unset.

**Linking existing accounts when OIDC is on.** On each single sign-on, Walley checks in this order:

1. A known issuer and subject signs in the user already linked to them.
2. Otherwise, if the ID token has `email_verified: true` and its email matches an existing account (case-insensitive) that has no identity at this issuer, Walley links the identity to that account and signs in. The account keeps its ID, its encryption salt, and its saved Wallos and Actual Budget settings and matches.
3. Otherwise, if `ALLOW_REGISTRATION=true` (and registration is on, see [Registration](#registration)), Walley creates a new account with no password and links the identity.
4. Otherwise sign-in is refused, and the login page says that no Walley account is linked to the identity.

An unverified local account, one whose email has not been confirmed through the verification link, has its password hash cleared when it is linked, because the hash may belong to whoever registered that address first. A verified local account keeps its hash, which is not used while OIDC mode is on.

### First run in local mode

1. In `.env`, set `APP_SECRET`, `PUBLIC_ORIGIN`, `DATABASE_PATH` and `DATA_DIR`, then set `ALLOW_REGISTRATION=true`, `SMTP_URL` and `MAIL_FROM`.
2. Start Walley with `npm run dev` (or your built or Docker setup).
3. Open the app, choose **Create an account**, and enter your email and password. The page says to check your email whatever the outcome, and it does not sign you in.
4. Open the verification link in the email. It opens `/verify-email` with the token in the URL fragment, and the page sends it to `POST /api/auth/verify-email`. The link expires after 24 hours.
5. Sign in with your email and password.
6. To close registration again, an admin (an email in `ADMIN_EMAILS`) turns it off in Settings under **Account / Security**. No restart is needed. To create the first admin on a fresh install, register with an email listed in `ADMIN_EMAILS`: while `ALLOW_REGISTRATION=true`, those emails may register even when the stored setting is off.

### OIDC provider setup

1. Register Walley as a web client with your identity provider. Walley uses client secret basic authentication and PKCE.
2. Set the redirect (callback) URL to `<PUBLIC_ORIGIN>/api/auth/oidc/callback`, for example `https://walley.example.com/api/auth/oidc/callback`.
3. Request the `openid` and `email` scopes. Walley asks for nothing else.
4. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_CALLBACK_URL` to the provider's issuer, the client ID, the client secret and the callback URL from step 2. Set all four, or none.
5. The provider must send `email_verified: true` in the ID token. Walley links a sign-in to an existing account only when the email is verified and matches that account. Without it, the sign-in is not linked to the account.

**Moving from local mode to OIDC mode.** An existing account is linked on its first single sign-on if your identity provider reports the same email address as verified. The account keeps its saved connections and matches. Accounts that are not linked cannot sign in until the email addresses match. Sessions created by the other sign-in mode stop counting once Walley runs in the new mode: a local-password session is treated as no session in OIDC mode, and an OIDC session is treated as no session in local mode.

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
- Login, registration and password change are rate limited per email and per client IP. Email verification has its own per-IP limit.

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
