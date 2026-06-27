// The three-dot typing indicator + a single pulsing dot, shared by the live
// activity pill. Moved out of StreamingMessageBubble so the activity card can
// reuse the exact same calm "working on it" affordance.
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export const TypingDot = ({ delay, color = '#93C822', size = 7 }: { delay: number; color?: string; size?: number }) => {
  const progress = useSharedValue(0.3);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 520, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ scale: 0.85 + progress.value * 0.2 }],
  }));
  return (
    <Animated.View
      style={[styles.typingDot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
    />
  );
};

export const TypingIndicator = ({ color, size }: { color?: string; size?: number }) => (
  <View style={styles.typingRow}>
    <TypingDot delay={0} color={color} size={size} />
    <TypingDot delay={140} color={color} size={size} />
    <TypingDot delay={280} color={color} size={size} />
  </View>
);

const styles = StyleSheet.create({
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#93C822',
  },
});
