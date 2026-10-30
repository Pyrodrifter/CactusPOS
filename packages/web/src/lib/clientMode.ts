export const isPractice = () => typeof location !== 'undefined' && /^\/practice(?:\/|$)/.test(location.pathname);
export const appBase = () => isPractice() ? '/practice' : '';
export const appPath = (path: string) => `${appBase()}${path}`;
export const apiPath = (path: string) => `/api${isPractice() ? '/practice' : ''}${path}`;
export const sessionKey = (mode: 'live' | 'practice' = isPractice() ? 'practice' : 'live') => mode === 'practice' ? 'cactus.practice.session' : 'cactus.session';
export function androidPracticeSupported(): boolean {
  const native = (window as unknown as { CactusAndroid?: { supportsPracticeMode?: () => boolean } }).CactusAndroid;
  return !native || native.supportsPracticeMode?.() === true;
}
