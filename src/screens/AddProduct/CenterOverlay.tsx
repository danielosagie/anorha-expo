import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import spinners from 'unicode-animations';
import { UnicodeSpinner } from './UnicodeSpinner';
import { CameraMode } from './types';
import { resolveImageUri } from '../../utils/resolveImageUri';

export const CenterOverlay: React.FC<{
  instruction: string;
  isProcessing: boolean;
  cameraMode: CameraMode;
  scannedBarcode: string | null;
  onCopyBarcode: () => void;
  matchPreview?: {
    imageUrl?: string | null;
    title: string;
    label: string;
    subtitle: string;
    isConfirmed: boolean;
    price?: number | null;
  } | null;
  onPress?: () => void;
  totalPhotos?: number;
  /** Distance from the screen bottom — pins the match card to the camera card's bottom edge. */
  cardBottomOffset?: number;
  /** Horizontal swipe on the match card hops between cart items (1 = next, -1 = prev). */
  onSwipeItem?: (dir: 1 | -1) => void;
}> = ({ instruction, isProcessing, cameraMode, scannedBarcode, onCopyBarcode, matchPreview, onPress, totalPhotos = 0, cardBottomOffset, onSwipeItem }) => {
  const [showCompletionPulse, setShowCompletionPulse] = useState(false);
  const completionPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasProcessingRef = useRef(false);
  const [showPostCaptureHold, setShowPostCaptureHold] = useState(false);
  const postCaptureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTotalPhotosRef = useRef(totalPhotos);

  useEffect(() => {
    if (completionPulseTimeoutRef.current) {
      clearTimeout(completionPulseTimeoutRef.current);
      completionPulseTimeoutRef.current = null;
    }

    if (isProcessing) {
      wasProcessingRef.current = true;
      setShowCompletionPulse(false);
      return;
    }

    if (wasProcessingRef.current) {
      const pulseCycles = 1;
      const pulseExtraDelayMs = 150;
      const pulseDuration = (spinners.pulse.frames.length * spinners.pulse.interval * pulseCycles) + pulseExtraDelayMs;
      setShowCompletionPulse(true);
      completionPulseTimeoutRef.current = setTimeout(() => {
        setShowCompletionPulse(false);
        completionPulseTimeoutRef.current = null;
      }, pulseDuration);
      wasProcessingRef.current = false;
    }
  }, [isProcessing]);

  useEffect(() => {
    return () => {
      if (completionPulseTimeoutRef.current) {
        clearTimeout(completionPulseTimeoutRef.current);
        completionPulseTimeoutRef.current = null;
      }
      if (postCaptureTimeoutRef.current) {
        clearTimeout(postCaptureTimeoutRef.current);
        postCaptureTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (totalPhotos > previousTotalPhotosRef.current) {
      if (postCaptureTimeoutRef.current) {
        clearTimeout(postCaptureTimeoutRef.current);
        postCaptureTimeoutRef.current = null;
      }
      setShowPostCaptureHold(true);
      postCaptureTimeoutRef.current = setTimeout(() => {
        setShowPostCaptureHold(false);
        postCaptureTimeoutRef.current = null;
      }, 1200);
    }
    previousTotalPhotosRef.current = totalPhotos;
  }, [totalPhotos]);

  // Barcode overlay at top middle
  if (cameraMode === 'barcode' && scannedBarcode) {
    return (
      <View style={styles.barcodeOverlayContainer}>
        <Animated.View style={styles.barcodeOverlay} entering={FadeIn}>
          <Text style={styles.barcodeText}>{scannedBarcode}</Text>
          <TouchableOpacity style={styles.copyButton} onPress={onCopyBarcode}>
            <Icon name="content-copy" size={16} color="white" />
            <Text style={styles.copyButtonText}>Copy</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  // Searching/just-captured in camera mode → the loading state lives IN the match-card
  // slot above the controls (wireframe panel 4), not the top instruction pill.
  if (cameraMode === 'camera' && totalPhotos > 0 && (isProcessing || showCompletionPulse || showPostCaptureHold)) {
    return (
      <View style={[styles.matchCardContainer, cardBottomOffset != null && { bottom: cardBottomOffset }]} pointerEvents="box-none">
        <Animated.View entering={FadeIn} style={[styles.centerOverlayMatchCard, styles.matchCardLoading]}>
          <UnicodeSpinner spinner={showCompletionPulse ? spinners.pulse : spinners.helix} color="#0F172A" size={16} />
          <Text style={styles.matchCardLoadingText}>
            {showCompletionPulse ? 'Likely match found' : 'Searching for your item…'}
          </Text>
        </Animated.View>
      </View>
    );
  }

  if (matchPreview && cameraMode !== 'barcode' && !isProcessing && !showCompletionPulse) {
    const imageUri = resolveImageUri(matchPreview);
    // Clean Shop-style row: thumb, title, price — confirmed gets a check, pending
    // gets a quiet Review pill. No shouty caps label, no "tap to…" sentence.
    return (
      <View style={[styles.matchCardContainer, cardBottomOffset != null && { bottom: cardBottomOffset }]} pointerEvents="box-none">
        <PanGestureHandler
          activeOffsetX={[-24, 24]}
          failOffsetY={[-18, 18]}
          onHandlerStateChange={(e: any) => {
            if (e.nativeEvent.state !== State.END) return;
            const { translationX } = e.nativeEvent;
            if (translationX <= -44) onSwipeItem?.(1);
            else if (translationX >= 44) onSwipeItem?.(-1);
          }}
        >
          <Animated.View style={{ width: '100%' }}>
            <TouchableOpacity style={{ width: '100%' }} onPress={onPress} activeOpacity={0.9}>
              <Animated.View entering={FadeIn} style={styles.centerOverlayMatchCard}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.centerOverlayMatchImage} />
                ) : (
                  <View style={[styles.centerOverlayMatchImage, styles.centerOverlayMatchImageFallback]}>
                    <Icon name="image-outline" size={18} color="#64748B" />
                  </View>
                )}
                <View style={styles.centerOverlayMatchTextBlock}>
                  <Text style={styles.centerOverlayMatchTitle} numberOfLines={1}>{matchPreview.title}</Text>
                  {typeof matchPreview.price === 'number' ? (
                    <Text style={styles.centerOverlayMatchPrice}>${Math.round(matchPreview.price)}</Text>
                  ) : null}
                </View>
                {matchPreview.isConfirmed ? (
                  <Icon name="check-circle" size={22} color="#93C822" />
                ) : (
                  <View style={styles.reviewPill}>
                    <Text style={styles.reviewPillText}>Review</Text>
                  </View>
                )}
              </Animated.View>
            </TouchableOpacity>
          </Animated.View>
        </PanGestureHandler>
      </View>
    );
  }

  if (cameraMode === 'camera' && totalPhotos > 0 && !isProcessing && !showCompletionPulse && !showPostCaptureHold) {
    return null;
  }

  const idleInstruction = cameraMode === 'shelf' ? 'Capture shelf to find items' : 'Take a photo to find a match';
  const displayInstruction = showCompletionPulse
    ? 'Likely Match Found'
    : (!isProcessing && instruction === 'Capturing') ? idleInstruction : instruction;
  const showSpinner = isProcessing || showCompletionPulse || showPostCaptureHold;
  const spinner = showCompletionPulse ? spinners.pulse : spinners.helix;

  // Regular instruction overlay - moved to top-middle like barcode.
  // box-none: the container is a full-width strip that overlaps the viewfinder's
  // Back button — only the pill itself may claim touches.
  return (
    <View style={styles.barcodeOverlayContainer} pointerEvents="box-none">
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <Animated.View style={styles.centerOverlay}>
          <Text style={styles.centerOverlayText}>{displayInstruction}</Text>
          {showSpinner && (
            <View style={styles.processingIndicator}>
              <UnicodeSpinner spinner={spinner} color="#FFFFFF" size={16} />
            </View>
          )}
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  centerOverlay: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerOverlayText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  processingIndicator: {
    marginLeft: 8,
  },
  centerOverlayMatchCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  // Match card pinned to the bottom edge of the camera card (host passes the
  // offset); falls back to the old float position if none is given.
  matchCardContainer: {
    position: 'absolute',
    bottom: 300,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 20,
  },
  matchCardLoading: {
    justifyContent: 'center',
    gap: 10,
  },
  matchCardLoadingText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  centerOverlayMatchImage: {
    width: 48,
    height: 48,
    borderRadius: 12,
    marginRight: 10,
  },
  centerOverlayMatchImageFallback: {
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerOverlayMatchTextBlock: {
    flex: 1,
    marginRight: 10,
  },
  centerOverlayMatchTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  centerOverlayMatchPrice: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  reviewPill: {
    backgroundColor: '#EFF7E0',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  reviewPillText: {
    color: '#5C8A0E',
    fontSize: 12,
    fontWeight: '700',
  },
  barcodeOverlayContainer: {
    position: 'absolute',
    top: 172, // Below the top photo bar — sits just inside the cropped viewfinder
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  barcodeOverlay: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  barcodeText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    maxWidth: 200,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  copyButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
});
