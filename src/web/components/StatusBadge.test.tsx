import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PairBadgeKind } from '../../lib/match-badge';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { Locale } from '@/i18n/locale';
import { StatusBadge } from './StatusBadge';

const render = (kind: PairBadgeKind, locale: Locale) =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <StatusBadge kind={kind} />
    </I18nProvider>,
  );

const cases: [PairBadgeKind, string, string, string][] = [
  ['synced', 'linked', 'Synced', 'Gesynchroniseerd'],
  ['mismatch', 'mismatch', 'Mismatch', 'Afwijking'],
  ['ignored', 'neutral', 'Ignored', 'Genegeerd'],
  ['orphaned', 'orphaned', 'Orphaned', 'Verweesd'],
];

describe('StatusBadge', () => {
  for (const [kind, variant, en, nl] of cases) {
    it(`renders ${kind} in en and nl with variant ${variant}`, () => {
      const enMarkup = render(kind, 'en');
      expect(enMarkup).toContain(`>${en}</span>`);
      expect(enMarkup).toContain(`data-variant="${variant}"`);

      const nlMarkup = render(kind, 'nl');
      expect(nlMarkup).toContain(`>${nl}</span>`);
      expect(nlMarkup).toContain(`data-variant="${variant}"`);
    });
  }

  it('gives each kind a distinct variant', () => {
    const variants = cases.map(([kind]) => render(kind, 'en').match(/data-variant="([^"]+)"/)?.[1]);
    expect(new Set(variants).size).toBe(4);
  });

  it('shows the Unlink icon with aria-hidden only for orphaned', () => {
    const orphaned = render('orphaned', 'en');
    expect(orphaned).toContain('<svg');
    expect(orphaned).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(render('synced', 'en')).not.toContain('<svg');
  });
});
