import React from 'react';
import {
  LayoutChangeEvent,
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertCircle, CheckCircle2, X } from 'lucide-react-native';
import { ProgressiveBlurView } from '../../../components/ProgressiveBlurView';
import { getSproutTheme } from '../../../design/sproutTheme';

type HeaderAction = {
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
};

type HeaderLabelAction = HeaderAction & {
  label: string;
};

type ChatChromeHeaderProps = {
  /** Omit both to drop the title pill entirely (Sprout's own surfaces carry no label). */
  title?: string;
  subtitle?: string;
  /** Icon-only circle in the middle slot. Takes the title pill's place when set. */
  centerAction?: HeaderAction;
  topInset?: number;
  leftAction?: HeaderLabelAction;
  rightAction?: HeaderAction;
  floating?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  dark?: boolean;
};

/** The shared icon-only affordance: white circle, no label, no glyph text. */
export function ChatCircleButton({
  icon,
  onPress,
  accessibilityLabel,
  dark = false,
}: HeaderAction & { dark?: boolean }) {
  const theme = getSproutTheme(dark);
  return (
    <TouchableOpacity
      style={[
        styles.circleButton,
        dark && {
          backgroundColor: theme.chat.surface,
          borderWidth: 1,
          borderColor: theme.chat.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {icon}
    </TouchableOpacity>
  );
}

export function ChatSurfaceWash({ dark = false }: { dark?: boolean }) {
  const theme = getSproutTheme(dark);
  return (
    <LinearGradient
      pointerEvents="none"
      colors={theme.chat.wash}
      locations={[0, 0.5, 1]}
      style={styles.pageWash}
    />
  );
}

export function ChatChromeHeader({
  title,
  subtitle,
  centerAction,
  topInset = 0,
  leftAction,
  rightAction,
  floating = true,
  onLayout,
  children,
  style,
  dark = false,
}: ChatChromeHeaderProps) {
  const theme = getSproutTheme(dark);
  return (
    <View
      style={[
        styles.header,
        floating ? styles.headerFloating : null,
        { paddingTop: topInset + 6 },
        style,
      ]}
      onLayout={onLayout}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <ProgressiveBlurView
          intensity={Platform.OS === 'ios' ? 50 : 28}
          tint={dark ? 'dark' : 'light'}
          direction="down"
        />
        <LinearGradient
          colors={theme.chat.headerFade}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={styles.headerRow}>
        <View style={styles.sideSlot}>
          {leftAction ? (
            <TouchableOpacity
              style={styles.labelButton}
              onPress={leftAction.onPress}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={leftAction.accessibilityLabel}
            >
              {leftAction.icon}
              <Text style={styles.labelButtonText}>{leftAction.label}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {centerAction ? (
          <ChatCircleButton {...centerAction} dark={dark} />
        ) : title ? (
          <View style={styles.titlePill}>
            <Text style={styles.pillTitle} numberOfLines={1}>{title}</Text>
            {subtitle ? (
              <Text style={styles.pillSub} numberOfLines={1}>{subtitle}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.centerSpacer} />
        )}

        <View style={[styles.sideSlot, styles.rightSlot]}>
          {rightAction ? <ChatCircleButton {...rightAction} dark={dark} /> : null}
        </View>
      </View>

      {children}
    </View>
  );
}

type ChatComposerFooterProps = {
  children: React.ReactNode;
  bottomPadding: number;
  error?: string | null;
  onRetry?: () => void;
  notice?: string | null;
  onDismissNotice?: () => void;
  /** Explicit dark opt-in from Sprout home. */
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ChatComposerFooter({
  children,
  bottomPadding,
  error,
  onRetry,
  notice,
  onDismissNotice,
  dark = false,
  style,
}: ChatComposerFooterProps) {
  const theme = getSproutTheme(dark);
  return (
    <View style={[styles.footer, { paddingBottom: bottomPadding }, style]}>
      <View pointerEvents="none" style={styles.footerBlur}>
        <ProgressiveBlurView
          intensity={Platform.OS === 'ios' ? 50 : 28}
          tint={dark ? 'dark' : 'light'}
          direction="up"
        />
        <LinearGradient
          colors={theme.chat.footerFade}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <AlertCircle size={18} color="#D8434F" />
          <Text style={styles.errorText}>{error}</Text>
          {onRetry ? (
            <TouchableOpacity onPress={onRetry}>
              <Text style={styles.errorRetry}>Retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {notice ? (
        <View style={styles.noticeBanner}>
          <CheckCircle2 size={18} color="#7BB304" />
          <Text style={styles.noticeText}>{notice}</Text>
          {onDismissNotice ? (
            <TouchableOpacity
              onPress={onDismissNotice}
              accessibilityRole="button"
              accessibilityLabel="Dismiss notice"
            >
              <X size={18} color="#18181B" />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {children}
    </View>
  );
}

const shadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.1,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 3,
} as const;

const styles = StyleSheet.create({
  pageWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 310,
  },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: 'transparent',
    zIndex: 12,
  },
  headerFloating: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sideSlot: {
    width: 88,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rightSlot: {
    justifyContent: 'flex-end',
  },
  labelButton: {
    width: 88,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    ...shadow,
  },
  labelButtonText: {
    fontSize: 15,
    color: '#18181B',
    fontFamily: 'Inter_600SemiBold',
  },
  centerSpacer: {
    flex: 1,
  },
  titlePill: {
    flexShrink: 1,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 8,
    ...shadow,
    shadowRadius: 12,
  },
  pillTitle: {
    fontSize: 16,
    color: '#18181B',
    fontFamily: 'Inter_700Bold',
  },
  pillSub: {
    fontSize: 13,
    color: '#71717A',
    marginTop: 1,
    fontFamily: 'Inter_500Medium',
  },
  circleButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    ...shadow,
  },
  footer: {
    paddingTop: 6,
    backgroundColor: 'transparent',
  },
  footerBlur: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -44,
    bottom: 0,
  },
  errorBanner: {
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#EFB6BB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 8px 24px rgba(15, 17, 22, 0.10)',
  },
  errorText: {
    flex: 1,
    color: '#18181B',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  errorRetry: {
    color: '#18181B',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  noticeBanner: {
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#7BB304',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 8px 24px rgba(15, 17, 22, 0.10)',
  },
  noticeText: {
    flex: 1,
    color: '#18181B',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
});
