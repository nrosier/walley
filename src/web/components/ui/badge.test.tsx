import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge';

describe('Badge', () => {
  it('renders a pill with the linked variant classes', () => {
    const markup = renderToStaticMarkup(<Badge variant="linked">Synced</Badge>);
    expect(markup).toContain('<span');
    expect(markup).toContain('>Synced</span>');
    expect(markup).toContain('rounded-full');
    expect(markup).toContain('text-xs');
    expect(markup).toContain('bg-success-bg');
    expect(markup).toContain('text-success');
  });

  it('renders the mismatch and neutral variants', () => {
    const mismatch = renderToStaticMarkup(<Badge variant="mismatch">Mismatch</Badge>);
    expect(mismatch).toContain('bg-warning-bg');
    expect(mismatch).toContain('text-warning');

    const neutral = renderToStaticMarkup(<Badge variant="neutral">Ignored</Badge>);
    expect(neutral).toContain('bg-neutral-bg');
    expect(neutral).toContain('text-neutral');
  });

  it('renders the orphaned variant with a warning border and neutral fill', () => {
    const markup = renderToStaticMarkup(<Badge variant="orphaned">Orphaned</Badge>);
    expect(markup).toContain('data-variant="orphaned"');
    expect(markup).toContain('bg-neutral-bg');
    expect(markup).toContain('text-neutral');
    expect(markup).toContain('border border-warning');
  });
});
