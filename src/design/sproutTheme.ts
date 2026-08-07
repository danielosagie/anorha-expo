import { BRAND_PRIMARY } from './tokens';

/**
 * Screen-scoped Sprout colors. Light and dark intentionally share one shape so
 * descendants can opt into the screen palette without reading device appearance.
 */
export type SproutTheme = {
  mode: 'light' | 'dark';
  colors: {
    primary: string;
    onPrimary: string;
    background: string;
    surface: string;
    card: string;
    border: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    errorBackground: string;
    errorBorder: string;
    errorText: string;
  };
  hero: {
    background: string;
    gradientEnd: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    pillBackground: string;
    pillBorder: string;
    newBackground: string;
    cardBorder: string;
    chart: string;
    divider: string;
    rangeText: string;
    rangeActiveBackground: string;
    rangeActiveText: string;
  };
  controls: {
    idleBackground: string;
    idleText: string;
    activeBackground: string;
    activeText: string;
    activeBorder: string;
  };
  campaign: {
    selectedBorder: string;
    selectedFill: string;
    selectedInk: string;
    thumbnailBackground: string;
    pausedBackground: string;
    pausedText: string;
    waitingBackground: string;
    waitingText: string;
    runningBackground: string;
    runningText: string;
    pendingBackground: string;
    tick: string;
  };
  chat: {
    background: string;
    surface: string;
    surfaceElevated: string;
    surfaceMuted: string;
    border: string;
    sheetBorder: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    grabber: string;
    backdrop: string;
    wash: readonly [string, string, string];
    headerFade: readonly [string, string, string];
    footerFade: readonly [string, string, string];
  };
};

export const sproutLightTheme: SproutTheme = {
  mode: 'light',
  colors: {
    primary: BRAND_PRIMARY,
    onPrimary: '#FFFFFF',
    background: '#F6F7F4',
    surface: '#FFFFFF',
    card: '#FFFFFF',
    border: '#E4E4E7',
    text: '#18181B',
    textSecondary: '#666666',
    textMuted: '#71717A',
    errorBackground: '#FEF2F2',
    errorBorder: '#FECACA',
    errorText: '#B91C1C',
  },
  hero: {
    background: '#9AC53C',
    gradientEnd: '#6F9C26',
    text: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.78)',
    textMuted: 'rgba(255,255,255,0.60)',
    pillBackground: 'rgba(255,255,255,0.18)',
    pillBorder: 'rgba(255,255,255,0.45)',
    newBackground: 'rgba(20,30,8,0.30)',
    cardBorder: 'rgba(255,255,255,0.28)',
    chart: 'rgba(255,255,255,0.95)',
    divider: 'rgba(255,255,255,0.34)',
    rangeText: 'rgba(255,255,255,0.78)',
    rangeActiveBackground: '#FFFFFF',
    rangeActiveText: '#43631A',
  },
  controls: {
    idleBackground: '#E4E4E7',
    idleText: '#71717A',
    activeBackground: '#71717A',
    activeText: '#FFFFFF',
    activeBorder: 'transparent',
  },
  campaign: {
    selectedBorder: BRAND_PRIMARY,
    selectedFill: BRAND_PRIMARY,
    selectedInk: '#FFFFFF',
    thumbnailBackground: 'rgba(147,200,34,0.12)',
    pausedBackground: '#FBEAD2',
    pausedText: '#A2611A',
    waitingBackground: '#DCEBFB',
    waitingText: '#1F5FA8',
    runningBackground: '#EAF7CF',
    runningText: '#4E6B12',
    pendingBackground: '#A56300',
    tick: '#D4D4D4',
  },
  chat: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceElevated: '#F8FCF0',
    surfaceMuted: '#F4F4F1',
    border: '#E1E5D9',
    sheetBorder: '#E5E7EB',
    text: '#18181B',
    textSecondary: '#71717A',
    textMuted: '#9CA3AF',
    grabber: '#D9DDE3',
    backdrop: '#17200D',
    wash: ['rgba(147,200,34,0.14)', 'rgba(147,200,34,0.055)', 'rgba(255,255,255,0)'],
    headerFade: ['rgba(248,252,240,0.98)', 'rgba(252,253,249,0.86)', 'rgba(255,255,255,0)'],
    footerFade: ['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', '#FFFFFF'],
  },
};

export const sproutDarkTheme: SproutTheme = {
  mode: 'dark',
  colors: {
    primary: BRAND_PRIMARY,
    onPrimary: '#17200D',
    background: '#171A13',
    surface: '#20251A',
    card: '#242A1D',
    border: '#3B4432',
    text: '#F4F6EE',
    textSecondary: '#C9CEBF',
    textMuted: '#A9B09F',
    errorBackground: '#351B1B',
    errorBorder: '#713A3A',
    errorText: '#FFB4B4',
  },
  hero: {
    background: '#0F1603',
    gradientEnd: '#0F1603',
    text: '#F4F6EE',
    textSecondary: '#C9CEBF',
    textMuted: '#A9B09F',
    pillBackground: 'rgba(244,246,238,0.14)',
    pillBorder: 'rgba(244,246,238,0.30)',
    newBackground: 'rgba(244,246,238,0.14)',
    cardBorder: 'rgba(244,246,238,0.24)',
    chart: '#F4F6EE',
    divider: '#4A5640',
    rangeText: '#C9CEBF',
    rangeActiveBackground: '#E7EADF',
    rangeActiveText: '#1F241A',
  },
  controls: {
    idleBackground: '#2B3125',
    idleText: '#C9CEBF',
    activeBackground: '#E7EADF',
    activeText: '#1F241A',
    activeBorder: '#E7EADF',
  },
  campaign: {
    selectedBorder: '#F4F6EE',
    selectedFill: '#F4F6EE',
    selectedInk: '#17200D',
    thumbnailBackground: '#30372A',
    pausedBackground: 'rgba(162,97,26,0.22)',
    pausedText: '#E8B380',
    waitingBackground: 'rgba(31,95,168,0.28)',
    waitingText: '#9CC4F0',
    runningBackground: 'rgba(147,200,34,0.18)',
    runningText: '#C9E588',
    pendingBackground: '#494B44',
    tick: '#3B4432',
  },
  chat: {
    background: '#171A13',
    surface: '#242A1D',
    surfaceElevated: '#2B3125',
    surfaceMuted: '#30372A',
    border: '#3B4432',
    sheetBorder: '#3B4432',
    text: '#F4F6EE',
    textSecondary: '#C9CEBF',
    textMuted: '#A9B09F',
    grabber: '#66705B',
    backdrop: '#050704',
    wash: ['rgba(147,200,34,0.16)', 'rgba(147,200,34,0.06)', 'rgba(23,26,19,0)'],
    headerFade: ['rgba(36,42,29,0.98)', 'rgba(23,26,19,0.86)', 'rgba(23,26,19,0)'],
    footerFade: ['rgba(23,26,19,0)', 'rgba(23,26,19,0.88)', '#171A13'],
  },
};

export const getSproutTheme = (dark: boolean): SproutTheme =>
  dark ? sproutDarkTheme : sproutLightTheme;
