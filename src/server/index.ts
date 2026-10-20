import { existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

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

  const app = buildApp({ logger: true });
  app.log.info({ authMode: config.authMode }, 'auth mode');
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
