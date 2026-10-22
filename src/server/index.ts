import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { closeDatabase, openDatabase, type AppDatabase } from './db/client.js';
import { registerShutdown } from './shutdown.js';

async function main(): Promise<void> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
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
  let app;
  try {
    app = buildApp({
      logger: true,
      webRoot,
      db,
      trustProxy: config.trustProxy,
      auth: {
        mode: config.authMode,
        secureCookies: config.secureCookies,
        allowRegistration: config.allowRegistration,
        publicOrigin: config.publicOrigin,
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
