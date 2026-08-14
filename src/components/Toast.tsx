import React, { useCallback, useEffect, useId } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, CircleAlert, Info, TriangleAlert } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastHostRegistration } from '../context/ToastContext';
import { getToastDuration, type ToastRecord, type ToastTone } from '../context/toastState';

const TONE: Record<ToastTone, { icon: string; border: string }> = {
  neutral: { icon: '#18181B', border: '#E5E7EB' },
  success: { icon: '#7BB304', border: '#7BB304' },
  warn: { icon: '#D39329', border: '#E8C88A' },
  danger: { icon: '#D8434F', border: '#EFB6BB' },
};

function ToneIcon({ tone }: { tone: ToastTone }) {
  const color = TONE[tone].icon;
  if (tone === 'success') return <Check size={18} color={color} strokeWidth={2.5} />;
  if (tone === 'warn') return <TriangleAlert size={18} color={color} strokeWidth={2.2} />;
  if (tone === 'danger') return <CircleAlert size={18} color={color} strokeWidth={2.2} />;
  return <Info size={18} color={color} strokeWidth={2.2} />;
}

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  const translateY = useSharedValue(12);
  const opacity = useSharedValue(0);

  const finishDismiss = useCallback(() => onDismiss(toast.id), [onDismiss, toast.id]);
  const dismissAnimated = useCallback(() => {
    translateY.value = withTiming(24, { duration: 140, easing: Easing.in(Easing.cubic) });
    opacity.value = withTiming(0, { duration: 120 }, finished => {
      if (finished) runOnJS(finishDismiss)();
    });
  }, [finishDismiss, opacity, translateY]);

  useEffect(() => {
    translateY.value = 12;
    opacity.value = 0;
    translateY.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
    opacity.value = withTiming(1, { duration: 150 });

    const expiresAt = toast.shownAt + getToastDuration(toast);
    const timeout = setTimeout(dismissAnimated, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [dismissAnimated, opacity, toast, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const swipeDown = Gesture.Pan()
    .activeOffsetY(6)
    .failOffsetX([-18, 18])
    .onUpdate(event => {
      translateY.value = Math.max(0, event.translationY);
      opacity.value = Math.max(0.35, 1 - event.translationY / 160);
    })
    .onEnd(event => {
      if (event.translationY > 32 || event.velocityY > 450) {
        runOnJS(dismissAnimated)();
        return;
      }
      translateY.value = withTiming(0, { duration: 150, easing: Easing.out(Easing.cubic) });
      opacity.value = withTiming(1, { duration: 120 });
    });

  const handleAction = () => {
    onDismiss(toast.id);
    toast.action?.onPress();
  };

  return (
    <GestureDetector gesture={swipeDown}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[
          styles.card,
          { borderColor: TONE[toast.tone].border },
          animatedStyle,
        ]}
      >
        <View style={styles.iconSlot}>
          <ToneIcon tone={toast.tone} />
        </View>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {toast.title}
        </Text>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={handleAction}
            hitSlop={8}
            style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
          >
            <Text style={styles.actionText}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

export function ToastHost({
  enabled = true,
  priority = 0,
  ignoreAnchors = false,
}: {
  enabled?: boolean;
  priority?: number;
  ignoreAnchors?: boolean;
}) {
  const id = useId();
  const insets = useSafeAreaInsets();
  const { toast, activeHostId, bottomAnchorHeight, dismissToast } = useToastHostRegistration(
    id,
    enabled,
    priority,
  );
  const active = enabled && activeHostId === id;
  const occupiedBottom = !ignoreAnchors && bottomAnchorHeight > 0
    ? bottomAnchorHeight
    : insets.bottom;

  if (!active || !toast) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={[styles.host, { bottom: occupiedBottom + 16 }]}>
        <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 10000,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderRadius: 14,
    borderCurve: 'continuous',
    boxShadow: '0 8px 24px rgba(15, 17, 22, 0.10)',
  },
  iconSlot: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: '#18181B',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 19,
  },
  action: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderRadius: 8,
    borderCurve: 'continuous',
  },
  actionPressed: {
    backgroundColor: '#F3F4F6',
  },
  actionText: {
    color: '#18181B',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
});

export default ToastHost;
