import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { createOidcProvider, type OidcRuntime } from './auth/oidc.js';
import { ConfigError, loadConfig } from './config.js';
import { deriveFlowKey } from './crypto/keys.js';
import { closeDatabase, openDatabase, type AppDatabase } from './db/client.js';
import { createUserRepo } from './db/repo.js';
import { realCreateDeps } from './integrations/create.js';
import { withActualServer, withActualSession } from './integrations/actual/session.js';
import { createWallosClient } from './integrations/wallos/client.js';
import { createMailer, createSmtpTransport } from './mail/index.js';
import { registerShutdown } from './shutdown.js';

async function main(): Promise<void> {
  // Outside production, .env.local wins over .env, matching the Vite config. Production loads .env only.
  const envFile =
    process.env['NODE_ENV'] !== 'production' && existsSync('.env.local') ? '.env.local' : '.env';
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (process.env['NODE_ENV'] === 'production' && config.trustProxy === false) {
    console.warn(
      'TRUST_PROXY is not set. Walley ignores X-Forwarded-For, so behind a reverse proxy every client shares one rate-limit bucket.',
    );
  }

  let db: AppDatabase;
  try {
    db = openDatabase(config.databasePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to open database: ' + message);
    process.exitCode = 1;
    return;
  }

  const webRoot = config.serveWeb ? fileURLToPath(new URL('../web/', import.meta.url)) : undefined;
  // Creating the provider does no network I/O: discovery runs on the first login request.
  let oidc: OidcRuntime | undefined;
  if (config.authMode === 'oidc') {
    try {
      oidc = {
        provider: createOidcProvider(config.oidc),
        flowKey: deriveFlowKey(config.appSecret),
        callbackUrl: config.oidc.callbackUrl,
      };
    } catch {
      // Fixed text: never print config values.
      console.error('Failed to set up OIDC. Startup is aborted.');
      closeDatabase(db);
      process.exitCode = 1;
      return;
    }
  }

  // Only local registration sends mail; config guarantees both values then.
  const mailer =
    config.authMode === 'local' &&
    config.allowRegistration &&
    config.smtpUrl !== null &&
    config.mailFrom !== null
      ? createMailer({ transport: createSmtpTransport(config.smtpUrl), from: config.mailFrom })
      : undefined;

  const repoFor = (id: string) => createUserRepo(db, id);
  const wallos = createWallosClient(repoFor, config.appSecret);
  const actualDeps = { db, appSecret: config.appSecret, dataDir: config.dataDir };
  let app;
  try {
    app = buildApp({
      logger: true,
      webRoot,
      db,
      trustProxy: config.trustProxy,
      integrations: realCreateDeps(wallos, repoFor, actualDeps),
      settings: {
        repoFor,
        wallos,
        appSecret: config.appSecret,
        actual: {
          withActualServer: (userId, use) => withActualServer(actualDeps, userId, use),
          withActual: (userId, use) => withActualSession(actualDeps, userId, use),
        },
      },
      auth: {
        mode: config.authMode,
        secureCookies: config.secureCookies,
        allowRegistration: config.allowRegistration,
        adminEmails: config.adminEmails,
        publicOrigin: config.publicOrigin,
        ...(oidc === undefined ? {} : { oidc }),
        ...(mailer === undefined ? {} : { mailer }),
      },
    });
  } catch (error: unknown) {
    closeDatabase(db);
    throw error;
  }
  app.addHook('onClose', () => {
    closeDatabase(db);
  });
  registerShutdown(app);
  app.log.info({ authMode: config.authMode, serveWeb: config.serveWeb }, 'starting');
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error: unknown) {
    app.log.error(error);
    process.exitCode = 1;
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
