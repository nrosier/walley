import { Plus } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renders a primary button with a Lucide icon', () => {
    const markup = renderToStaticMarkup(
      <Button>
        <Plus />
        Label
      </Button>,
    );
    expect(markup).toContain('<button');
    expect(markup).toContain('bg-primary');
    expect(markup).toMatch(/<svg[^>]*class="[^"]*lucide/);
  });
});
