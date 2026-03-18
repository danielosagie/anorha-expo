import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type ShelfScanProgressCardProps = {
  photoUri: string;
  title: string;
  subtitle: string;
  progress: number;
  totalItems: number;
  completedItems: number;
  stalled?: boolean;
  showActions?: boolean;
  onRetry?: () => void;
  onRetake?: () => void;
};

const LARGE_RIPPLE_FRAMES = [
  '■■■■■\n■□□□■\n■□■□■\n■□□□■\n■■■■■',
  '■□□□■\n□■■■□\n□■□■□\n□■■■□\n■□□□■',
  '□■□■□\n■□■□■\n□■■■□\n■□■□■\n□■□■□',
  '□▪▫▪□\n▪□■□▪\n▫■□■▫\n▪□■□▪\n□▪▫▪□',
  '▫▫▪▫▫\n▫▪□▪▫\n▪□▫□▪\n▫▪□▪▫\n▫▫▪▫▫',
];

const SMALL_RIPPLE_FRAMES = ['■□■', '□■□', '▪□▪', '▫▪▫'];

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

export const ShelfScanProgressCard: React.FC<ShelfScanProgressCardProps> = ({
  photoUri,
  title,
  subtitle,
  progress,
  totalItems,
  completedItems,
  stalled = false,
  showActions = false,
  onRetry,
  onRetake,
}) => {
  const normalizedProgress = Math.max(0, Math.min(1, progress || 0));
  const largeGlyph = useGlyphFrame(LARGE_RIPPLE_FRAMES, stalled ? 540 : 220);
  const smallGlyph = useGlyphFrame(SMALL_RIPPLE_FRAMES, stalled ? 520 : 180);
  const progressPercent = Math.round(normalizedProgress * 100);
  const progressWidth = `${Math.max(8, progressPercent)}%`;
  const meterLabel = totalItems > 0
    ? `${completedItems}/${totalItems} items streamed`
    : `${progressPercent}% analyzed`;

  const stageAccent = useMemo(
    () => (stalled ? '#F59E0B' : '#FFFFFF'),
    [stalled],
  );

  return (
    <View style={styles.shell}>
      <View style={styles.visualFrame}>
        <Image source={{ uri: photoUri }} style={styles.image} resizeMode="cover" />
        <View style={styles.darkWash} />
        <View style={styles.borderLayer} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <Defs>
              <LinearGradient id="outerGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#5EEAD4" stopOpacity="1" />
                <Stop offset="30%" stopColor="#60A5FA" stopOpacity="1" />
                <Stop offset="65%" stopColor="#F472B6" stopOpacity="1" />
                <Stop offset="100%" stopColor="#FDE68A" stopOpacity="1" />
              </LinearGradient>
              <LinearGradient id="innerGlow" x1="100%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
                <Stop offset="35%" stopColor="#C084FC" stopOpacity="0.85" />
                <Stop offset="70%" stopColor="#22D3EE" stopOpacity="0.8" />
                <Stop offset="100%" stopColor="#86EFAC" stopOpacity="0.9" />
              </LinearGradient>
            </Defs>
            <Rect x="1.5" y="1.5" width="97" height="97" rx="8" fill="transparent" stroke="url(#outerGlow)" strokeWidth="2.5" />
            <Rect x="4" y="4" width="92" height="92" rx="6" fill="transparent" stroke="url(#innerGlow)" strokeWidth="1.4" opacity="0.92" />
          </Svg>
        </View>

        <View style={styles.overlayContent}>
          <Text style={styles.largeGlyph}>{largeGlyph}</Text>
          <View style={styles.copyBlock}>
            <Text style={styles.kicker}>{stalled ? 'Still working, but slower than expected' : 'Shelf scan in progress'}</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          <View style={styles.meterPanel}>
            <View style={styles.meterTrack}>
              <View style={[styles.meterFill, { width: progressWidth }]} />
            </View>
            <View style={styles.meterMeta}>
              <Text style={styles.meterText}>{meterLabel}</Text>
              <Text style={[styles.smallGlyph, { color: stageAccent }]}>{smallGlyph}</Text>
            </View>
          </View>
        </View>
      </View>

      {showActions ? (
        <View style={styles.actionRow}>
          {onRetry ? (
            <Pressable style={[styles.actionButton, styles.primaryAction]} onPress={onRetry}>
              <Text style={styles.primaryActionText}>Retry scan</Text>
            </Pressable>
          ) : null}
          {onRetake ? (
            <Pressable style={[styles.actionButton, styles.secondaryAction]} onPress={onRetake}>
              <Text style={styles.secondaryActionText}>Retake photo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

export const ShelfScanPlaceholderRow: React.FC<{
  title: string;
  subtitle: string;
  isResolved?: boolean;
}> = ({ title, subtitle, isResolved = false }) => {
  const glyph = useGlyphFrame(SMALL_RIPPLE_FRAMES, isResolved ? 360 : 180);

  return (
    <View style={[styles.placeholderRow, isResolved && styles.placeholderRowResolved]}>
      <View style={[styles.placeholderGlyphWrap, isResolved && styles.placeholderGlyphWrapResolved]}>
        <Text style={styles.placeholderGlyph}>{glyph}</Text>
      </View>
      <View style={styles.placeholderTextBlock}>
        <Text style={styles.placeholderTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.placeholderSubtitle} numberOfLines={1}>{subtitle}</Text>
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
    height: 360,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#020617',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  darkWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.55)',
  },
  borderLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 22,
  },
  largeGlyph: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 28,
    lineHeight: 30,
    letterSpacing: 4,
    fontWeight: '700',
    textAlign: 'center',
    alignSelf: 'center',
    marginTop: 10,
  },
  copyBlock: {
    gap: 6,
  },
  kicker: {
    color: 'rgba(191,219,254,0.95)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '700',
  },
  subtitle: {
    color: 'rgba(226,232,240,0.92)',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  meterPanel: {
    gap: 8,
  },
  meterTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  meterFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  meterMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meterText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  smallGlyph: {
    color: '#FFFFFF',
    fontSize: 16,
    letterSpacing: 2,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryAction: {
    backgroundColor: '#0F172A',
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryAction: {
    backgroundColor: '#FFFFFF',
  },
  secondaryActionText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  placeholderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  placeholderRowResolved: {
    backgroundColor: '#EEFDF3',
    borderColor: '#BBF7D0',
  },
  placeholderGlyphWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    marginRight: 12,
  },
  placeholderGlyphWrapResolved: {
    backgroundColor: '#14532D',
  },
  placeholderGlyph: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  placeholderTextBlock: {
    flex: 1,
    gap: 2,
  },
  placeholderTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  placeholderSubtitle: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
});
