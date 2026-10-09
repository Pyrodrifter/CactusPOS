import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const key = 'cactus.display.theme';
const listeners = new Set<() => void>();
const system = window.matchMedia('(prefers-color-scheme: dark)');
export function readTheme(value: string | null): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}
let theme: Theme = 'system';
try { theme = readTheme(localStorage.getItem(key)); } catch { /* Storage is optional. */ }
let dark = theme === 'dark' || (theme === 'system' && system.matches);
function apply() {
  dark = theme === 'dark' || (theme === 'system' && system.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  listeners.forEach((listener) => listener());
}
apply();
system.addEventListener('change', apply);
window.addEventListener('storage', (event) => {
  if (event.key === key || event.key === null) {
    theme = readTheme(event.newValue);
    apply();
  }
});
export function setTheme(next: Theme) {
  theme = next;
  try { localStorage.setItem(key, next); } catch { /* Still apply for this visit. */ }
  apply();
}
export function useTheme() {
  const selected = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => `${theme}:${dark}`);
  return { theme: selected.split(':')[0] as Theme, dark: selected.endsWith(':true'), setTheme };
}
