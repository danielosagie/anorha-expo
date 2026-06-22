import React, { ReactNode, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Dimensions,
  Pressable,
} from 'react-native';
import { X, Info } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';

const SCREEN_H = Dimensions.get('window').height;

/**
 * FieldSheet — the bottom-sheet shell every listing field opens into.
 *
 * Built on reanimated + gesture-handler (not RN's slide Modal) so:
 *  - the scrim FADES IN while the card grows up from the bottom (not the whole
 *    modal sliding up together), and
 *  - you can DRAG the grabber to resize the sheet (taller / shorter) or fling it
 *    down to dismiss. Snaps between a default height, an expanded height, and closed.
 */
export interface FieldSheetProps {
  visible: boolean;
  title: string;
  badge?: string;
  badgeTone?: 'brand' | 'neutral';
  onClose: () => void;
  onInfo?: () => void;
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  saving?: boolean;
  footerExtra?: ReactNode;
  scroll?: boolean;
  maxHeightPct?: number;
  minHeightPct?: number;
  children: ReactNode;
}

export default function FieldSheet({
  visible,
  title,
  badge,
  badgeTone = 'neutral',
  onClose,
  onInfo,
  onSave,
  saveLabel = 'Save',
  saveDisabled = false,
  saving = false,
  footerExtra,
  scroll = true,
  maxHeightPct = 92,
  minHeightPct = 58,
  children,
}: FieldSheetProps) {
  const insets = useSafeAreaInsets();
  const DEFAULT_H = Math.round(SCREEN_H * (minHeightPct / 100));
  const EXPANDED_H = Math.round(SCREEN_H * (maxHeightPct / 100));

  const [mounted, setMounted] = useState(visible);
  const height = useSharedValue(0);

  // Mount on open; animate height→0 then unmount on close.
  useEffect(() => {
    if (visible) {
      setMounted(true);
    } else if (mounted) {
      height.value = withTiming(0, { duration: 200 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Grow up to the default height once mounted (the "card pushes up" entrance).
  useEffect(() => {
    if (mounted) {
      height.value = withSpring(DEFAULT_H, { damping: 24, stiffness: 240, mass: 0.7 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const pan = Gesture.Pan()
    .onChange((e) => {
      'worklet';
      const next = height.value - e.changeY; // drag up (negative changeY) → taller
      height.value = Math.max(0, Math.min(EXPANDED_H, next));
    })
    .onEnd((e) => {
      'worklet';
      const h = height.value;
      const closeThreshold = DEFAULT_H * 0.55;
      const midpoint = (DEFAULT_H + EXPANDED_H) / 2;
      if (h < closeThreshold || e.velocityY > 900) {
        height.value = withTiming(0, { duration: 190 }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else if (h > midpoint || e.velocityY < -700) {
        height.value = withSpring(EXPANDED_H, { damping: 26, stiffness: 240 });
      } else {
        height.value = withSpring(DEFAULT_H, { damping: 26, stiffness: 240 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ height: height.value }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(height.value, [0, DEFAULT_H], [0, 0.45], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;

  const Body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.content, { flexGrow: 1 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, { flex: 1 }]}>{children}</View>
  );

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.overlay}>
          {/* Scrim — fades in with the sheet height, does NOT slide */}
          <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, backdropStyle]} pointerEvents="none" />
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.kav}
            pointerEvents="box-none"
          >
            <Animated.View style={[styles.sheet, sheetStyle]}>
              {/* Drag handle — resize / fling-to-close */}
              <GestureDetector gesture={pan}>
                <View style={styles.grabberZone}>
                  <View style={styles.grabber} />
                </View>
              </GestureDetector>

              <View style={styles.header}>
                <View style={styles.titleRow}>
                  <Text style={styles.title} numberOfLines={1}>{title}</Text>
                  {!!badge && (
                    <View style={[styles.badge, badgeTone === 'brand' && styles.badgeBrand]}>
                      <Text style={[styles.badgeText, badgeTone === 'brand' && styles.badgeTextBrand]}>{badge}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.headerActions}>
                  {!!onInfo && (
                    <TouchableOpacity style={styles.closeCircle} onPress={onInfo} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Info size={17} color={CHAT_COLORS.dim} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.closeCircle} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <X size={18} color={CHAT_COLORS.dim} />
                  </TouchableOpacity>
                </View>
              </View>

              {Body}

              {(onSave || footerExtra) && (
                <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                  {footerExtra}
                  {onSave && (
                    <TouchableOpacity
                      style={[styles.saveBtn, saveDisabled && styles.saveBtnDisabled]}
                      onPress={onSave}
                      disabled={saveDisabled || saving}
                      activeOpacity={0.85}
                    >
                      {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveLabel}>{saveLabel}</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: '#000000' },
  kav: { width: '100%' },
  sheet: {
    backgroundColor: CHAT_COLORS.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  grabberZone: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 6,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 12 },
  title: { fontSize: 19, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: CHAT_COLORS.ink, flexShrink: 1 },
  badge: { backgroundColor: CHAT_COLORS.bubble, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeBrand: { backgroundColor: CHAT_COLORS.brandSoft },
  badgeText: { fontSize: 11, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: CHAT_COLORS.dim },
  badgeTextBrand: { color: CHAT_COLORS.brandDeep },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  closeCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: CHAT_COLORS.bubble, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CHAT_COLORS.divider,
    backgroundColor: CHAT_COLORS.white,
  },
  saveBtn: { height: 54, borderRadius: 999, backgroundColor: CHAT_COLORS.brand, alignItems: 'center', justifyContent: 'center' },
  saveBtnDisabled: { backgroundColor: '#D4D4D8' },
  saveLabel: { color: '#FFFFFF', fontSize: 16, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
});
