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

type HeaderAction = {
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
};

type HeaderLabelAction = HeaderAction & {
  label: string;
};

type ChatChromeHeaderProps = {
  title: string;
  subtitle: string;
  topInset?: number;
  leftAction?: HeaderLabelAction;
  rightAction?: HeaderAction;
  floating?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ChatSurfaceWash() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(147,200,34,0.14)', 'rgba(147,200,34,0.055)', 'rgba(255,255,255,0)']}
      locations={[0, 0.5, 1]}
      style={styles.pageWash}
    />
  );
}

export function ChatChromeHeader({
  title,
  subtitle,
  topInset = 0,
  leftAction,
  rightAction,
  floating = true,
  onLayout,
  children,
  style,
}: ChatChromeHeaderProps) {
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
          tint="light"
          direction="down"
        />
        <LinearGradient
          colors={[
            'rgba(248,252,240,0.98)',
            'rgba(252,253,249,0.86)',
            'rgba(255,255,255,0)',
          ]}
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

        <View style={styles.titlePill}>
          <Text style={styles.pillTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.pillSub} numberOfLines={1}>{subtitle}</Text>
        </View>

        <View style={[styles.sideSlot, styles.rightSlot]}>
          {rightAction ? (
            <TouchableOpacity
              style={styles.circleButton}
              onPress={rightAction.onPress}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={rightAction.accessibilityLabel}
            >
              {rightAction.icon}
            </TouchableOpacity>
          ) : null}
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
  style?: StyleProp<ViewStyle>;
};

export function ChatComposerFooter({
  children,
  bottomPadding,
  error,
  onRetry,
  notice,
  onDismissNotice,
  style,
}: ChatComposerFooterProps) {
  return (
    <View style={[styles.footer, { paddingBottom: bottomPadding }, style]}>
      <View pointerEvents="none" style={styles.footerBlur}>
        <ProgressiveBlurView
          intensity={Platform.OS === 'ios' ? 50 : 28}
          tint="light"
          direction="up"
        />
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', '#FFFFFF']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <AlertCircle size={14} color="#EF4444" />
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
          <CheckCircle2 size={14} color="#5D7E16" />
          <Text style={styles.noticeText}>{notice}</Text>
          {onDismissNotice ? (
            <TouchableOpacity
              onPress={onDismissNotice}
              accessibilityRole="button"
              accessibilityLabel="Dismiss notice"
            >
              <X size={14} color="#5D7E16" />
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: '#B91C1C',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  errorRetry: {
    color: '#DC2626',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  noticeBanner: {
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(147,200,34,0.3)',
    backgroundColor: 'rgba(147,200,34,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeText: {
    flex: 1,
    color: '#5D7E16',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
});
