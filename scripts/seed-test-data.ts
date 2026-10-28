/**
 * Seeds the local TEST containers (walley-test-wallos and walley-test-actual) with the coverage set
 * in scripts/seed/coverage.ts (issue 119). It never touches a real account: the guard in
 * scripts/seed/guard.ts refuses any URL other than the test containers, before any request.
 *
 * Settings come from the git-ignored file .env.test (format `KEY: value`): WALLOS_URL, WALLOS_API,
 * ACTUAL_URL, ACTUAL_PASSWORD, and optionally ACTUAL_BUDGET_ID (needed only when the Actual server
 * holds more than one budget) and ACTUAL_SYNC_KEY. No value is printed.
 *
 * Repeatable: every seeded Wallos subscription, Actual schedule and payee name starts with the tag
 * "[seed]". An item is looked up by its tagged name and created only when missing. An existing item
 * is updated only when its amount or start date (or currency, interval, inactive flag) differs from
 * the seed, and the difference is reported. A drifted Wallos next payment is reported only: Wallos
 * moves it forward by itself. Items without the tag are never changed.
 *
 * Run: npx tsx scripts/seed-test-data.ts --dry-run   (reads both instances, writes nothing)
 *      npx tsx scripts/seed-test-data.ts             (writes)
 *      npm run seed:test-data -- --dry-run
 */
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as actual from '@actual-app/api';
import { currencyExponent } from '../src/lib/currency-exponent.js';
import { wallosToActual } from '../src/lib/frequency-mapper.js';
import { priceToMinorUnits } from '../src/server/integrations/wallos/create-fields.js';
import {
  WALLOS_CYCLE_DAILY,
  WALLOS_CYCLE_MONTHLY,
  WALLOS_CYCLE_WEEKLY,
  WALLOS_CYCLE_YEARLY,
} from '../src/server/integrations/wallos/map.js';
import {
  COVERAGE_CATEGORIES,
  SEED_ITEMS,
  seedName,
  type SeedItem,
} from './seed/coverage.js';
import { missingKeys, parseEnvFile } from './seed/env.js';
import { assertTestInstances, SeedGuardError } from './seed/guard.js';

const REQUIRED_KEYS = ['WALLOS_URL', 'WALLOS_API', 'ACTUAL_URL', 'ACTUAL_PASSWORD'] as const;
const REQUEST_TIMEOUT_MS = 20_000;

type Outcome = 'create' | 'exists' | 'update' | 'skip';

interface Result {
  readonly item: SeedItem;
  readonly outcome: Outcome;
  /** Names of the fields that differ (update), or the reason (skip). Never values. */
  readonly detail: string;
}

/** A fixed-message failure: the underlying error, URL and response body are never printed. */
class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

// ---------------------------------------------------------------------------------------------
// Settings

interface Settings {
  readonly wallosOrigin: string;
  readonly wallosKey: string;
  readonly actualOrigin: string;
  readonly actualPassword: string;
  readonly actualBudgetId: string | undefined;
  readonly actualSyncKey: string | undefined;
}

async function loadSettings(path: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new SeedError('The test env file could not be read (default: .env.test in the repo root).');
  }
  const env = parseEnvFile(text);
  const missing = missingKeys(env, REQUIRED_KEYS);
  if (missing.length > 0) throw new SeedError(`The test env file lacks: ${missing.join(', ')}.`);
  // The guard runs on the raw URLs, before any request is made.
  const { wallosOrigin, actualOrigin } = assertTestInstances({
    wallosUrl: env.get('WALLOS_URL') ?? '',
    actualUrl: env.get('ACTUAL_URL') ?? '',
  });
  const optional = (key: string): string | undefined => {
    const value = env.get(key);
    return value === undefined || value === '' ? undefined : value;
  };
  return {
    wallosOrigin,
    wallosKey: env.get('WALLOS_API') ?? '',
    actualOrigin,
    actualPassword: env.get('ACTUAL_PASSWORD') ?? '',
    actualBudgetId: optional('ACTUAL_BUDGET_ID'),
    actualSyncKey: optional('ACTUAL_SYNC_KEY'),
  };
}

