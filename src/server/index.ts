import { buildApp } from './app.js';

async function main(): Promise<void> {
  const app = buildApp({ logger: true });
  await app.listen({ port: 3000, host: '127.0.0.1' });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
