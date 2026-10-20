import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HealthStatus } from './HealthStatus';

describe('HealthStatus', () => {
  it('renders the checking state before the health request resolves', () => {
    const markup = renderToStaticMarkup(<HealthStatus />);
    expect(markup).toContain('API: checking');
  });
});
