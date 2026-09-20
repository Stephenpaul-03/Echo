import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { nowPlaying } from '@/features/now-playing/bridge';

export type ThemeMode = 'dark' | 'light' | 'system';
export function palette(mode: 'dark' | 'light') {
  const dark = mode !== 'light';
  const accent = dark ? '#f2f2f2' : '#111111';
  return {
    dark, accent,
    background: dark ? '#000000' : '#ffffff',
    surface: dark ? '#0b0b0b' : '#ffffff',
    stage: dark ? '#000000' : '#ffffff',
    text: dark ? '#f2f2f2' : '#171717',
    muted: dark ? '#a7a7a7' : '#666666',
    subtle: '#777777',
    border: dark ? '#ffffff18' : '#00000020',
    rail: dark ? '#ffffff28' : '#00000028',
    onAccent: dark ? '#000000' : '#ffffff',
    tint: `${accent}18`,
    overlay: dark ? '#00000088' : '#17291c55',
    warningSurface: dark ? '#302b21' : '#f5e4c4',
    warningText: dark ? '#e1cfaa' : '#745315',
  };
}
export type ThemeColors = ReturnType<typeof palette>;
export interface Appearance { mode: ThemeMode }
interface ThemeContextValue { colors: ThemeColors; appearance: Appearance; setAppearance: (appearance: Appearance) => void; saveError: boolean }
const ThemeContext = createContext<ThemeContextValue | null>(null);
const valid = (value: unknown): value is Appearance => {
  if (!value || typeof value !== 'object') return false;
  return ['dark', 'light', 'system'].includes((value as Appearance).mode);
};
export function EchoThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [appearance, update] = useState<Appearance>({ mode: 'system' });
  const [saveError, setSaveError] = useState(false);
  const mode = appearance.mode === 'system' ? system === 'light' ? 'light' : 'dark' : appearance.mode;
  const changed = useRef(false);
  const saves = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const saved = Platform.OS === 'web'
          ? JSON.parse(localStorage.getItem('echo-appearance') ?? 'null')
          : await nowPlaying?.getAppearance?.();
        if (active && !changed.current && valid(saved)) update(saved);
      } catch { /* Private browsing / older development builds keep the in-memory theme. */ }
    };
    void restore();
    return () => { active = false; };
  }, []);
  const setAppearance = useCallback((next: Appearance) => {
    changed.current = true;
    update(next);
    saves.current = saves.current.then(async () => {
      try {
        if (Platform.OS === 'web') localStorage.setItem('echo-appearance', JSON.stringify(next));
        // Keep the native bridge's existing two-argument contract for installed dev builds.
        // Accent remains a compatibility value; only mode affects the theme.
        else if (nowPlaying?.setAppearance) await nowPlaying.setAppearance(next.mode, 'sage');
        setSaveError(false);
      } catch { setSaveError(true); }
    });
  }, []);
  const colors = useMemo(() => palette(mode), [mode]);
  return <ThemeContext.Provider value={{ colors, appearance, setAppearance, saveError }}>{children}</ThemeContext.Provider>;
}
export function useEchoTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('EchoThemeProvider is missing');
  return context;
}
