import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type ShelfScanProgressCardProps = {
  photoUri: string;
  title: string;
  subtitle: string;
  phase?: string;
  status?: 'idle' | 'streaming' | 'completed' | 'no_items' | 'timeout' | 'error';
  progress: number;
  totalItems: number;
  completedItems: number;
  stalled?: boolean;
  rippleColors?: string[];
};

const RIPPLE_PHASES = new Set(['inspecting_shelf', 'separating_items']);
const SMALL_FRAMES = ['◌', '◎', '◉'];

const useGlyphFrame = (frames: string[], interval: number) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length);
    }, interval);
    return () => clearInterval(timer);
  }, [frames, interval]);

  return frames[frameIndex];
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round((value || 0) * 100)));

const getCounterLabel = (completedItems: number, totalItems: number) => {
  if (totalItems > 0) {
    return `${completedItems}/${Math.max(totalItems, completedItems)} items created`;
  }

  if (completedItems > 0) {
    return `${completedItems} item${completedItems === 1 ? '' : 's'} created`;
  }

  return 'Creating item map';
};

const getStatusCopy = ({
  phase,
  stalled,
  status,
  subtitle,
  progressPercent,
}: {
  phase?: string;
  stalled?: boolean;
  status?: ShelfScanProgressCardProps['status'];
  subtitle: string;
  progressPercent: number;
}) => {
  if (status === 'completed') return 'Shelf scan finished';
  if (status === 'no_items' || status === 'timeout' || status === 'error') return subtitle;
  if (stalled) return 'Connection dipped. Picking the scan back up.';

  switch (phase) {
    case 'inspecting_shelf':
      return 'Starting with a ripple pass over the shelf.';
    case 'separating_items':
      return 'Splitting the shelf into distinct products.';
    case 'reading_labels':
      return 'Reading labels and tightening product names.';
    case 'searching_matches':
      return 'Creating item rows as matches arrive.';
    case 'finishing':
      return progressPercent >= 95 ? 'Wrapping the last item details.' : 'Closing out the final matches.';
    default:
      return subtitle;
  }
};

const getProgressTone = (status?: ShelfScanProgressCardProps['status'], stalled?: boolean) => {
  if (status === 'error' || status === 'timeout' || status === 'no_items') {
    return {
      track: 'rgba(248, 113, 113, 0.24)',
      fill: ['#FB7185', '#F97316'] as [string, string],
      badge: 'rgba(127, 29, 29, 0.72)',
      badgeBorder: 'rgba(252, 165, 165, 0.28)',
    };
  }

  if (stalled) {
    return {
      track: 'rgba(250, 204, 21, 0.20)',
      fill: ['#FACC15', '#86EFAC'] as [string, string],
      badge: 'rgba(113, 63, 18, 0.58)',
      badgeBorder: 'rgba(250, 204, 21, 0.22)',
    };
  }

  return {
    track: 'rgba(134, 239, 172, 0.18)',
    fill: ['#4ADE80', '#22C55E'] as [string, string],
    badge: 'rgba(4, 47, 46, 0.58)',
    badgeBorder: 'rgba(167, 243, 208, 0.18)',
  };
};

const AnimatedGradient = Animated.createAnimatedComponent(ExpoLinearGradient);

