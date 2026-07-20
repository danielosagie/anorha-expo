import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, FadeIn, SlideInDown, withTiming, runOnJS } from 'react-native-reanimated';
import { PanGestureHandler, State, type PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { ENABLE_DOC_MODES } from '../../config/features';
import { CameraMode } from './types';
import { createLogger } from '../../utils/logger';
const log = createLogger('BottomControls');


const MAX_BATCH_ITEMS = 100;

export const BottomControls: React.FC<{
  onCapture: () => void;
  isCapturing: boolean;
  captureButtonScale: any;
  photosCount: number;
  cameraMode: CameraMode;
  onSetCameraMode: (mode: CameraMode) => void;
  onImageUpload: () => void;
  onContinue: () => void;
  hasBarcodeResult?: boolean;
  productName?: string;
  // Item navigation props
  items: Array<{ id: string; photos: any[]; title?: string }>;
  activeItemId: string | null;
  onSelectItem: (id: string) => void;
  onNewItem: () => void;
  onOpenBarcodeEntry?: () => void;
  showDeepSearchSheet?: boolean;
  onOpenSheet?: () => void;
  matchedItemsCount?: number;
  maxItems?: number;
  shelfItemCount?: number;
  isShelfStreaming?: boolean;
  isShelfHandling?: boolean;
}> = ({
  onCapture,
  isCapturing,
  captureButtonScale,
  photosCount,
  cameraMode,
  onSetCameraMode,
  onImageUpload,
  onContinue,
  hasBarcodeResult,
  productName,
  items,
  activeItemId,
  onSelectItem,
  onNewItem,
  onOpenBarcodeEntry,
  showDeepSearchSheet = false,
  onOpenSheet,
  matchedItemsCount = 0,
  maxItems = MAX_BATCH_ITEMS,
  shelfItemCount = 0,
  isShelfStreaming = false,
  isShelfHandling = false,
}) => {
    const activeIndex = items.findIndex(i => i.id === activeItemId);
    const totalItems = items.length;
    const shelfHandling = cameraMode === 'shelf' || isShelfHandling;
    // Drag-to-select logic using simple state
    const [hoveredMode, setHoveredMode] = useState<CameraMode | null>(null);
    const [showModePopup, setShowModePopup] = useState(false);
    const popupScale = useSharedValue(0);
    const popupOpacity = useSharedValue(0);

    const captureButtonAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: captureButtonScale.value }],
    }));

    const popupAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: popupScale.value }],
      opacity: popupOpacity.value,
    }));

    const toggleModePopup = useCallback(() => {
      if (showModePopup) {
        // Close smoothly
        popupScale.value = withTiming(0, { duration: 150 });
        popupOpacity.value = withTiming(0, { duration: 150 }, () => {
          runOnJS(setShowModePopup)(false);
        });
      } else {
        setShowModePopup(true);
        popupScale.value = withTiming(1, { duration: 200 });
        popupOpacity.value = withTiming(1, { duration: 150 });
      }
    }, [showModePopup, popupScale, popupOpacity]);

    const selectMode = useCallback((mode: CameraMode) => {
      onSetCameraMode(mode);
      // Smooth close
      popupScale.value = withTiming(0, { duration: 150 });
      popupOpacity.value = withTiming(0, { duration: 150 }, () => {
        runOnJS(setShowModePopup)(false);
      });
      setHoveredMode(null);
    }, [onSetCameraMode, popupScale, popupOpacity]);

    const modes: CameraMode[] = ENABLE_DOC_MODES
      ? ['camera', 'barcode', 'shelf', 'manifest', 'receipt']
      : ['camera', 'barcode', 'shelf'];

    const POPUP_WIDTH = 90 * modes.length;
    const ITEM_WIDTH = POPUP_WIDTH / modes.length;

    // EXPERIMENTAL: Long press on mode button to toggle text search
    const onLongPressMode = () => {
      // Toggle text search from parent? We need a callback prop for this
      // For now, we'll just log it. In real usage, pass onTextSearchToggle prop.
      log.debug('Long press mode button');
    };

    // Pan gesture handler callback (non-deprecated approach)
    const onPanGestureEvent = useCallback((event: PanGestureHandlerGestureEvent) => {
      const x = event.nativeEvent.x;
      const modeIndex = Math.floor(x / ITEM_WIDTH);
      const activeModes: CameraMode[] = ENABLE_DOC_MODES
        ? ['camera', 'barcode', 'shelf', 'manifest', 'receipt']
        : ['camera', 'barcode', 'shelf'];
      let newMode: CameraMode | null = null;
      if (modeIndex >= 0 && modeIndex < activeModes.length) {
        newMode = activeModes[modeIndex];
      }

      if (newMode && newMode !== hoveredMode) {
        setHoveredMode(newMode);
        Haptics.selectionAsync();
      }
    }, [hoveredMode, ITEM_WIDTH, POPUP_WIDTH]);

    const onPanHandlerStateChange = useCallback((event: PanGestureHandlerGestureEvent) => {
      if (event.nativeEvent.state === State.END) {
        if (hoveredMode) {
          selectMode(hoveredMode);
        }
      }
    }, [hoveredMode, selectMode]);

    const getModeIcon = (mode: CameraMode): string => {
      switch (mode) {
        case 'camera': return 'camera';
        case 'barcode': return 'barcode-scan';
        case 'manifest': return 'file-document-outline';
        case 'receipt': return 'receipt';
        case 'shelf': return 'layers';
      }
    };

    const getModeLabel = (mode: CameraMode): string => {
      switch (mode) {
        case 'camera': return 'Camera';
        case 'barcode': return 'Barcode';
        case 'manifest': return ENABLE_DOC_MODES ? 'Manifest' : '';
        case 'receipt': return ENABLE_DOC_MODES ? 'Receipt' : '';
        case 'shelf': return 'Shelf';
      }
    };

    const getContinueText = () => {
      if (cameraMode === 'barcode' && hasBarcodeResult) {
        return 'Open scanned item';
      }
      if (cameraMode === 'manifest' && ENABLE_DOC_MODES) {
        return photosCount > 0
          ? `Parse ${photosCount} page${photosCount > 1 ? 's' : ''}`
          : 'Capture manifest pages';
      }
      if (cameraMode === 'receipt' && ENABLE_DOC_MODES) {
        return photosCount > 0
          ? `Process ${photosCount} receipt${photosCount > 1 ? 's' : ''}`
          : 'Capture receipt';
      }
      if (shelfHandling) {
        if (isShelfStreaming) return shelfItemCount > 0 ? `${shelfItemCount} found` : 'Finding items…';
        if (shelfItemCount > 0) return `${shelfItemCount} item${shelfItemCount === 1 ? '' : 's'} on your shelf`;
      }
      if (photosCount === 0) return 'Take a photo to get started';
      return 'Cart';
    };

    const activeMode = hoveredMode || cameraMode;

    return (
      <View style={styles.bottomControls}>
        <Animated.View entering={FadeIn.delay(500)} style={styles.controlsRow}>
          <View style={{ gap: 4, justifyContent: "center" }}>
            <TouchableOpacity style={[styles.galleryButton, { gap: 4 }]} onPress={() => onImageUpload()}>
              <Icon name="image-multiple-outline" size={24} color="white" />
            </TouchableOpacity>
            <Text style={{ color: "#FFF", fontSize: 12, fontWeight: 500, textAlign: "center" }}>Upload</Text>
          </View>



          <Animated.View style={captureButtonAnimatedStyle}>
            <TouchableOpacity
              style={styles.captureButton}
              onPress={onCapture}
              disabled={isCapturing}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          </Animated.View>

          {/* Mode selector with popup */}
          <View style={styles.modeSelectorWrapper}>
            {/* Popup bubble */}
            {showModePopup && (
              <Animated.View style={[styles.modePopup, popupAnimatedStyle]}>
                <PanGestureHandler
                  onGestureEvent={onPanGestureEvent}
                  onHandlerStateChange={onPanHandlerStateChange}
                >
                  <Animated.View style={[styles.modePopupContent, { width: POPUP_WIDTH }]}>
                    {modes.map((mode, index) => (
                      <TouchableOpacity
                        key={mode}
                        style={[
                          styles.modePopupItem,
                          activeMode === mode && styles.modePopupItemActive,
                          //activeMode === mode && mode === 'shelf' && { backgroundColor: '#FF8A65' }
                        ]}
                        onPress={() => selectMode(mode)}
                        activeOpacity={1}
                      >
                        <Text style={[
                          styles.modePopupLabel,
                          activeMode === mode && styles.modePopupLabelActive,
                        ]}>
                          {getModeLabel(mode)}
                        </Text>
                        <View style={[
                          styles.modePopupIconContainer,
                          activeMode === mode && styles.modePopupIconContainerActive,
                        ]}>
                          <Icon
                            name={getModeIcon(mode)}
                            size={28}
                            color={activeMode === mode ? '#fff' : 'rgba(255,255,255,0.7)'}
                          />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </Animated.View>
                </PanGestureHandler>
                <View style={{ flex: 1, paddingRight: 25 }}>
                  {/* Speech bubble arrow - Positioned relative to button center */}
                  <View style={styles.modePopupArrow} />
                </View>

              </Animated.View>
            )}

            {/* Current mode button MODE (collapsed state) cameraMode === 'shelf' && { backgroundColor: '#FF8A65', borderColor: '#FF8A65' } */}
            <TouchableOpacity
              style={[styles.modeButton]}
              onPress={toggleModePopup}
            >
              <Icon
                name={getModeIcon(cameraMode)}
                size={24}
                color="white"
              />
            </TouchableOpacity>
            <Text style={{ color: "#FFF", fontSize: 12, fontWeight: 500, textAlign: "center" }}>Mode</Text>
          </View>
        </Animated.View>

        {((shelfHandling && !showDeepSearchSheet && (isShelfStreaming || shelfItemCount > 0 || items.length > 0) && onOpenSheet) || (!shelfHandling && (cameraMode === 'barcode' || photosCount >= 1 || items.some((i) => i.title)))) && (
          <Animated.View entering={SlideInDown.delay(700)} style={styles.continueButtonContainer}>
            {cameraMode === 'barcode' ? (
              hasBarcodeResult ? (
                <View style={styles.barcodeActionsRow}>
                  {onOpenBarcodeEntry && (
                    <TouchableOpacity
                      style={styles.barcodeSecondaryButton}
                      onPress={onOpenBarcodeEntry}
                    >
                      <Text style={styles.barcodeSecondaryText}>Enter manually</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.continueButton}
                    onPress={onContinue}
                  >
                    <Text style={styles.continueButtonText} numberOfLines={1}>
                      {getContinueText()}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.barcodeActionsRow}>
                  {onOpenBarcodeEntry && (
                    <TouchableOpacity
                      style={styles.continueButton}
                      onPress={onOpenBarcodeEntry}
                    >
                      <Text style={styles.continueButtonText} numberOfLines={1}>
                        Enter barcode manually
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            ) : (
              <View style={styles.itemNavRow}>
                {/* Left Arrow - Previous Item */}
                <TouchableOpacity
                  style={[styles.itemNavArrow, activeIndex <= 0 && styles.itemNavArrowDisabled]}
                  onPress={() => {
                    if (activeIndex > 0) onSelectItem(items[activeIndex - 1].id);
                  }}
                  disabled={activeIndex <= 0}
                >
                  <Icon name="chevron-left" size={24} color={activeIndex > 0 ? "#FFF" : "rgba(255,255,255,0.3)"} />
                </TouchableOpacity>

                {/* Center - Cart button (opens the cart; reachability lift).
                    Shelf prefers the bulk-items sheet when available. */}
                <TouchableOpacity
                  style={styles.continueButton}
                  onPress={shelfHandling && onOpenSheet ? onOpenSheet : onContinue}
                >
                  {(photosCount > 0 || shelfItemCount > 0) && <Icon name="cart-outline" size={18} color="#FFF" style={{ marginRight: 6 }} />}
                  <Text style={styles.continueButtonText} numberOfLines={1}>
                    {getContinueText()}
                  </Text>
                  {totalItems > 0 && (
                    <View style={[styles.itemCountBadge, { marginRight: 0, marginLeft: 8 }]}>
                      <Text style={styles.itemCountBadgeText}>{totalItems}</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* Right Arrow/New Item */}
                {activeIndex < totalItems - 1 ? (
                  <TouchableOpacity
                    style={styles.itemNavArrow}
                    onPress={() => onSelectItem(items[activeIndex + 1].id)}
                  >
                    <Icon name="chevron-right" size={24} color="#FFF" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.itemNavArrow, styles.itemNavNewButton]}
                    onPress={onNewItem}
                    disabled={totalItems >= maxItems}
                  >
                    <Icon name="plus" size={24} color={totalItems >= maxItems ? 'rgba(255,255,255,0.4)' : '#FFF'} />
                    <Text style={[styles.continueButtonText, totalItems >= maxItems && { color: 'rgba(255,255,255,0.6)' }]}>
                      {totalItems >= maxItems ? 'Limit reached' : 'New'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </Animated.View>
        )}
      </View>
    );
  };



const styles = StyleSheet.create({
  bottomControls: {
    position: 'absolute',
    bottom: 16, // navigator row removed on this screen; controls own the bottom edge
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    zIndex: 10,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    marginBottom: 20,
  },
  galleryButton: {
    flexDirection: "column",
    justifyContent: 'center',
    alignItems: 'center',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  captureButtonInner: {
    width: 75,
    height: 75,
    borderRadius: 60,
    borderColor: "#00000033",
    borderWidth: 5,
    backgroundColor: 'white',
  },
  modeSelectorWrapper: {
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
    zIndex: 100, // Ensure popup is above other elements
  },
  modeButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  modePopup: {
    position: 'absolute',
    right: -40,
    bottom: 65, // Position above the button
    alignItems: 'flex-end',
    width: 350, // Wide enough for 3 items
    // Center the popup (280px) over the button (50px).
    // Button is right aligned in wrapper. Wrapper is 50px.
    // To center 280 over 50: right = -(280-50)/2 = -115
    paddingRight: 30,
  },
  modePopupContent: {
    flexDirection: 'row',
    backgroundColor: '#000',
    borderRadius: 24,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'space-between',
    width: '100%',
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.30, shadowRadius: 4.65 },
      android: { elevation: 8 },
    }),
  },
  modePopupItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 8,
    flex: 1,
  },
  modePopupItemActive: {
    backgroundColor: 'rgba(147, 200, 34, 0.2)', // Anorha green tint for active
  },
  modePopupLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  modePopupLabelActive: {
    color: '#fff',
  },
  modePopupIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  modePopupIconContainerActive: {
    borderColor: '#fff',
    backgroundColor: '#93C822', // Anorha green for active icon
  },
  modePopupArrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 0,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderTopColor: '#000', // Match content background
    marginTop: -1,
    // Arrow should be centered on the button. 
    // Popup is centered on the button.
    // So arrow should be centered on the popup.
    // Since alignItems is center on modePopup, just remove margins.
  },
  continueButtonContainer: {
    paddingHorizontal: 20,
  },
  barcodeActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  barcodeSecondaryButton: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcodeSecondaryText: {
    color: '#E5E7EB',
    fontSize: 16,
    fontWeight: '600',
  },
  itemNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  itemNavArrow: {
    minWidth: 52,
    height: 48,
    flexDirection: "row",
    flexShrink: 0,
    paddingHorizontal: 10,
    gap: 4,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemNavArrowDisabled: {
    opacity: 0.4,
  },
  itemNavNewButton: {
    backgroundColor: 'rgb(127, 127, 127)',
  },
  continueButton: {
    flex: 1,
    backgroundColor: '#93C822',
    borderRadius: 22,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  itemCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 8,
  },
  itemCountBadgeText: {
    color: 'rgba(0,0,0,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
});
