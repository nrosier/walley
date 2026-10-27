import { createContext, useContext } from 'react';
import { DEFAULT_THEME, type Theme } from './theme';

export interface ThemeControl {
  theme: Theme;
  /** Applies and stores the theme. The header toggle and the Settings control share this. */
  setTheme: (theme: Theme) => void;
}

/** Provided by the signed-in shell. Outside it (tests, static renders) the default is dark and changes do nothing. */
export const ThemeControlContext = createContext<ThemeControl>({ theme: DEFAULT_THEME, setTheme: () => undefined });

export function useThemeControl(): ThemeControl {
  return useContext(ThemeControlContext);
}