export const ShelfScanProgressCard: React.FC<ShelfScanProgressCardProps> = ({
  photoUri,
  title,
  subtitle,
  phase,
  status = 'streaming',
  progress,
  totalItems,
  completedItems,
  stalled = false,
  rippleColors,
}) => {
  const progressPercent = clampPercent(progress);
  const counterLabel = getCounterLabel(completedItems, totalItems);
  const glyph = useGlyphFrame(SMALL_FRAMES, stalled ? 520 : 220);
  const statusCopy = getStatusCopy({ phase, stalled, status, subtitle, progressPercent });
  const tones = getProgressTone(status, stalled);
  const showRipple = RIPPLE_PHASES.has(phase || 'inspecting_shelf') && completedItems === 0 && !stalled;
  const customRipple = rippleColors && rippleColors.length >= 3 ? rippleColors : ['#A7F3D0', '#6EE7B7', '#34D399'];
  const isResolved = status === 'completed';

  const ripplePulse = useSharedValue(0);
  const ripplePulseDelayed = useSharedValue(0);
  const haloPulse = useSharedValue(0);
  const auroraDriftA = useSharedValue(0);
  const auroraDriftB = useSharedValue(0);
  const auroraGlow = useSharedValue(0);

  useEffect(() => {
    ripplePulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: stalled ? 2200 : 1800, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
    ripplePulseDelayed.value = withRepeat(
      withSequence(
        withTiming(1, { duration: stalled ? 2600 : 2100, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
    haloPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: stalled ? 2200 : 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: stalled ? 2200 : 1400, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    auroraDriftA.value = withRepeat(
      withSequence(
        withTiming(1, { duration: stalled ? 6200 : 4200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: stalled ? 6200 : 4200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    auroraDriftB.value = withRepeat(
      withSequence(
        withTiming(1, { duration: stalled ? 7400 : 5000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: stalled ? 7400 : 5000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    auroraGlow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: stalled ? 2600 : 1900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: stalled ? 2600 : 1900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [auroraDriftA, auroraDriftB, auroraGlow, haloPulse, ripplePulse, ripplePulseDelayed, stalled]);

  const rippleStylePrimary = useAnimatedStyle(() => ({
    opacity: interpolate(ripplePulse.value, [0, 1], [0.42, 0]),
    transform: [{ scale: interpolate(ripplePulse.value, [0, 1], [0.72, 1.9]) }],
  }));

  const rippleStyleSecondary = useAnimatedStyle(() => ({
    opacity: interpolate(ripplePulseDelayed.value, [0, 1], [0.34, 0]),
    transform: [{ scale: interpolate(ripplePulseDelayed.value, [0, 1], [0.55, 2.2]) }],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(haloPulse.value, [0, 1], [0.24, 0.52]),
    transform: [{ scale: interpolate(haloPulse.value, [0, 1], [0.96, 1.08]) }],
  }));

  const auroraStyleA = useAnimatedStyle(() => ({
    opacity: interpolate(auroraGlow.value, [0, 1], [0.42, 0.76]),
    transform: [
      { translateX: interpolate(auroraDriftA.value, [0, 1], [-24, 44]) },
      { translateY: interpolate(auroraDriftA.value, [0, 1], [18, -26]) },
      { rotate: `${interpolate(auroraDriftA.value, [0, 1], [-8, 8])}deg` },
      { scale: interpolate(auroraGlow.value, [0, 1], [1, 1.08]) },
    ],
  }));

  const auroraStyleB = useAnimatedStyle(() => ({
    opacity: interpolate(auroraGlow.value, [0, 1], [0.28, 0.58]),
    transform: [
      { translateX: interpolate(auroraDriftB.value, [0, 1], [30, -30]) },
      { translateY: interpolate(auroraDriftB.value, [0, 1], [-8, 24]) },
      { rotate: `${interpolate(auroraDriftB.value, [0, 1], [12, -6])}deg` },
      { scale: interpolate(auroraGlow.value, [0, 1], [0.96, 1.12]) },
    ],
  }));

  const auroraSweepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(auroraGlow.value, [0, 1], [0.18, 0.34]),
    transform: [
      { translateX: interpolate(auroraDriftA.value, [0, 1], [-80, 80]) },
      { skewX: `${interpolate(auroraDriftA.value, [0, 1], [-14, 14])}deg` },
    ],
  }));

  const itemCounter = useMemo(() => {
    if (isResolved && completedItems === 0 && totalItems === 0) {
      return 'Done';
    }

    if (totalItems > 0) {
      return `${completedItems}/${Math.max(totalItems, completedItems)}`;
    }

    return `${completedItems}`;
  }, [completedItems, isResolved, totalItems]);

  return (
    <View style={styles.shell}>
      <View style={styles.visualFrame}>
        <Image source={{ uri: photoUri }} style={styles.image} resizeMode="cover" />
        <View style={styles.imageWash} />

        <Animated.View style={[styles.halo, haloStyle]}>
          <ExpoLinearGradient
            colors={['rgba(110, 231, 183, 0.42)', 'rgba(34, 197, 94, 0.16)', 'transparent']}
            start={{ x: 0.1, y: 0.1 }}
            end={{ x: 0.85, y: 1 }}
            style={styles.fill}
          />
        </Animated.View>

        <AnimatedGradient
          colors={['rgba(134, 239, 172, 0.55)', 'rgba(74, 222, 128, 0.18)', 'transparent']}
          start={{ x: 0.05, y: 0.25 }}
          end={{ x: 0.95, y: 0.85 }}
          style={[styles.auroraBlobA, auroraStyleA]}
        />
        <AnimatedGradient
          colors={['rgba(187, 247, 208, 0.34)', 'rgba(34, 197, 94, 0.16)', 'transparent']}
          start={{ x: 0.8, y: 0.15 }}
          end={{ x: 0.05, y: 0.95 }}
          style={[styles.auroraBlobB, auroraStyleB]}
        />
        <AnimatedGradient
          colors={['transparent', 'rgba(110, 231, 183, 0.20)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.auroraSweep, auroraSweepStyle]}
        />

        {showRipple ? (
          <View style={styles.rippleWrap} pointerEvents="none">
            <Animated.View style={[styles.rippleRing, styles.rippleRingOuter, rippleStyleSecondary]} />
            <Animated.View
              style={[
                styles.rippleRing,
                rippleStylePrimary,
                { borderColor: customRipple[1] },
              ]}
            />
            <View style={[styles.rippleCore, { shadowColor: customRipple[0] }]}>
              <ExpoLinearGradient
                colors={[customRipple[0], customRipple[1], customRipple[2]]}
                start={{ x: 0.1, y: 0.1 }}
                end={{ x: 0.9, y: 0.9 }}
                style={styles.fill}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.overlayContent}>
          <View style={styles.overlayTopRow}>
            <View style={[styles.phaseBadge, { backgroundColor: tones.badge, borderColor: tones.badgeBorder }]}>
              <Text style={styles.phaseBadgeText}>{phase === 'inspecting_shelf' ? 'Ripple start' : 'Aurora scan'}</Text>
            </View>
            <View style={styles.percentBadge}>
              <Text style={styles.percentBadgeText}>{progressPercent}%</Text>
            </View>
          </View>

          <View style={styles.heroTextWrap}>
            <Text style={styles.heroKicker}>Shelf scan</Text>
            <Text style={styles.heroTitle}>{title}</Text>
            <Text style={styles.heroSubtitle}>{statusCopy}</Text>
          </View>
        </View>
      </View>

      <View style={styles.infoPanel}>
        <View style={styles.counterHeader}>
          <View>
            <Text style={styles.counterLabel}>Item counter</Text>
            <Text style={styles.counterValue}>{itemCounter}</Text>
          </View>
          <Text style={styles.counterGlyph}>{glyph}</Text>
        </View>

        <Text style={styles.counterDescription}>{counterLabel}</Text>

        <View style={[styles.progressTrack, { backgroundColor: tones.track }]}>
          <ExpoLinearGradient
            colors={tones.fill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${Math.max(progressPercent, 8)}%` }]}
          />
        </View>

        <Text style={styles.detailCopy}>{subtitle}</Text>
      </View>
    </View>
  );
};

export const ShelfScanPlaceholderRow: React.FC<{
  title: string;
  subtitle: string;
  isResolved?: boolean;
}> = ({ title, subtitle, isResolved = false }) => {
  const glyph = useGlyphFrame(SMALL_FRAMES, isResolved ? 360 : 220);

  return (
    <View style={[styles.placeholderRow, isResolved && styles.placeholderRowResolved]}>
      <View style={styles.placeholderPulse}>
        <Text style={styles.placeholderPulseText}>{glyph}</Text>
      </View>
      <View style={styles.placeholderTextWrap}>
        <Text style={styles.placeholderTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.placeholderSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.placeholderBar}>
        <ExpoLinearGradient
          colors={isResolved ? ['#86EFAC', '#22C55E'] : ['#D9F99D', '#86EFAC']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.fill}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  shell: {
    margin: 20,
    gap: 14,
  },
  visualFrame: {
    height: 318,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#03130B',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 18, 11, 0.60)',
  },
  fill: {
    flex: 1,
  },
  halo: {
    position: 'absolute',
    top: 22,
    right: 22,
    bottom: 22,
    left: 22,
    borderRadius: 999,
  },
  auroraBlobA: {
    position: 'absolute',
    width: 260,
    height: 220,
    top: 40,
    left: -40,
    borderRadius: 999,
  },
  auroraBlobB: {
    position: 'absolute',
    width: 260,
    height: 240,
    bottom: -30,
    right: -26,
    borderRadius: 999,
  },
  auroraSweep: {
    position: 'absolute',
    top: 88,
    left: -50,
    right: -50,
    height: 124,
    borderRadius: 40,
  },
  rippleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rippleRing: {
    position: 'absolute',
    width: 142,
    height: 142,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#6EE7B7',
    backgroundColor: 'rgba(110, 231, 183, 0.04)',
  },
  rippleRingOuter: {
    borderColor: 'rgba(167, 243, 208, 0.72)',
  },
  rippleCore: {
    width: 72,
    height: 72,
    borderRadius: 999,
    overflow: 'hidden',
    shadowOpacity: 0.55,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
  },
  overlayContent: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 20,
    paddingVertical: 18,
    justifyContent: 'space-between',
  },
  overlayTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  phaseBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  phaseBadgeText: {
    color: '#F0FDF4',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  percentBadge: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  percentBadgeText: {
    color: '#F0FDF4',
    fontSize: 12,
    fontWeight: '700',
  },
  heroTextWrap: {
    gap: 6,
  },
  heroKicker: {
    color: 'rgba(220, 252, 231, 0.86)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#F0FDF4',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: 'rgba(220, 252, 231, 0.90)',
    fontSize: 14,
    lineHeight: 20,
    maxWidth: '86%',
  },
  infoPanel: {
    borderRadius: 24,
    backgroundColor: '#06150D',
    borderWidth: 1,
    borderColor: 'rgba(134, 239, 172, 0.14)',
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 12,
  },
  counterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  counterLabel: {
    color: '#86EFAC',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  counterValue: {
    color: '#F0FDF4',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    marginTop: 4,
  },
  counterGlyph: {
    color: '#86EFAC',
    fontSize: 22,
    fontWeight: '700',
  },
  counterDescription: {
    color: 'rgba(220, 252, 231, 0.94)',
    fontSize: 15,
    fontWeight: '600',
  },
  progressTrack: {
    height: 11,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  detailCopy: {
    color: 'rgba(187, 247, 208, 0.78)',
    fontSize: 13,
    lineHeight: 18,
  },
  placeholderRow: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 22,
    backgroundColor: '#07170F',
    borderWidth: 1,
    borderColor: 'rgba(134, 239, 172, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  placeholderRowResolved: {
    borderColor: 'rgba(74, 222, 128, 0.22)',
    backgroundColor: '#0A1C12',
  },
  placeholderPulse: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: 'rgba(74, 222, 128, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  placeholderPulseText: {
    color: '#86EFAC',
    fontSize: 18,
    fontWeight: '700',
  },
  placeholderTextWrap: {
    flex: 1,
    gap: 4,
  },
  placeholderTitle: {
    color: '#F0FDF4',
    fontSize: 15,
    fontWeight: '700',
  },
  placeholderSubtitle: {
    color: 'rgba(187, 247, 208, 0.72)',
    fontSize: 12,
    lineHeight: 17,
  },
  placeholderBar: {
    width: 46,
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    marginLeft: 12,
    backgroundColor: 'rgba(134, 239, 172, 0.12)',
  },
});
