'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_MODE, DEFAULT_THEME, MODE_KEY, THEME_KEY, type Mode, type ThemeId } from '@/lib/themes';

interface ThemeContextValue {
  theme: ThemeId;
  mode: Mode;
  setTheme: (t: ThemeId) => void;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function apply(theme: ThemeId, mode: Mode): void {
  const el = document.documentElement;
  el.setAttribute('data-theme', theme);
  el.setAttribute('data-mode', mode);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The no-flash inline script already set the attributes; mirror them into state on mount.
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);
  const [mode, setModeState] = useState<Mode>(DEFAULT_MODE);

  useEffect(() => {
    const t = (localStorage.getItem(THEME_KEY) as ThemeId | null) ?? DEFAULT_THEME;
    const m = (localStorage.getItem(MODE_KEY) as Mode | null) ?? DEFAULT_MODE;
    setThemeState(t);
    setModeState(m);
    apply(t, m);
  }, []);

  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    localStorage.setItem(MODE_KEY, m);
    document.documentElement.setAttribute('data-mode', m);
  }, []);

  const toggleMode = useCallback(() => setMode(mode === 'dark' ? 'light' : 'dark'), [mode, setMode]);

  return <ThemeContext.Provider value={{ theme, mode, setTheme, setMode, toggleMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
