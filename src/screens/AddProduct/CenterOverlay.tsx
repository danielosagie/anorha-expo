import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, PixelRatio, StyleSheet, Platform } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  LinearTransition,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import {
  Blur,
  BlurMask,
  Canvas,
  Group,
  Image as SkiaImage,
  RoundedRect,
  makeImageFromView,
  type SkImage,
} from '@shopify/react-native-skia';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import spinners from 'unicode-animations';
import { UnicodeSpinner } from './UnicodeSpinner';
import { CameraMode } from './types';
import { resolveImageUri } from '../../utils/resolveImageUri';

const MATCH_TRANSITION_MS = 260;
const ITEM_IDENTITY_MS = 2600;
const MATCH_CARD_LAYOUT = LinearTransition
  .duration(MATCH_TRANSITION_MS)
  .easing(Easing.bezier(0.22, 1, 0.36, 1))
  .reduceMotion(ReduceMotion.System);

export const CenterOverlay: React.FC<{
  instruction: string;
  isProcessing: boolean;
  cameraMode: CameraMode;
  activeItemKey?: string | null;
  itemIdentity?: string | null;
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
  /** Distance from the screen bottom, which pins the match card to the camera card's bottom edge. */
  cardBottomOffset?: number;
  /** Horizontal swipe on the match card hops between cart items (1 = next, -1 = prev). */
  onSwipeItem?: (dir: 1 | -1) => void;
}> = ({
  instruction,
  isProcessing,
  cameraMode,
  activeItemKey = null,
  itemIdentity,
  scannedBarcode,
  onCopyBarcode,
  matchPreview,
  onPress,
  totalPhotos = 0,
  cardBottomOffset,
  onSwipeItem,
}) => {
  // Wrapped in an object because the key it belongs to is legitimately null (no active
  // item yet). A bare `string | null` made "no hold" and "hold on the null item" the same
  // value, so the idle overlay spun its spinner the moment the camera opened.
  const [postCaptureHold, setPostCaptureHold] = useState<{ itemKey: string | null } | null>(null);
  const [identityItemKey, setIdentityItemKey] = useState<string | null>(itemIdentity ? activeItemKey : null);
  const [searchSnapshot, setSearchSnapshot] = useState<{ itemKey: string | null; image: SkImage } | null>(null);
  const postCaptureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousCaptureRef = useRef({ itemKey: activeItemKey, totalPhotos });
  const snapshotRequestRef = useRef(0);
  const loadingContentRef = useRef<View>(null);
  const previousCardPhaseRef = useRef<'idle' | 'loading' | 'found'>('idle');
  const previousTransitionItemKeyRef = useRef(activeItemKey);
  const reduceMotion = useReducedMotion();
  const transitionProgress = useSharedValue(matchPreview && !isProcessing ? 1 : 0);
  const blurCanvasSize = useSharedValue({ width: 0, height: 0 });
  const showPostCaptureHold = postCaptureHold !== null && postCaptureHold.itemKey === activeItemKey;
  const showLoadingCard = cameraMode === 'camera'
    && totalPhotos > 0
    && (isProcessing || showPostCaptureHold);
  const showFoundCard = Boolean(
    matchPreview
    && cameraMode !== 'barcode'
    && !isProcessing
    && !showPostCaptureHold,
  );
  const cardPhase: 'idle' | 'loading' | 'found' = showLoadingCard
    ? 'loading'
    : showFoundCard
      ? 'found'
      : 'idle';

  useEffect(() => {
    // Item identity owns the transient hold, so equal photo counts cannot carry state across items.
    const previous = previousCaptureRef.current;
    if (previous.itemKey !== activeItemKey) {
      if (postCaptureTimeoutRef.current) clearTimeout(postCaptureTimeoutRef.current);
      postCaptureTimeoutRef.current = null;
      setPostCaptureHold(null);
    } else if (totalPhotos > previous.totalPhotos) {
      if (postCaptureTimeoutRef.current) clearTimeout(postCaptureTimeoutRef.current);
      setPostCaptureHold({ itemKey: activeItemKey });
      postCaptureTimeoutRef.current = setTimeout(() => {
        setPostCaptureHold(null);
        postCaptureTimeoutRef.current = null;
      }, 1200);
    }
    previousCaptureRef.current = { itemKey: activeItemKey, totalPhotos };
  }, [activeItemKey, totalPhotos]);

  useEffect(() => {
    // The existing pill introduces the selected item, then returns to its capture instruction.
    if (identityTimeoutRef.current) clearTimeout(identityTimeoutRef.current);
    setIdentityItemKey(itemIdentity ? activeItemKey : null);
    if (itemIdentity) {
      identityTimeoutRef.current = setTimeout(() => {
        setIdentityItemKey(null);
        identityTimeoutRef.current = null;
      }, ITEM_IDENTITY_MS);
    }
  }, [activeItemKey, itemIdentity]);

  useEffect(() => {
    // One card stays mounted so Reanimated can interpolate its measured loading and result frames.
    const previousPhase = previousCardPhaseRef.current;
    const itemChanged = previousTransitionItemKeyRef.current !== activeItemKey;
    previousCardPhaseRef.current = cardPhase;
    previousTransitionItemKeyRef.current = activeItemKey;
    cancelAnimation(transitionProgress);
    if (cardPhase === 'found') {
      if (reduceMotion) {
        transitionProgress.value = 1;
      } else if (previousPhase !== 'found' || itemChanged) {
        transitionProgress.value = 0;
        transitionProgress.value = withTiming(1, {
          duration: MATCH_TRANSITION_MS,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          reduceMotion: ReduceMotion.System,
        });
      } else {
        transitionProgress.value = 1;
      }
    } else {
      transitionProgress.value = 0;
    }
  }, [activeItemKey, cardPhase, reduceMotion, transitionProgress]);

  useEffect(() => () => {
    searchSnapshot?.image.dispose();
  }, [searchSnapshot]);

  useEffect(() => {
    return () => {
      snapshotRequestRef.current += 1;
      if (postCaptureTimeoutRef.current) clearTimeout(postCaptureTimeoutRef.current);
      if (identityTimeoutRef.current) clearTimeout(identityTimeoutRef.current);
    };
  }, []);

  const captureSearchSnapshot = useCallback(() => {
    // Skia snapshots the real spinner and text so they blur as one surface.
    if (Platform.OS === 'web' || !showLoadingCard || !loadingContentRef.current) return;
    if (searchSnapshot?.itemKey === activeItemKey) return;
    const request = ++snapshotRequestRef.current;
    const snapshotItemKey = activeItemKey;
    requestAnimationFrame(() => {
      makeImageFromView(loadingContentRef)
        .then((image) => {
          if (!image) return;
          if (request !== snapshotRequestRef.current || snapshotItemKey !== activeItemKey) {
            image.dispose();
            return;
          }
          setSearchSnapshot({ itemKey: snapshotItemKey, image });
        })
        .catch(() => undefined);
    });
  }, [activeItemKey, searchSnapshot, showLoadingCard]);

  useEffect(() => {
    // A snapshot belongs to one item only, otherwise a late native capture can flash stale content.
    snapshotRequestRef.current += 1;
    setSearchSnapshot(null);
  }, [activeItemKey]);

  useEffect(() => {
    if (showLoadingCard && searchSnapshot?.itemKey !== activeItemKey) captureSearchSnapshot();
  }, [activeItemKey, captureSearchSnapshot, searchSnapshot?.itemKey, showLoadingCard]);

  const loadingContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(transitionProgress.value, [0, 0.55, 1], [1, 0, 0]),
    transform: [{ scale: interpolate(transitionProgress.value, [0, 1], [1, 0.98]) }],
  }));
  const foundContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(transitionProgress.value, [0, 0.35, 1], [0, 0, 1]),
    transform: [{ scale: interpolate(transitionProgress.value, [0, 1], [0.98, 1]) }],
  }));
  const transitionBlur = useDerivedValue(() => (
    interpolate(transitionProgress.value, [0, 0.48, 1], [0, 7, 0])
  ));
  const snapshotOpacity = useDerivedValue(() => (
    interpolate(transitionProgress.value, [0, 0.18, 0.48, 0.8, 1], [0, 0.75, 1, 0.2, 0])
  ));
  const veilOpacity = useDerivedValue(() => (
    interpolate(transitionProgress.value, [0, 0.3, 0.65, 1], [0, 0.12, 0.32, 0])
  ));
  // makeImageFromView returns device pixels; the canvas draws in points, so an unscaled
  // width paints the snapshot at the screen's pixel ratio and swamps the card.
  const snapshotScale = PixelRatio.get();
  const snapshotWidth = searchSnapshot?.itemKey === activeItemKey
    ? searchSnapshot.image.width() / snapshotScale
    : 0;
  const snapshotHeight = searchSnapshot?.itemKey === activeItemKey
    ? searchSnapshot.image.height() / snapshotScale
    : 0;
  const snapshotX = useDerivedValue(() => Math.max(0, (blurCanvasSize.value.width - snapshotWidth) / 2));
  const snapshotY = useDerivedValue(() => Math.max(0, (blurCanvasSize.value.height - snapshotHeight) / 2));
  const blurWidth = useDerivedValue(() => blurCanvasSize.value.width);
  const blurHeight = useDerivedValue(() => blurCanvasSize.value.height);

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

  if (cardPhase !== 'idle') {
    const imageUri = matchPreview ? resolveImageUri(matchPreview) : null;
    const transitionSnapshot = searchSnapshot?.itemKey === activeItemKey
      ? searchSnapshot.image
      : null;
    // The loading card keeps intrinsic sizing. The same node expands into the result card.
    return (
      <View style={[styles.matchCardContainer, cardBottomOffset != null && { bottom: cardBottomOffset }]} pointerEvents="box-none">
        <PanGestureHandler
          enabled={showFoundCard}
          activeOffsetX={[-24, 24]}
          failOffsetY={[-18, 18]}
          onHandlerStateChange={(e: any) => {
            if (e.nativeEvent.state !== State.END) return;
            const { translationX } = e.nativeEvent;
            if (translationX <= -44) onSwipeItem?.(1);
            else if (translationX >= 44) onSwipeItem?.(-1);
          }}
        >
          <Animated.View style={styles.matchCardGestureContainer}>
            <TouchableOpacity
              style={styles.matchCardTouchable}
              onPress={onPress}
              activeOpacity={0.9}
              disabled={!showFoundCard}
            >
              <Animated.View
                layout={MATCH_CARD_LAYOUT}
                style={[
                  styles.centerOverlayMatchCard,
                  showFoundCard ? styles.matchCardFound : styles.matchCardLoading,
                ]}
              >
                <Animated.View
                  ref={loadingContentRef}
                  collapsable={false}
                  onLayout={captureSearchSnapshot}
                  style={[styles.matchCardLoadingContent, loadingContentStyle]}
                >
                  <UnicodeSpinner spinner={spinners.helix} color="#0F172A" size={16} />
                  <Text style={styles.matchCardLoadingText}>Searching for your item...</Text>
                </Animated.View>

                {matchPreview ? (
                  <Animated.View style={[styles.matchCardFoundContent, foundContentStyle]}>
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
                ) : null}

                <Canvas style={styles.matchCardBlurCanvas} onSize={blurCanvasSize} pointerEvents="none">
                  {transitionSnapshot ? (
                    <Group opacity={snapshotOpacity}>
                      <SkiaImage
                        image={transitionSnapshot}
                        x={snapshotX}
                        y={snapshotY}
                        width={snapshotWidth}
                        height={snapshotHeight}
                        fit="fill"
                      >
                        <Blur blur={transitionBlur} mode="clamp" />
                      </SkiaImage>
                    </Group>
                  ) : null}
                  <Group opacity={veilOpacity}>
                    <RoundedRect x={0} y={0} width={blurWidth} height={blurHeight} r={16} color="#FFFFFF">
                      <BlurMask blur={transitionBlur} style="normal" />
                    </RoundedRect>
                  </Group>
                </Canvas>
              </Animated.View>
            </TouchableOpacity>
          </Animated.View>
        </PanGestureHandler>
      </View>
    );
  }

  const idleInstruction = cameraMode === 'shelf' ? 'Capture shelf to find items' : 'Take a photo to find a match';
  const isIdleInstruction = !isProcessing && instruction === 'Capturing';
  const displayInstruction = isIdleInstruction ? idleInstruction : instruction;
  const showSpinner = isProcessing || showPostCaptureHold;
  const showIdentity = Boolean(itemIdentity && identityItemKey === activeItemKey);
  const pillText = showIdentity ? itemIdentity : displayInstruction;

  // A freshly opened camera has nothing to say — the viewfinder already tells the user to
  // point it at something. The pill earns its place only when it carries live state
  // (scan progress, the active item's name, a result), so the idle tagline stays off.
  if (isIdleInstruction && !showIdentity && !showSpinner) return null;

  // Regular instruction overlay is top-middle like barcode.
  // box-none: the container is a full-width strip that overlaps the viewfinder's
  // Back button. Only the pill itself may claim touches.
  return (
    <View style={styles.barcodeOverlayContainer} pointerEvents="box-none">
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <Animated.View style={styles.centerOverlay}>
          <Text style={styles.centerOverlayText} numberOfLines={1}>{pillText}</Text>
          {showSpinner && (
            <View style={styles.processingIndicator}>
              <UnicodeSpinner spinner={spinners.helix} color="#FFFFFF" size={16} />
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
    alignSelf: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  matchCardGestureContainer: {
    width: '100%',
    alignItems: 'center',
  },
  matchCardTouchable: {
    width: '100%',
    alignItems: 'center',
  },
  matchCardFound: {
    width: '100%',
    minHeight: 68,
  },
  matchCardLoading: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  matchCardLoadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 1,
  },
  matchCardFoundContent: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 1,
  },
  matchCardBlurCanvas: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  // The host offset keeps the card attached to the moving camera frame.
  matchCardContainer: {
    position: 'absolute',
    bottom: 300,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 20,
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
    top: 172, // Below the top photo bar, just inside the cropped viewfinder
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
