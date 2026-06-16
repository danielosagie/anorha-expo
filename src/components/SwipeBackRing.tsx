import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSwipeBackSuppressed, useBackButtonRect } from './SwipeBackContext';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const { height: SCREEN_H } = Dimensions.get('window');

type Props = {
  children: React.ReactNode;
  onBack: () => void;
  /** Indicator diameter. */
  size?: number;
  /** Pull distance (px) to fully commit. */
  threshold?: number;
  /** Activity-ring fill color. */
  accent?: string;
  /** Button fill once the ring completes (armed). */
  armed?: string;
  /** Width of the left-edge grab strip. */
  edgeWidth?: number;
  /** How far (px) the page slides right at a full pull. */
  shift?: number;
  /** Solid color revealed behind the sliding page (never the previous screen). */
  surface?: string;
  /** When false, render children plainly — no gesture, no indicator (e.g. can't go back). */
  enabled?: boolean;
  /**
   * 'slide' (default): page slides right + a floating ring at the thumb.
   * 'pin': page does NOT move — the activity ring draws around the screen's real back button.
   *   Use on screens with their own vertical/sheet gestures, where translating the page
   *   would break them. Position with pinTop/pinLeft to line up with that button.
   */
  mode?: 'slide' | 'pin';
  /** pin mode: ring top, measured from the safe-area top (matches the back button's top). */
  pinTop?: number;
  /** pin mode: ring left. */
  pinLeft?: number;
  /** Bump this (e.g. on screen focus) to force the ring back to its resting state — tab
   *  screens stay mounted, so a committed/half-pulled ring must be cleared on return. */
  resetNonce?: number;
};

/**
 * Dead-simple swipe-back: the page does NOT move. Drag from the left edge and a circular
 * back button appears at your thumb with an activity ring around its border that fills from
 * the bottom in both directions (CW + CCW) up to the top. When the ring completes, the
 * button fills (armed) — release to go back; release short and it fades away.
 *
 * Pair with `gestureEnabled: false` on the screen so react-navigation's own swipe-to-peek
 * never fires.
 */
