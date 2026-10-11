import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'tavolina.theme';

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readPreference(fallback: ThemePreference): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage can be unavailable (private mode); fall back silently.
  }
  return fallback;
}

export function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

/**
 * Theme preference with persistence. Pass `persist: false` for surfaces that must
 * always follow the system (guest app) or are fixed (KDS uses `applyTheme('dark')`).
 */
export function useTheme(options: { initial?: ThemePreference; persist?: boolean } = {}) {
  const { initial = 'system', persist = true } = options;
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    persist ? readPreference(initial) : initial,
  );

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      if (!persist) return;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
    },
    [persist],
  );

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference;

  return { preference, resolved, setPreference };
}
