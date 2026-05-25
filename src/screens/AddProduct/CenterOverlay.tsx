import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import spinners from 'unicode-animations';
import { UnicodeSpinner } from './UnicodeSpinner';
import { CameraMode } from './types';

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
  } | null;
  onPress?: () => void;
  totalPhotos?: number;
}> = ({ instruction, isProcessing, cameraMode, scannedBarcode, onCopyBarcode, matchPreview, onPress, totalPhotos = 0 }) => {
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

  if (matchPreview && cameraMode !== 'barcode' && !isProcessing && !showCompletionPulse) {
    return (
      <View style={styles.barcodeOverlayContainer}>
        <TouchableOpacity style={styles.centerOverlayMatchTouchable} onPress={onPress} activeOpacity={0.9}>
          <Animated.View style={[
            styles.centerOverlayMatchCard,
            matchPreview.isConfirmed ? styles.centerOverlayMatchCardConfirmed : styles.centerOverlayMatchCardPending,
          ]}>
            {matchPreview.imageUrl ? (
              <Image source={{ uri: matchPreview.imageUrl }} style={styles.centerOverlayMatchImage} />
            ) : (
              <View style={[styles.centerOverlayMatchImage, styles.centerOverlayMatchImageFallback]}>
                <Icon name="image-outline" size={18} color="#64748B" />
              </View>
            )}
            <View style={styles.centerOverlayMatchTextBlock}>
              <Text style={styles.centerOverlayMatchLabel} numberOfLines={1}>{matchPreview.label}</Text>
              <Text style={styles.centerOverlayMatchTitle} numberOfLines={1}>{matchPreview.title}</Text>
              <Text style={styles.centerOverlayMatchSubtitle} numberOfLines={1}>{matchPreview.subtitle}</Text>
            </View>
            <View style={styles.centerOverlayChevron}>
              <Icon name={matchPreview.isConfirmed ? 'check-circle' : 'chevron-right-circle'} size={20} color={matchPreview.isConfirmed ? '#93C822' : '#CBD5E1'} />
            </View>
          </Animated.View>
        </TouchableOpacity>
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

  // Regular instruction overlay - moved to top-middle like barcode
  return (
    <View style={styles.barcodeOverlayContainer}>
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
    minHeight: 78,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderWidth: 1,
  },
  centerOverlayMatchTouchable: {
    width: '100%',
    paddingLeft: 116,
    paddingRight: 84,
    marginBottom: 30,
  },
  centerOverlayMatchCardConfirmed: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
  centerOverlayMatchCardPending: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
  centerOverlayMatchImage: {
    width: 52,
    height: 52,
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
  },
  centerOverlayMatchLabel: {
    color: '#7BAF12',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  centerOverlayMatchTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  centerOverlayMatchSubtitle: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
  },
  centerOverlayChevron: {
    marginLeft: 8,
  },
  barcodeOverlayContainer: {
    position: 'absolute',
    top: 135, // Below nav bar
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
