import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { ActualSettings, ActualSettingsView, type ActualSettingsViewProps } from './ActualSettings';
import actualSrc from './ActualSettings.tsx?raw';
import { fetchBaseCurrency, fetchBudgets, saveActualSettings, saveBudgetChoice, viewStateFrom } from './ActualSettings.api';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function fakeFetch(status: number, response: unknown) {
  const calls: Call[] = [];
  const impl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
  return { impl, calls };
}

const base: ActualSettingsViewProps = {
  url: 'https://actual.example',
  password: '',
  syncKey: '',
  clearSyncKey: false,
  hasPassword: false,
  hasSyncKey: false,
  budgetId: null,
  budgets: null,
};

const render = (props: Partial<ActualSettingsViewProps>, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <ActualSettingsView {...base} {...props} />
    </I18nProvider>,
  );

const inputTag = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';

describe('ActualSettings', () => {
  it('shows masked saved indicators, never values, for stored secrets', () => {
    const html = render({ hasPassword: true, hasSyncKey: true });
    for (const id of ['actual-password', 'actual-sync-key']) {
      const tag = inputTag(html, id);
      expect(tag).toContain('type="password"');
      expect(tag).toContain('placeholder="Saved - leave blank to keep"');
      expect(tag).not.toMatch(/value="[^"]+"/);
    }
    expect(html).toContain('Remove sync key');
    expect(html).toContain('<h2 id="actual-settings-heading"');
    expect(html).toContain('aria-live="polite"');
    const fresh = render({});
    expect(fresh).not.toContain('leave blank to keep');
    expect(fresh).not.toContain('Remove sync key');
  });

  it('populates the budget select from the budgets response', async () => {
    const { impl, calls } = fakeFetch(200, { budgets: [{ id: 'b1', name: 'Home' }, { id: 'b2', name: 'Work' }] });
    const budgets = await fetchBudgets(impl);
    expect(calls[0]).toMatchObject({ url: '/api/settings/actual/budgets', method: 'POST' });
    const html = render({ budgets, budgetId: 'b2' });
    expect(html).toContain('<option value="b1">Home</option>');
    expect(html).toMatch(/<option value="b2" selected="">Work<\/option>/);
  });

  it('shows the empty text when the server has no budgets', () => {
    expect(render({ budgets: [] })).toContain('No budgets on this server');
    expect(render({ budgets: [] }, 'nl')).toContain('Geen budgetten op deze server');
  });

  it('picking a budget sends actualBudgetId with the saved URL', async () => {
    const { impl, calls } = fakeFetch(200, {
      actualUrl: 'https://actual.example',
      actualBudgetId: 'b1',
      hasActualPassword: true,
      hasActualSyncKey: false,
    });
    await saveBudgetChoice('https://actual.example', 'b1', impl);
    expect(calls[0]).toEqual({
      url: '/api/settings/actual',
      method: 'PUT',
      body: { actualUrl: 'https://actual.example', actualBudgetId: 'b1' },
    });
  });

  it('save omits blank secrets and sends clearSyncKey', async () => {
    const { impl, calls } = fakeFetch(200, base);
    await saveActualSettings({ url: 'https://a.example', password: ' ', syncKey: '', clearSyncKey: true }, impl);
    expect(calls[0]?.body).toEqual({ actualUrl: 'https://a.example', clearSyncKey: true });
  });

  it('shows the detected currency in font-mono, or "not set"', async () => {
    const { impl } = fakeFetch(200, { currency: 'EUR' });
    const currency = await fetchBaseCurrency(impl);
    expect(render({ budgetId: 'b1', currency })).toContain('<span class="font-mono">EUR</span>');
    expect(render({ budgetId: 'b1', currency: null })).toContain('not set');
    expect(render({ budgetId: 'b1', currency: null }, 'nl')).toContain('niet ingesteld');
  });

  it('password_required tells the user to enter the password again', async () => {
    const { impl } = fakeFetch(400, { error: 'password_required' });
    const error = await saveActualSettings(
      { url: 'https://new.example', password: '', syncKey: '', clearSyncKey: false },
      impl,
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'password_required' });
    const html = render({ status: { kind: 'error', code: 'password_required' } });
    expect(html).toContain('Enter the password again');
    expect(html).toContain('text-warning');
    expect(render({ status: { kind: 'error', code: 'actual_unavailable' } })).toContain('Could not reach Actual Budget');
  });

  it('never keeps a secret from a response', () => {
    const response = {
      actualUrl: 'https://actual.example',
      actualBudgetId: null,
      hasActualPassword: true,
      hasActualSyncKey: true,
      password: 'leaked-secret',
      actualSyncKey: 'leaked-key',
    };
    const state = viewStateFrom(response);
    expect(JSON.stringify(state)).not.toContain('leaked');
    expect(Object.keys(state).sort()).toEqual(['actualBudgetId', 'actualUrl', 'hasActualPassword', 'hasActualSyncKey']);
  });

  it('the connected component starts with empty secret inputs', () => {
    const html = renderToStaticMarkup(<ActualSettings />);
    expect(inputTag(html, 'actual-password')).not.toMatch(/value="[^"]+"/);
    expect(inputTag(html, 'actual-sync-key')).not.toMatch(/value="[^"]+"/);
  });
});

describe('ActualSettings card', () => {
  it('has one footer Save covering credentials and the budget pick, with the unsaved status', () => {
    const html = render({ budgets: [{ id: 'b1', name: 'Home' }], budgetId: 'b1', dirty: true, budgetDirty: true });
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain('form="actual-settings-form"');
    expect(html).toContain('>Save Actual Budget<');
    expect(html).toContain('Unsaved changes');
    expect(html).toContain('Budget choice is saved with Save Actual Budget.');
    expect(html).toContain('data-scope="account"');
    expect(render({})).toContain('No unsaved changes');
  });
  it('a budget pick only changes the form; Save sends it through the existing budget-choice request', () => {
    const pick = actualSrc.slice(actualSrc.indexOf('const pickBudget'), actualSrc.indexOf('return (\n    <ActualSettingsView'));
    expect(pick).not.toContain('saveBudgetChoice');
    const save = actualSrc.slice(actualSrc.indexOf('const save = '), actualSrc.indexOf('const loadBudgets'));
    expect(save).toContain('saveBudget(pick)');
    expect(save).toContain('saveActualSettings(');
  });
});
