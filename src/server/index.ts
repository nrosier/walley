import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
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

  const webRoot = config.serveWeb ? fileURLToPath(new URL('../web/', import.meta.url)) : undefined;
  const app = buildApp({ logger: true, webRoot });
  registerShutdown(app);
  app.log.info({ authMode: config.authMode, serveWeb: config.serveWeb }, 'starting');
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error: unknown) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
