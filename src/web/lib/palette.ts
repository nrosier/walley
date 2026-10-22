/**
 * Palette values mirrored from the `:root` blocks in src/web/index.css.
 * Keep in sync with index.css; contrast.test.ts asserts against these.
 * Vitest does not expose CSS source text, so the values are duplicated here.
 */
export const PALETTE = {
  dark: {
    background: '#0c0f19',
    foreground: '#f8fafc',
    'muted-foreground': '#cbd5e1',
    card: '#182232',
    border: '#334155',
    primary: '#4f46e5',
    'primary-foreground': '#ffffff',
    ring: '#6366f1',
    'accent-text': '#6366f1',
    success: '#86efac',
    'success-bg': 'rgb(34 197 94 / 0.15)',
    warning: '#fcd34d',
    'warning-bg': 'rgb(245 158 11 / 0.15)',
    neutral: '#cbd5e1',
    'neutral-bg': 'rgb(148 163 184 / 0.15)',
  },
  light: {
    background: '#f8fafc',
    foreground: '#0f172a',
    'muted-foreground': '#334155',
    card: '#ffffff',
    border: '#e2e8f0',
    primary: '#4f46e5',
    'primary-foreground': '#ffffff',
    ring: '#6366f1',
    'accent-text': '#4f46e5',
    success: '#166534',
    'success-bg': '#dcfce7',
    warning: '#92400e',
    'warning-bg': '#fef3c7',
    neutral: '#475569',
    'neutral-bg': '#f1f5f9',
  },
} as const satisfies Record<string, Record<string, string>>;

export type ThemeName = keyof typeof PALETTE;
