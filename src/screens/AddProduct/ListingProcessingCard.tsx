import React, { useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';

const PHOTO = 188;

/**
 * Shown right after the seller taps "Sell these N items". The listings are created in the
 * background; this card sets the expectation ("we'll let you know") and lets them carry on.
 * Tapping Done dismisses the card — creation keeps running, and a notification + the
 * ListingsReadyCard surface when it finishes.
 */
export default function ListingProcessingCard({
  visible,
  imageUri,
  count = 1,
  onDone,
}: {
  visible: boolean;
  imageUri?: string | null;
  count?: number;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      sweep.value = 0;
      sweep.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value * (PHOTO - 3) }] }));

  if (!visible) return null;
  const plural = count > 1;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDone} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) + 8 }]}>
          <View style={styles.grabber} />

          <View style={styles.photoFrame}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoEmpty]}>
                <Icon name="image-outline" size={34} color="#C4C8CE" />
              </View>
            )}
            {/* faint scan grid */}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <View style={[styles.gridV, { left: '33%' }]} />
              <View style={[styles.gridV, { left: '66%' }]} />
              <View style={[styles.gridH, { top: '33%' }]} />
              <View style={[styles.gridH, { top: '66%' }]} />
            </View>
            {/* sweeping scan line */}
            <Animated.View pointerEvents="none" style={[styles.scanLine, sweepStyle]} />
          </View>

          <Text style={styles.title}>{plural ? 'Creating your listings' : 'Creating your listing'}</Text>
          <Text style={styles.subtitle}>
            {plural
              ? "We'll let you know the moment they're ready to review and publish."
              : "We'll let you know the moment it's ready to review and publish."}
          </Text>

          <TouchableOpacity style={styles.doneBtn} onPress={onDone} activeOpacity={0.85}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: CHAT_COLORS.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 10,
    alignItems: 'center',
  },
  grabber: { width: 40, height: 5, borderRadius: 999, backgroundColor: CHAT_COLORS.border, marginBottom: 22 },
  photoFrame: {
    width: PHOTO,
    height: PHOTO,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#ECECEF',
    marginBottom: 24,
  },
  photo: { width: '100%', height: '100%' },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.45)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.45)' },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 3,
    backgroundColor: CHAT_COLORS.brand,
    shadowColor: CHAT_COLORS.brand,
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  title: { fontSize: 22, fontFamily: CHAT_FONT.bold, fontWeight: '800', color: CHAT_COLORS.ink, textAlign: 'center', letterSpacing: -0.3 },
  subtitle: { fontSize: 14.5, fontFamily: CHAT_FONT.regular, fontWeight: '400', color: CHAT_COLORS.dim, textAlign: 'center', lineHeight: 21, marginTop: 10, paddingHorizontal: 8 },
  doneBtn: {
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.bubble,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 26,
  },
  doneText: { fontSize: 16, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: CHAT_COLORS.inkSoft },
});