// ---------------------------------------------------------------------------------------------
// Wallos

type Json = Record<string, unknown>;

async function wallosPost(settings: Settings, path: string, fields: Record<string, string> = {}): Promise<Json> {
  const form = new URLSearchParams({ ...fields, api_key: settings.wallosKey });
  let response: Response;
  try {
    response = await fetch(new URL(path, settings.wallosOrigin), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SeedError('Wallos could not be reached.');
  }
  if (!response.ok) throw new SeedError(`Wallos answered HTTP ${String(response.status)} for ${path}.`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SeedError(`Wallos sent a non-JSON answer for ${path}.`);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new SeedError(`Wallos sent an unexpected answer for ${path}.`);
  }
  const json = body as Json;
  if (json['success'] !== true) {
    const title = typeof json['title'] === 'string' ? json['title'] : 'no reason given';
    throw new SeedError(`Wallos refused ${path}: ${title}.`);
  }
  return json;
}

function listOf(json: Json, key: string): Json[] {
  const value = json[key];
  if (!Array.isArray(value)) throw new SeedError(`Wallos did not send a "${key}" list.`);
  return value.filter((entry): entry is Json => typeof entry === 'object' && entry !== null);
}

const WALLOS_CYCLE: Readonly<Record<SeedItem['interval']['type'], number>> = {
  custom_days: WALLOS_CYCLE_DAILY,
  weekly: WALLOS_CYCLE_WEEKLY,
  monthly: WALLOS_CYCLE_MONTHLY,
  yearly: WALLOS_CYCLE_YEARLY,
};

function cycleOf(item: SeedItem): { cycle: number; frequency: number } {
  const interval = item.interval;
  return {
    cycle: WALLOS_CYCLE[interval.type],
    frequency: interval.type === 'custom_days' ? interval.days : interval.every,
  };
}

/** Decimal string of a Wallos price in the currency's own minor units, so "9.9" equals "9.90". */
function minorOf(price: unknown, currency: string): number | null {
  if (typeof price !== 'number' && typeof price !== 'string') return null;
  const exponent = currencyExponent(currency);
  const value = Number(price);
  return Number.isFinite(value) ? Math.round(value * 10 ** exponent) : null;
}

async function seedWallos(settings: Settings, items: readonly SeedItem[], write: boolean): Promise<Result[]> {
  const currencies = listOf(await wallosPost(settings, '/api/currencies/get_currencies.php'), 'currencies');
  const currencyId = new Map<string, string>();
  for (const c of currencies) {
    if (typeof c['code'] === 'string' && (typeof c['id'] === 'number' || typeof c['id'] === 'string')) {
      currencyId.set(c['code'].trim().toUpperCase(), String(c['id']));
    }
  }
  const existing = listOf(await wallosPost(settings, '/api/subscriptions/get_subscriptions.php'), 'subscriptions');
  const byName = new Map<string, Json[]>();
  for (const sub of existing) {
    const name = sub['name'];
    if (typeof name === 'string') byName.set(name, [...(byName.get(name) ?? []), sub]);
  }

  const results: Result[] = [];
  for (const item of items) {
    const id = currencyId.get(item.currency);
    if (id === undefined) {
      results.push({ item, outcome: 'skip', detail: `currency ${item.currency} is not in Wallos` });
      continue;
    }
    const { cycle, frequency } = cycleOf(item);
    const wanted = {
      name: seedName(item.title),
      price: item.amount,
      currency_id: id,
      cycle: String(cycle),
      frequency: String(frequency),
      start_date: item.startDate,
      next_payment: item.nextPayment,
      inactive: item.inactive === true ? '1' : '0',
    };
    const found = byName.get(wanted.name) ?? [];
    if (found.length > 1) {
      results.push({ item, outcome: 'skip', detail: 'collision: several Wallos subscriptions have this name' });
      continue;
    }
    const current = found[0];
    if (current === undefined) {
      if (write) await wallosPost(settings, '/api/subscriptions/set_subscriptions.php', { ...wanted, action: 'add' });
      results.push({ item, outcome: 'create', detail: '' });
      continue;
    }
    const differs: string[] = [];
    if (minorOf(current['price'], item.currency) !== minorOf(item.amount, item.currency)) differs.push('price');
    if (String(current['currency_id']) !== id) differs.push('currency');
    if (String(current['cycle']) !== wanted.cycle || String(current['frequency']) !== wanted.frequency) {
      differs.push('interval');
    }
    if (current['start_date'] !== item.startDate) differs.push('start date');
    if ((current['inactive'] === 1 || current['inactive'] === '1' || current['inactive'] === true) !== (item.inactive === true)) {
      differs.push('inactive flag');
    }
    if (differs.length === 0) {
      // A different next payment is Wallos moving the date forward; reported, never rewritten.
      const moved = current['next_payment'] !== item.nextPayment;
      results.push({ item, outcome: 'exists', detail: moved ? 'next payment differs (not updated)' : '' });
      continue;
    }
    if (write) {
      const nextPayment = typeof current['next_payment'] === 'string' ? current['next_payment'] : item.nextPayment;
      await wallosPost(settings, '/api/subscriptions/set_subscriptions.php', {
        action: 'edit',
        id: String(current['id']),
        price: wanted.price,
        currency_id: wanted.currency_id,
        cycle: wanted.cycle,
        frequency: wanted.frequency,
        start_date: wanted.start_date,
        next_payment: nextPayment,
        inactive: wanted.inactive,
      });
    }
    results.push({ item, outcome: 'update', detail: differs.join(', ') });
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// Actual Budget

type ScheduleInput = Parameters<typeof actual.createSchedule>[0];

async function seedActual(settings: Settings, items: readonly SeedItem[], write: boolean): Promise<Result[]> {
  const dataDir = join(tmpdir(), 'walley-seed-actual');
  await mkdir(dataDir, { recursive: true });
  try {
    await actual.init({ dataDir, serverURL: settings.actualOrigin, password: settings.actualPassword });
  } catch {
    throw new SeedError('Could not sign in to the Actual Budget test server.');
  }
  try {
    return await seedActualOpen(settings, items, write);
  } finally {
    try {
      await actual.shutdown();
    } catch {
      console.error('Actual shutdown failed.');
      process.exitCode = 1;
    }
  }
}

async function seedActualOpen(settings: Settings, items: readonly SeedItem[], write: boolean): Promise<Result[]> {
  let budgetId = settings.actualBudgetId;
  try {
    if (budgetId === undefined) {
      const ids = new Set<string>();
      for (const file of await actual.getBudgets()) {
        const groupId = (file as { groupId?: unknown }).groupId;
        if (typeof groupId === 'string' && groupId !== '') ids.add(groupId);
      }
      if (ids.size !== 1) {
        throw new SeedError(`The server holds ${String(ids.size)} budgets; set ACTUAL_BUDGET_ID in the env file.`);
      }
      budgetId = [...ids][0];
    }
    await actual.downloadBudget(budgetId ?? '', settings.actualSyncKey === undefined ? undefined : { password: settings.actualSyncKey });
  } catch (error: unknown) {
    if (error instanceof SeedError) throw error;
    throw new SeedError('Could not open the Actual Budget test budget.');
  }

  const schedules = await actual.getSchedules();
  const byName = new Map<string, (typeof schedules)[number][]>();
  for (const s of schedules) {
    if (typeof s.name === 'string') byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
  }
  const payees = new Map((await actual.getPayees()).map((p) => [p.name, p.id]));
  const accounts = (await actual.getAccounts()).filter((a) => a.closed !== true);
  let accountId = accounts.find((a) => a.offbudget !== true)?.id ?? accounts[0]?.id;

  const results: Result[] = [];
  let wrote = false;
  for (const item of items) {
    const name = seedName(item.title);
    const minor = priceToMinorUnits(item.amount, item.currency);
    if (minor === null) {
      results.push({ item, outcome: 'skip', detail: 'amount does not fit the currency' });
      continue;
    }
    const recurrence = wallosToActual(item.interval);
    const date = { frequency: recurrence.frequency, interval: recurrence.interval, start: item.startDate };
    const found = byName.get(name) ?? [];
    if (found.length > 1) {
      results.push({ item, outcome: 'skip', detail: 'collision: several schedules have this name' });
      continue;
    }
    const current = found[0];
    if (current === undefined) {
      if (write) {
        accountId ??= await actual.createAccount({ name: seedName('Test Account') }, 0);
        const payee = payees.get(name) ?? (await actual.createPayee({ name }));
        payees.set(name, payee);
        const payload = {
          name,
          posts_transaction: false,
          payee,
          account: accountId,
          amount: -minor,
          amountOp: 'is',
          date,
        } as ScheduleInput;
        await actual.createSchedule(payload);
        wrote = true;
      }
      results.push({ item, outcome: 'create', detail: '' });
      continue;
    }
    const differs: string[] = [];
    if (current.amount !== -minor) differs.push('amount');
    const currentDate: unknown = current.date;
    const rec = typeof currentDate === 'object' && currentDate !== null ? (currentDate as Record<string, unknown>) : {};
    if (rec['start'] !== item.startDate) differs.push('start date');
    if (rec['frequency'] !== date.frequency || (rec['interval'] ?? 1) !== date.interval) differs.push('interval');
    if (differs.length === 0) {
      results.push({ item, outcome: 'exists', detail: '' });
      continue;
    }
    if (write) {
      await actual.updateSchedule(current.id, { amount: -minor, amountOp: 'is', date }, true);
      wrote = true;
    }
    results.push({ item, outcome: 'update', detail: differs.join(', ') });
  }
  if (write && wrote) {
    try {
      await actual.sync();
    } catch {
      throw new SeedError('Could not sync the new schedules to the Actual server.');
    }
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// Report

function report(results: readonly Result[], write: boolean): void {
  const verb: Record<Outcome, string> = write
    ? { create: 'created', exists: 'already there', update: 'updated', skip: 'skipped' }
    : { create: 'would create', exists: 'already there', update: 'would update', skip: 'would skip' };
  console.log(write ? 'Seed result by category' : 'Seed plan by category (dry run, nothing written)');
  const outcomes: Outcome[] = ['create', 'exists', 'update', 'skip'];
  for (const category of COVERAGE_CATEGORIES) {
    const rows = results.filter((r) => r.item.category === category);
    const parts = outcomes
      .map((o) => [o, rows.filter((r) => r.outcome === o).length] as const)
      .filter(([, n]) => n > 0)
      .map(([o, n]) => `${String(n)} ${verb[o]}`);
    console.log(`  ${category.padEnd(32)} ${String(rows.length).padStart(2)} items: ${parts.join(', ')}`);
  }
  for (const r of results) {
    if (r.outcome === 'update' || r.outcome === 'skip' || r.detail !== '') {
      console.log(`  note [${r.item.category}] ${seedName(r.item.title)} (${r.item.side}): ${r.outcome}, ${r.detail}`);
    }
  }
  console.log('Manual Walley steps still to do after seeding (see the Seed test data section of test/README.md): link, ignore and delete are Walley state.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = !args.includes('--dry-run');
  const here = dirname(fileURLToPath(import.meta.url));
  const envFile = args.find((a) => !a.startsWith('--')) ?? resolve(here, '..', '.env.test');
  const settings = await loadSettings(envFile);
  const wallos = await seedWallos(settings, SEED_ITEMS.filter((i) => i.side === 'wallos'), write);
  const actualResults = await seedActual(settings, SEED_ITEMS.filter((i) => i.side === 'actual'), write);
  report([...wallos, ...actualResults], write);
}

try {
  await main();
} catch (error: unknown) {
  if (error instanceof SeedGuardError || error instanceof SeedError) {
    console.error(error.message);
  } else {
    console.error('The seed failed (details withheld).');
  }
  process.exitCode = 1;
}
