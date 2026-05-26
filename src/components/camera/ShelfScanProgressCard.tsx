import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AuroraOverlay, RippleShader } from '@native-springs/shaders';

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

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

const getStatusText = (
  phase?: string,
  status?: ShelfScanProgressCardProps['status'],
  stalled?: boolean,
): string => {
  if (status === 'completed') return 'Done';
  if (status === 'no_items') return 'No items found';
  if (status === 'timeout') return 'Scan timed out';
  if (status === 'error') return 'Scan failed';
  if (stalled) return 'Reconnecting...';
  switch (phase) {
    case 'inspecting_shelf': return 'Scanning shelf...';
    case 'separating_items': return 'Finding items...';
    case 'reading_labels': return 'Reading labels...';
    case 'searching_matches': return 'Matching products...';
    case 'finishing': return 'Wrapping up...';
    default: return 'Analyzing...';
  }
};

const RIPPLE_DURATION_S = 3.0;

export const ShelfScanProgressCard: React.FC<ShelfScanProgressCardProps> = ({
  photoUri,
  phase,
  status = 'streaming',
  progress,
  totalItems,
  completedItems,
  stalled = false,
}) => {
  const [touchTime, setTouchTime] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== 'streaming') return;
    let cycleStart = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - cycleStart) / 1000;
      if (elapsed >= RIPPLE_DURATION_S) {
        cycleStart = Date.now();
        setTouchTime(0);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      setTouchTime(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [status]);

  const auroraOpacity = useSharedValue(0);
  useEffect(() => {
    const target = status === 'streaming' ? 0.22 : 0;
    auroraOpacity.value = withTiming(target, { duration: 450 });
  }, [status, auroraOpacity]);
  const auroraStyle = useAnimatedStyle(() => ({ opacity: auroraOpacity.value }));

  const count = useSharedValue(completedItems || 0);
  useEffect(() => {
    count.value = withTiming(completedItems || 0, { duration: 600 });
  }, [completedItems, count]);
  const counterProps = useAnimatedProps(() => ({
    text: String(Math.round(count.value)),
  } as any));

  const percent = Math.round(Math.max(0, Math.min(1, progress || 0)) * 100);
  const statusText = getStatusText(phase, status, stalled);
  const hasItemCount = totalItems > 0;
  const subline = hasItemCount ? `of ${totalItems} · ${statusText}` : statusText;

  const imageEl = <Image source={{ uri: photoUri }} style={styles.image} resizeMode="cover" />;

  return (
    <View style={styles.shell}>
      <View style={styles.frame}>
        {Platform.OS === 'web' ? (
          imageEl
        ) : (
          <>
            <RippleShader
              parameters={{
                intensity: 0.65,
                touchPoint: [0.5, 0.5],
                touchTime,
                rippleVariant: 'realistic',
                speed: 180,
                damping: 0.35,
                displacementStrength: 0.05,
                highlightStrength: 0.10,
                color: '#4ADE80',
              }}
              style={styles.shader}
            >
              {imageEl}
            </RippleShader>
          </>
        )}

        <View style={styles.scrim} pointerEvents="none" />

        {Platform.OS !== 'web' && (
          <Animated.View style={[styles.auroraLayer, auroraStyle]} pointerEvents="none">
            <AuroraOverlay
              parameters={{
                intensity: 0.55,
                color: '#4ADE80',
                direction: [0.15, 1.0],
                borderFade: 0.35,
              }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}

        <View style={styles.overlay} pointerEvents="none">
          {hasItemCount ? (
            <AnimatedTextInput
              editable={false}
              caretHidden
              underlineColorAndroid="transparent"
              defaultValue={String(completedItems || 0)}
              animatedProps={counterProps}
              style={styles.counter}
            />
          ) : (
            <Text style={styles.counter}>{percent}%</Text>
          )}
          <Text style={styles.statusText}>{subline}</Text>
        </View>
      </View>
    </View>
  );
};

export const ShelfScanPlaceholderRow: React.FC<{
  title: string;
  subtitle: string;
  isResolved?: boolean;
}> = ({ title, subtitle, isResolved = false }) => (
  <View style={[styles.placeholderRow, isResolved && styles.placeholderRowResolved]}>
    <View style={[styles.placeholderDot, isResolved && styles.placeholderDotResolved]} />
    <View style={styles.placeholderTextWrap}>
      <Text style={styles.placeholderTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.placeholderSubtitle} numberOfLines={1}>
        {subtitle}
      </Text>
    </View>
    <View style={[styles.placeholderBar, isResolved && styles.placeholderBarResolved]} />
  </View>
);

const styles = StyleSheet.create({
  shell: {
    margin: 20,
  },
  frame: {
    height: 340,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#03130B',
  },
  shader: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  auroraLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 14, 8, 0.45)',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  counter: {
    fontSize: 64,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1.5,
    padding: 0,
    margin: 0,
    textAlign: 'center',
    minWidth: 80,
    lineHeight: 70,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.78)',
    letterSpacing: 0.2,
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
    gap: 12,
  },
  placeholderRowResolved: {
    borderColor: 'rgba(74, 222, 128, 0.28)',
    backgroundColor: '#0A1C12',
  },
  placeholderDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(134, 239, 172, 0.45)',
    flexShrink: 0,
  },
  placeholderDotResolved: {
    backgroundColor: '#4ADE80',
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
    backgroundColor: 'rgba(134, 239, 172, 0.18)',
    flexShrink: 0,
  },
  placeholderBarResolved: {
    backgroundColor: '#4ADE80',
  },
});
