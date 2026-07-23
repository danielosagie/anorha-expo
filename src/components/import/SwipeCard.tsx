// SwipeCard — the swipeable surface of a Match card.
//
// Right = primary, left = skip, up = ignore. The card
// drags/tilts under the finger with state-specific stamps, then flings off
// and fires. The horizontal pan fails on vertical movement (so the body can
// scroll and the up-pan can fire); the up-pan only activates on a clear
// upward drag and bows out on any horizontal movement.

import React, { createContext, useContext } from 'react';
import { StyleSheet, Text, Dimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Extrapolation,
  SharedValue,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const { width: W, height: H } = Dimensions.get('window');
const X_TH = Math.min(130, W * 0.3);
const Y_TH = 150;

export const SwipeLabelsContext = createContext({
  right: 'Right',
  left: 'Skip',
  up: 'Ignore',
});

interface SwipeCardProps {
  children: React.ReactNode;
  onYes: () => void;
  onNo: () => void;
  onIgnore?: () => void;
  enabled?: boolean;
  /** 0→1 vertical-drag progress, so the shell can swap the action bar for the tray. */
  downShared?: SharedValue<number>;
}

const SwipeCard: React.FC<SwipeCardProps> = ({ children, onYes, onNo, onIgnore, enabled = true, downShared }) => {
  const labels = useContext(SwipeLabelsContext);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const gone = useSharedValue(false);

  const horiz = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-16, 16])
    .failOffsetY([-24, 24])
    .onUpdate((e) => {
      if (!gone.value) x.value = e.translationX;
    })
    .onEnd((e) => {
      if (gone.value) return;
      if (e.translationX > X_TH || e.velocityX > 800) {
        gone.value = true;
        x.value = withTiming(W * 1.3, { duration: 180 }, () => runOnJS(onYes)());
      } else if (e.translationX < -X_TH || e.velocityX < -800) {
        gone.value = true;
        x.value = withTiming(-W * 1.3, { duration: 180 }, () => runOnJS(onNo)());
      } else {
        x.value = withSpring(0, { damping: 18, stiffness: 180 });
      }
    });

  const up = Gesture.Pan()
    .enabled(enabled && !!onIgnore)
    .activeOffsetY([-70, 99999])
    .failOffsetX([-40, 40])
    .onUpdate((e) => {
      if (!gone.value && e.translationY < 0) {
        y.value = e.translationY;
        if (downShared) downShared.value = Math.min(1, Math.abs(e.translationY) / Y_TH);
      }
    })
    .onEnd((e) => {
      if (gone.value) return;
      if ((e.translationY < -Y_TH || e.velocityY < -1100) && onIgnore) {
        gone.value = true;
        if (downShared) downShared.value = 1;
        y.value = withTiming(-H, { duration: 200 }, () => runOnJS(onIgnore)());
      } else {
        y.value = withSpring(0, { damping: 18, stiffness: 180 });
        if (downShared) downShared.value = withSpring(0);
      }
    });

  const gesture = Gesture.Race(horiz, up);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotateZ: `${interpolate(x.value, [-W, 0, W], [-8, 0, 8], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const yesStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [16, X_TH], [0, 1], Extrapolation.CLAMP) }));
  const noStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-X_TH, -16], [1, 0], Extrapolation.CLAMP) }));
  const ignoreStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [-Y_TH, -20], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.fill, cardStyle]}>
        {children}

        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampYes, yesStyle]}>
          <MaterialCommunityIcons name="check-bold" size={18} color="#fff" />
          <Text style={styles.stampText}>{labels.right.toUpperCase()}</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampNo, noStyle]}>
          <MaterialCommunityIcons name="clock-outline" size={18} color="#fff" />
          <Text style={styles.stampText}>{labels.left.toUpperCase()}</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampIgnore, ignoreStyle]}>
          <MaterialCommunityIcons name="eye-off-outline" size={18} color="#fff" />
          <Text style={styles.stampText}>{labels.up.toUpperCase()}</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stamp: {
    position: 'absolute',
    top: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  stampYes: { left: 22, backgroundColor: '#16A34A', transform: [{ rotate: '-12deg' }] },
  stampNo: { right: 22, backgroundColor: '#475569', transform: [{ rotate: '12deg' }] },
  stampIgnore: { top: 18, alignSelf: 'center', backgroundColor: '#B91C1C' },
  stampText: { color: '#fff', fontSize: 18, fontFamily: 'Inter_800ExtraBold', letterSpacing: 1 },
});

export default SwipeCard;
