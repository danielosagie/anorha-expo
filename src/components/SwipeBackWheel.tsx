import React, { useEffect, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Props = {
  onBack: () => void;
  /** Absolute position of the back button (matches the screen's existing back button). */
  top?: number;
  left?: number;
  size?: number;
  /** Pull distance (px) to fully commit. */
  threshold?: number;
  tint?: 'light' | 'dark';
};

/**
 * Pull-to-go-back: drag from the left edge and a ring fills around the back button
 * with a little haptic tick at each third. When the ring completes the button goes
 * white (committed) with a confirming haptic; release there to go back. Release before
 * full and it snaps back. Also works as a plain tap.
 */
export const SwipeBackWheel: React.FC<Props> = ({
  onBack,
  top = 50,
  left = 14,
  size = 40,
  threshold = 96,
  tint = 'light',
}) => {
  const progress = useRef(new Animated.Value(0)).current;
  const progressRef = useRef(0);
  const stageRef = useRef(0);

  const ICON = tint === 'dark' ? '#FFFFFF' : '#18181B';
  const TRACK = tint === 'dark' ? 'rgba(255,255,255,0.25)' : '#E5E5EA';
  const FILL = '#93C822';
  const BG = tint === 'dark' ? 'rgba(255,255,255,0.14)' : '#FFFFFF';

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      progressRef.current = value;
      // Tactile tick at each third, a firmer one on commit.
      const stage = value >= 1 ? 3 : value >= 0.66 ? 2 : value >= 0.33 ? 1 : 0;
      if (stage > stageRef.current) {
        Haptics.impactAsync(
          stage >= 3 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
        ).catch(() => undefined);
      }
      stageRef.current = stage;
    });
    return () => progress.removeListener(id);
  }, [progress]);

  const snapBack = () => {
    stageRef.current = 0;
    Animated.timing(progress, { toValue: 0, duration: 160, useNativeDriver: false }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dx > 8 && Math.abs(g.dy) < Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        progress.setValue(Math.max(0, Math.min(1, g.dx / threshold)));
      },
      onPanResponderRelease: () => {
        if (progressRef.current >= 1) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          progress.setValue(0);
          stageRef.current = 0;
          onBack();
        } else {
          snapBack();
        }
      },
      onPanResponderTerminate: snapBack,
    }),
  ).current;

  const stroke = 3;
  const R = (size - stroke) / 2 - 1;
  const C = 2 * Math.PI * R;
  const dashoffset = progress.interpolate({ inputRange: [0, 1], outputRange: [C, 0] });
  const commitOpacity = progress.interpolate({ inputRange: [0.9, 1], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <>
      {/* Left-edge gesture strip — pulling anywhere here fills the wheel. */}
      <View {...pan.panHandlers} style={[styles.edge, { top }]} />

      {/* The back-button wheel. */}
      <View style={[styles.btnWrap, { top, left, width: size, height: size }]} pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onBack}
          style={[styles.btn, { width: size, height: size, borderRadius: size / 2, backgroundColor: BG }]}
        >
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Circle cx={size / 2} cy={size / 2} r={R} stroke={TRACK} strokeWidth={stroke} fill="none" />
            <AnimatedCircle
              cx={size / 2}
              cy={size / 2}
              r={R}
              stroke={FILL}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${C} ${C}`}
              strokeDashoffset={dashoffset}
            />
          </Svg>
          {/* Goes white when the ring completes (the "let go to go back" state). */}
          <Animated.View
            pointerEvents="none"
            style={[styles.commit, { borderRadius: size / 2, opacity: commitOpacity }]}
          />
          <Icon name="chevron-left" size={22} color={ICON} />
        </TouchableOpacity>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  edge: { position: 'absolute', left: 0, bottom: 0, width: 30, zIndex: 60 },
  btnWrap: { position: 'absolute', zIndex: 61, alignItems: 'center', justifyContent: 'center' },
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  commit: { position: 'absolute', top: 2, left: 2, right: 2, bottom: 2, backgroundColor: '#FFFFFF' },
});

export default SwipeBackWheel;
