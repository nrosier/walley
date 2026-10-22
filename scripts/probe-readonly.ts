/**
 * READ-ONLY probe of a real Wallos and a real Actual Budget instance. It must never write.
 * Allowed: Wallos get_subscriptions.php and get_currencies.php (POST, api_key form field);
 * Actual init, downloadBudget, getSchedules, getAccounts, getPayees, getCategories,
 * getPreferences, shutdown. Never call sync(), create*, update*, delete*, set* or rule methods.
 * Output is counts, the base currency code and Wallos field names/types only: no secrets,
 * URLs, names or amounts. Actual's cache goes to a scratch dir outside the repo.
 *
 * Run: npx tsx scripts/probe-readonly.ts [env-file]   (default ./probe.env, git-ignored)
 */
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as actual from '@actual-app/api';

const REQUIRED = [
  'WALLOS_URL',
  'WALLOS_API_KEY',
  'ACTUAL_SERVER_URL',
  'ACTUAL_PASSWORD',
  'ACTUAL_SYNC_ID',
] as const;

function loadEnv(): void {
  const file = process.argv[2] ?? './probe.env';
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing or unreadable file: fall through to the per-variable check.
  }
  const missing = REQUIRED.filter((name) => (process.env[name] ?? '') === '');
  if (missing.length > 0) {
    console.error(`Missing required variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function env(name: (typeof REQUIRED)[number]): string {
  return process.env[name] ?? '';
}

async function wallosPost(path: string): Promise<Record<string, unknown>> {
  const url = new URL(env('WALLOS_URL').trim());
  url.pathname = url.pathname.replace(/\/+$/, '') + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ api_key: env('WALLOS_API_KEY') }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  const body: unknown = await res.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('unexpected response shape');
  }
  const obj = body as Record<string, unknown>;
  if (obj['success'] !== true) throw new Error('success was not true');
  return obj;
}

function listOf(body: Record<string, unknown>, key: string): unknown[] {
  const value = body[key];
  if (!Array.isArray(value)) throw new Error(`"${key}" is not a list`);
  return value as unknown[];
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

async function probeWallos(): Promise<void> {
  try {
    const subs = listOf(await wallosPost('/api/subscriptions/get_subscriptions.php'), 'subscriptions');
    const currencies = listOf(await wallosPost('/api/currencies/get_currencies.php'), 'currencies');
    console.log(`wallos subscriptions: ${String(subs.length)}`);
    console.log(`wallos currencies: ${String(currencies.length)}`);
    const first = subs[0];
    if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
      const fields = Object.entries(first).map(([k, v]) => `${k}:${typeName(v)}`);
      console.log(`wallos first subscription fields: ${fields.join(', ')}`);
    }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown';
    console.error(`wallos probe failed (${reason})`);
    process.exitCode = 1;
  }
}

async function probeActual(): Promise<void> {
  const dataDir = join(tmpdir(), 'walley-probe-actual');
  await mkdir(dataDir, { recursive: true });
  let opened = false;
  try {
    await actual.init({
      dataDir,
      serverURL: env('ACTUAL_SERVER_URL'),
      password: env('ACTUAL_PASSWORD'),
    });
    opened = true;
    const e2e = process.env['ACTUAL_E2E_PASSWORD'];
    await actual.downloadBudget(
      env('ACTUAL_SYNC_ID'),
      e2e === undefined || e2e === '' ? undefined : { password: e2e },
    );
    const schedules = await actual.getSchedules();
    const accounts = await actual.getAccounts();
    const payees = await actual.getPayees();
    const categories = await actual.getCategories();
    const prefs: Record<string, unknown> = { ...(await actual.getPreferences()) };
    const code = prefs['defaultCurrencyCode'];
    console.log(`actual schedules: ${String(schedules.length)}`);
    console.log(`actual accounts: ${String(accounts.length)}`);
    console.log(`actual payees: ${String(payees.length)}`);
    console.log(`actual categories: ${String(categories.length)}`);
    console.log(
      `actual base currency: ${typeof code === 'string' && code !== '' ? code : '(not set)'}`,
    );
  } catch {
    console.error(`actual probe failed (${opened ? 'read' : 'open'} step; details withheld)`);
    process.exitCode = 1;
  }
  if (opened) {
    try {
      await actual.shutdown();
    } catch {
      console.error('actual shutdown failed');
      process.exitCode = 1;
    }
  }
}

loadEnv();
await probeWallos();
await probeActual();
