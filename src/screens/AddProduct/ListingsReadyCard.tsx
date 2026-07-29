import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';

/**
 * Surfaced when listing creation finishes (and the seller is still in the app). Mirrors the
 * "Food finished processing" pattern: a celebratory prompt to go review + publish, with a
 * quiet Dismiss. The matching push/local notification handles the away-from-app case.
 */
export default function ListingsReadyCard({
  visible,
  count = 1,
  onReview,
  onDismiss,
}: {
  visible: boolean;
  count?: number;
  onReview: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  const plural = count > 1;

  // Three faux listing rows behind a magnifier — the "ready to review" illustration.
  const rowIcons = ['tshirt-crew-outline', 'package-variant-closed', 'tag-outline'];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) + 8 }]}>
          <View style={styles.grabber} />

          <View style={styles.art}>
            {/* confetti */}
            {CONFETTI.map((c, i) => (
              <View key={i} style={[styles.confetti, { backgroundColor: c.color, top: c.top, left: c.left, transform: [{ rotate: c.rot }] }]} />
            ))}
            {/* listing rows */}
            <View style={styles.rows}>
              {rowIcons.map((name, i) => (
                <View key={name} style={[styles.row, i === 2 && { marginBottom: 0 }]}>
                  <View style={styles.rowIcon}><Icon name={name} size={18} color="#5D7E16" /></View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={[styles.bar, { width: '70%' }]} />
                    <View style={[styles.bar, { width: '45%', backgroundColor: '#EEEFF1' }]} />
                  </View>
                  <View style={styles.rowPill} />
                </View>
              ))}
            </View>
            {/* magnifier */}
            <View style={styles.magnifier}>
              <Icon name="magnify" size={34} color={CHAT_COLORS.ink} />
            </View>
          </View>

          <Text style={styles.title}>{plural ? 'Your listings are ready to review!' : 'Your listing is ready to review!'}</Text>
          <Text style={styles.subtitle}>Review and adjust {plural ? 'them' : 'it'} before you publish.</Text>

          <TouchableOpacity style={styles.reviewBtn} onPress={onReview} activeOpacity={0.85}>
            <Text style={styles.reviewText}>{plural ? 'Review listings' : 'Review listing'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} activeOpacity={0.7}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const CONFETTI = [
  { color: '#93C822', top: 6, left: 40, rot: '20deg' },
  { color: '#C7E59B', top: 28, left: 300, rot: '-15deg' },
  { color: '#D4D4D8', top: 70, left: 18, rot: '40deg' },
  { color: '#93C822', top: 96, left: 320, rot: '10deg' },
  { color: '#E7E7E2', top: 4, left: 200, rot: '-30deg' },
  { color: '#C7E59B', top: 120, left: 70, rot: '25deg' },
];

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
  grabber: { width: 40, height: 5, borderRadius: 999, backgroundColor: CHAT_COLORS.border, marginBottom: 18 },
  art: { width: '100%', height: 168, marginBottom: 18, alignItems: 'center', justifyContent: 'center' },
  confetti: { position: 'absolute', width: 9, height: 14, borderRadius: 2 },
  rows: { width: 240, gap: 9 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EEF0F2',
    paddingVertical: 10,
    paddingHorizontal: 11,
    marginBottom: 9,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  rowIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: '#93C82218', alignItems: 'center', justifyContent: 'center' },
  bar: { height: 7, borderRadius: 999, backgroundColor: '#E3E4E7' },
  rowPill: { width: 26, height: 15, borderRadius: 999, backgroundColor: '#EDEEF1' },
  magnifier: {
    position: 'absolute',
    right: 36,
    bottom: 8,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: 1,
    borderColor: '#EEF0F2',
  },
  title: { fontSize: 22, fontFamily: CHAT_FONT.bold, fontWeight: '800', color: CHAT_COLORS.ink, textAlign: 'center', letterSpacing: -0.3 },
  subtitle: { fontSize: 14.5, fontFamily: CHAT_FONT.regular, fontWeight: '400', color: CHAT_COLORS.dim, textAlign: 'center', lineHeight: 21, marginTop: 10, paddingHorizontal: 8 },
  reviewBtn: {
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  reviewText: { fontSize: 16, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#FFFFFF' },
  dismissBtn: { paddingVertical: 14, marginTop: 4 },
  dismissText: { fontSize: 15, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: CHAT_COLORS.dim },
});
