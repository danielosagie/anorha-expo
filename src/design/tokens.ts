// Design tokens for React Native app
// Primitive tokens (do not depend on theme)

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 12,
} as const;

export const fontSizes = {
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 22,
  display: 28,
} as const;

export const lineHeights = {
  tight: 1.15,
  snug: 1.25,
  normal: 1.4,
  relaxed: 1.6,
} as const;

export const durations = {
  instant: 90,
  fast: 160,
  normal: 240,
  slow: 360,
  slower: 480,
} as const;

// Motion curves approximating shadcn/ui easings
export const easings = {
  standard: [0.2, 0, 0, 1] as [number, number, number, number],
  entrance: [0.2, 0.65, 0.2, 1] as [number, number, number, number],
  exit: [0.4, 0, 1, 1] as [number, number, number, number],
} as const;

// Cross-platform shadow/elevation presets
export const elevation = (level: 0 | 1 | 2 | 3 | 4 = 1) => {
  const presets: Record<number, any> = {
    0: { shadowColor: 'transparent', elevation: 0 },
    1: {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    2: {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    3: {
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    4: {
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
  };
  return presets[level];
};

// Semantic color helper that maps to theme when provided
export type SemanticColors = {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
};

export const buildSemanticColors = (colors: any): SemanticColors => ({
  background: colors.background,
  surface: colors.surface,
  text: colors.text,
  textSecondary: colors.textSecondary,
  border: '#E5E7EB',
  primary: colors.primary,
  secondary: colors.secondary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.error,
});

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export type DesignTokens = {
  spacing: typeof spacing;
  radii: typeof radii;
  fontSizes: typeof fontSizes;
  lineHeights: typeof lineHeights;
  durations: typeof durations;
  easings: typeof easings;
  elevation: typeof elevation;
};

export const tokens: DesignTokens = {
  spacing,
  radii,
  fontSizes,
  lineHeights,
  durations,
  easings,
  elevation,
};


