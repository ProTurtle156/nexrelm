/** The theme catalog — id, label, blurb, and two swatch colors for the picker. */
export type ThemeId = 'obsidian' | 'brutalist' | 'nord' | 'solar' | 'paper';
export type Mode = 'dark' | 'light';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  blurb: string;
  /** preview swatches [background, accent] for dark + light. */
  swatch: { dark: [string, string]; light: [string, string] };
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'obsidian',
    label: 'Obsidian',
    blurb: 'True black, clean, indigo accent.',
    swatch: { dark: ['#0a0a0b', '#9b8cff'], light: ['#ffffff', '#6d5ef0'] },
  },
  {
    id: 'brutalist',
    label: 'Brutalist',
    blurb: 'Stark, flat, hard borders, one loud accent.',
    swatch: { dark: ['#0b0b0b', '#ff4133'], light: ['#ffffff', '#e0301e'] },
  },
  {
    id: 'nord',
    label: 'Nord',
    blurb: 'Calm arctic blues, soft and professional.',
    swatch: { dark: ['#2e3440', '#88c0d0'], light: ['#eceff4', '#5e81ac'] },
  },
  {
    id: 'solar',
    label: 'Solar',
    blurb: 'The classic Solarized palette, warm and even.',
    swatch: { dark: ['#002b36', '#268bd2'], light: ['#fdf6e3', '#268bd2'] },
  },
  {
    id: 'paper',
    label: 'Paper',
    blurb: 'Warm editorial tones, serif headings.',
    swatch: { dark: ['#1c1917', '#d6a35c'], light: ['#faf7f1', '#b27a33'] },
  },
];

export const DEFAULT_THEME: ThemeId = 'obsidian';
export const DEFAULT_MODE: Mode = 'dark';
export const THEME_KEY = 'nexrelm.theme';
export const MODE_KEY = 'nexrelm.mode';

/** Inline <head> script that applies the saved theme before first paint (no flash). */
export const NO_FLASH_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')||'${DEFAULT_THEME}';var m=localStorage.getItem('${MODE_KEY}')||'${DEFAULT_MODE}';var e=document.documentElement;e.setAttribute('data-theme',t);e.setAttribute('data-mode',m);}catch(_){document.documentElement.setAttribute('data-theme','${DEFAULT_THEME}');document.documentElement.setAttribute('data-mode','${DEFAULT_MODE}');}})();`;