export const SwipeBackRing: React.FC<Props> = ({
  children,
  onBack,
  size = 56,
  threshold = 130,
  accent = '#9CA3AF',
  armed = '#333333',
  edgeWidth = 32,
  shift = 110,
  surface = '#FFFFFF',
  enabled = true,
  mode = 'slide',
  pinTop = 16,
  pinLeft = 16,
  resetNonce = 0,
}) => {
  const progress = useRef(new Animated.Value(0)).current;
  const progressRef = useRef(0);
  const stageRef = useRef(0);
  const committingRef = useRef(false);
  // The PanResponder is created once and captures the FIRST render's closures. Route
  // onBack through a live ref so a committed swipe always calls the CURRENT handler —
  // otherwise the ring fills on a revisit but the stale back closure no-ops.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const [grabY, setGrabY] = useState(SCREEN_H / 2);
  const suppressed = useSwipeBackSuppressed();
  const insets = useSafeAreaInsets();
  // Pin mode anchors to the screen's REAL back button (measured), so it lands on the
  // button on any device. Falls back to pinTop/pinLeft only until a rect is published.
  const backRect = useBackButtonRect();

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      progressRef.current = value;
      if (committingRef.current) return;
      // Tactile tick at each third, a firmer one at the commit point.
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
    Animated.spring(progress, { toValue: 0, useNativeDriver: false, bounciness: 6, speed: 14 }).start();
  };

  // Snap the ring fully back to rest and re-arm the gesture. Used after a commit and on
  // re-focus so a still-mounted screen never reappears with a frozen/armed ring.
  const reset = () => {
    progress.stopAnimation();
    progress.setValue(0);
    stageRef.current = 0;
    committingRef.current = false;
  };

  const commit = () => {
    committingRef.current = true;
    progress.setValue(1);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    // Hold the armed state a beat so it registers, then pop AND reset — otherwise a
    // screen that stays mounted (tab screens do) comes back with the ring stuck armed
    // and the gesture dead (committingRef never cleared). Call the LATEST onBack (ref),
    // never the first-render closure captured by the PanResponder.
    setTimeout(() => {
      onBackRef.current();
      reset();
    }, 140);
  };

  // Clear any lingering ring state whenever the host bumps resetNonce (e.g. on focus).
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !committingRef.current && g.dx > 8 && Math.abs(g.dy) < Math.abs(g.dx),
      onPanResponderGrant: (e) => setGrabY(e.nativeEvent.pageY),
      // Once the user is actively pulling the ring, don't surrender the touch to the
      // native gesture-handler stack underneath (GestureHandlerRootView / PanGestureHandler
      // on the camera screen). Without this the RNGH stack can cancel the pull mid-gesture.
      onPanResponderTerminationRequest: () => progressRef.current <= 0,
      onPanResponderMove: (_e, g) => {
        if (committingRef.current) return;
        progress.setValue(Math.max(0, Math.min(1, g.dx / threshold)));
      },
      onPanResponderRelease: () => {
        if (committingRef.current) return;
        if (progressRef.current >= 1) commit();
        else snapBack();
      },
      onPanResponderTerminate: () => {
        if (committingRef.current) return;
        // RNGH (e.g. AddProductScreen's PanGestureHandler with failOffsetX) cancels the
        // underlying touch as it resolves its own state, so a COMPLETED swipe-back arrives
        // here as a TERMINATE, not a RELEASE. Commit if fully pulled; otherwise snap back —
        // otherwise the ring lights up and fills but never calls onBack (never navigates).
        if (progressRef.current >= 1) commit();
        else snapBack();
      },
    }),
  ).current;

  // Nothing to go back to (root/tab screens), or a left sheet/drawer is open: leave the
  // page untouched so the left-edge gesture belongs to that surface instead.
  if (!enabled || suppressed) return <View style={{ flex: 1 }}>{children}</View>;

  // Indicator fades/scales in as soon as the pull starts.
  const appear = progress.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });
  const scaleIn = progress.interpolate({ inputRange: [0, 0.14], outputRange: [0.72, 1], extrapolate: 'clamp' });
  const slideIn = progress.interpolate({ inputRange: [0, 0.2], outputRange: [-14, 0], extrapolate: 'clamp' });
  const bgColor = progress.interpolate({ inputRange: [0, 0.9, 1], outputRange: ['#FFFFFF', '#FFFFFF', armed], extrapolate: 'clamp' });
  // Chevron is dark over the white button, flipping to white once it arms (gray fill).
  const chevronDark = progress.interpolate({ inputRange: [0, 0.9, 1], outputRange: [1, 1, 0], extrapolate: 'clamp' });
  const chevronLight = progress.interpolate({ inputRange: [0, 0.9, 1], outputRange: [0, 0, 1], extrapolate: 'clamp' });

  // Activity ring: two arcs from the bottom (6 o'clock) growing up to the top (12 o'clock),
  // one bowing right (CW), one bowing left (CCW), both in lockstep with the pull.
  const stroke = 3;
  // In pin mode, rim the measured back button at its real size; otherwise use `size`.
  const ringSize = mode === 'pin' && backRect ? backRect.width : size;
  const R = (ringSize - stroke) / 2 - 1;
  const cx = ringSize / 2;
  const cy = ringSize / 2;
  const HALF = Math.PI * R;
  const halfOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [HALF, 0], extrapolate: 'clamp' });
  const rightArc = `M ${cx} ${cy + R} A ${R} ${R} 0 0 1 ${cx} ${cy - R}`;
  const leftArc = `M ${cx} ${cy + R} A ${R} ${R} 0 0 0 ${cx} ${cy - R}`;
  // Ring fills in gray, then recolors to the armed tone the moment it completes.
  const ringColor = progress.interpolate({ inputRange: [0, 0.9, 1], outputRange: [accent, accent, armed], extrapolate: 'clamp' });
  const chevron = `M ${cx + 4} ${cy - 7} L ${cx - 4} ${cy} L ${cx + 4} ${cy + 7}`;
  const TRACK = 'rgba(0,0,0,0.10)';

  // ── PIN MODE: page stays put; the ring draws around the screen's real back button. No
  // page wrapper transform (which would break the screen's own sheet/vertical gestures). ──
  if (mode === 'pin') {
    return (
      <View style={styles.root}>
        {children}
        <View {...pan.panHandlers} style={[styles.edge, { width: edgeWidth }]} />
        <Animated.View
          pointerEvents="none"
          style={[styles.pinRing, {
            top: backRect ? backRect.y : insets.top + pinTop,
            left: backRect ? backRect.x : pinLeft,
            width: ringSize,
            height: ringSize,
            opacity: appear,
          }]}
        >
          <Svg width={ringSize} height={ringSize}>
            <Circle cx={cx} cy={cy} r={R} stroke={TRACK} strokeWidth={stroke} fill="none" />
            <AnimatedPath
              d={rightArc}
              stroke={ringColor}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${HALF} ${HALF}`}
              strokeDashoffset={halfOffset}
            />
            <AnimatedPath
              d={leftArc}
              stroke={ringColor}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${HALF} ${HALF}`}
              strokeDashoffset={halfOffset}
            />
          </Svg>
        </Animated.View>
      </View>
    );
  }

  // ── SLIDE MODE (default): the page slides right, tracking how far you've pulled. ──
  const pageShift = progress.interpolate({ inputRange: [0, 1], outputRange: [0, shift], extrapolate: 'clamp' });

  return (
    <View style={[styles.root, { backgroundColor: surface }]}>
      <Animated.View style={[styles.page, { backgroundColor: surface, transform: [{ translateX: pageShift }] }]}>
        {children}
      </Animated.View>

      {/* Left-edge grab strip. */}
      <View {...pan.panHandlers} style={[styles.edge, { width: edgeWidth }]} />

      {/* Floating ring affordance at the thumb — appears only while pulling. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.indicator,
          {
            top: grabY - size / 2,
            width: size,
            height: size,
            opacity: appear,
            transform: [{ scale: scaleIn }, { translateX: slideIn }],
          },
        ]}
      >
        <Animated.View
          style={[styles.btn, { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor }]}
        />
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={cx} cy={cy} r={R} stroke={TRACK} strokeWidth={stroke} fill="none" />
          <AnimatedPath
            d={rightArc}
            stroke={ringColor}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${HALF} ${HALF}`}
            strokeDashoffset={halfOffset}
          />
          <AnimatedPath
            d={leftArc}
            stroke={ringColor}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${HALF} ${HALF}`}
            strokeDashoffset={halfOffset}
          />
          <AnimatedPath
            d={chevron}
            stroke="#18181B"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={chevronDark}
          />
          <AnimatedPath
            d={chevron}
            stroke="#FFFFFF"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={chevronLight}
          />
        </Svg>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1 },
  edge: { position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 60 },
  pinRing: { position: 'absolute', zIndex: 61, alignItems: 'center', justifyContent: 'center' },
  indicator: {
    position: 'absolute',
    left: 14,
    zIndex: 61,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btn: {
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});

export default SwipeBackRing;
