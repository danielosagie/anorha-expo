// The chat surface's design language (CampaignThreadScreen + liquidationConversation),
// extracted so other screens can adopt it. Complements design/tokens.ts (primitives):
// this file is the opinionated palette/recipes the chat page actually ships.
import { Platform } from 'react-native';

export const CHAT_COLORS = {
  // Brand
  brand: '#93C822',
  brandSoft: 'rgba(147,200,34,0.12)',
  brandBorder: 'rgba(147,200,34,0.3)',
  brandDeep: '#5D7E16',

  // Surfaces
  white: '#FFFFFF',
  surface: '#F4F4F1',
  surfaceAlt: '#F1F1EE',
  bubble: '#F3F4F6',

  // Text
  ink: '#18181B',
  inkSoft: '#3F3F46',
  dim: '#71717A',
  faint: '#9CA3AF',

  // Semantic
  success: '#93C822',
  warning: '#F59E0B',
  amber: '#BA7517',
  error: '#EF4444',
  errorDeep: '#B91C1C',
  errorSurface: '#FEF2F2',
  errorBorder: '#FECACA',
  idle: '#D4D4D8',

  // Overlays / lines
  scrim: 'rgba(0,0,0,0.45)',
  divider: '#F1F2EE',
  border: '#E5E7EB',
} as const;

export const CHAT_FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

// Two intentional depths: "glass" for floating pills/nav circles, "elevated" for
// dropdowns/drawers that sit above everything else.
export const CHAT_SHADOWS = {
  glass: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  elevated: {
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
} as const;

// Floating glass bar recipe — BlurView + white fade so content scrolls underneath.
export const GLASS = {
  blurIntensity: Platform.OS === 'ios' ? 24 : 14,
  headerFade: {
    colors: ['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)'] as const,
    locations: [0, 0.55, 1] as const,
  },
  footerFade: {
    colors: ['rgba(255,255,255,0)', 'rgba(255,255,255,0.9)', '#FFFFFF'] as const,
    locations: [0, 0.55, 1] as const,
  },
} as const;

// Shared floating-header building blocks (nav circle, title pill, action pill, dropdown)
// — exactly the chat header's measurements so restyled screens match it 1:1.
export const GLASS_HEADER_STYLES = {
  header: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingBottom: 10,
    zIndex: 5000,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
  },
  navCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: CHAT_COLORS.white,
    ...CHAT_SHADOWS.glass,
  },
  titlePill: {
    flexShrink: 1,
    alignItems: 'center' as const,
    backgroundColor: CHAT_COLORS.white,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 8,
    ...CHAT_SHADOWS.glass,
  },
  pillTitle: { fontSize: 15, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold },
  pillSub: { fontSize: 12, color: CHAT_COLORS.dim, marginTop: 1, fontFamily: CHAT_FONT.medium },
  actionPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: CHAT_COLORS.white,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 9,
    ...CHAT_SHADOWS.glass,
  },
  actionPillText: { fontSize: 14, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold },
  dropdown: {
    position: 'absolute' as const,
    right: 14,
    minWidth: 200,
    backgroundColor: CHAT_COLORS.white,
    borderRadius: 16,
    paddingVertical: 6,
    ...CHAT_SHADOWS.elevated,
  },
  dropItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  dropText: { color: '#27272A', fontFamily: CHAT_FONT.semibold, fontSize: 15 },
  dropDivider: { height: 1, backgroundColor: CHAT_COLORS.divider, marginHorizontal: 12 },
} as const;
