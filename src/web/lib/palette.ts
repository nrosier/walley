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
    'accent-text': '#818cf8',
    muted: '#94a3b8',
    'surface-2': '#111827',
    danger: '#fca5a5',
    'danger-line': '#f87171',
    'danger-bg': 'rgb(239 68 68 / 0.15)',
    info: '#93c5fd',
    'info-bg': 'rgb(59 130 246 / 0.15)',
    hover: 'rgb(148 163 184 / 0.12)',
    'input-border': '#64748b',
    scrim: 'rgb(2 6 23 / 0.65)',
    shadow: '0 12px 32px rgb(0 0 0 / 0.5)',
    'control-h': '32px',
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
    muted: '#556478',
    'surface-2': '#f1f5f9',
    danger: '#b91c1c',
    'danger-line': '#dc2626',
    'danger-bg': '#fee2e2',
    info: '#1e40af',
    'info-bg': '#dbeafe',
    hover: 'rgb(15 23 42 / 0.06)',
    'input-border': '#708096',
    scrim: 'rgb(15 23 42 / 0.45)',
    shadow: '0 12px 32px rgb(15 23 42 / 0.22)',
    'control-h': '32px',
    success: '#166534',
    'success-bg': '#dcfce7',
    warning: '#92400e',
    'warning-bg': '#fef3c7',
    neutral: '#475569',
    'neutral-bg': '#f1f5f9',
  },
} as const satisfies Record<string, Record<string, string>>;

/** Focus ring geometry, shared by both themes. The colour is the `ring` token. */
export const FOCUS_RING = { width: '2px', offset: '2px' } as const;

/** `--control-h` under 768px or a coarse pointer (see index.css). */
export const CONTROL_H_NARROW = '44px';

export type ThemeName = keyof typeof PALETTE;
