// PlatformConnectSheet — the per-platform OAuth consent page shown after a
// platform is chosen from the picker and BEFORE the connect webview opens
// (mirrors the "Connect <X> account → Continue to <X>" pattern other apps use).
//
// It reuses the shared DISCLOSURES copy (title/subtitle/bullets) so the wording
// stays in one place, renders the platform↔Anorha icon pair, and on "Continue"
// hands off to the caller (which runs usePlatformConnect().connect()).

import React from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshCw, ShieldCheck, Unlink } from 'lucide-react-native';
import PlatformLogo from './PlatformLogo';
import { getPlatform } from '../config/platforms';
import { DISCLOSURES } from './ConnectDisclosureModal';

// One icon per disclosure bullet (sync / permissions / disconnect), in order.
const BULLET_ICONS = [RefreshCw, ShieldCheck, Unlink];
const ANORHA_MARK = require('../assets/rounded_anorha.png');

interface Props {
  visible: boolean;
  /** Canonical platform spelling, or null when nothing is selected. */
  platform: string | null;
  busy?: boolean;
  error?: string | null;
  onContinue: () => void;
  onCancel: () => void;
}

export default function PlatformConnectSheet({
  visible,
  platform,
  busy = false,
  error,
  onContinue,
  onCancel,
}: Props) {
  const insets = useSafeAreaInsets();
  const def = platform ? getPlatform(platform) : undefined;
  const d = platform ? DISCLOSURES[platform] : undefined;

  // Nothing to show until a platform with known copy is selected.
  if (!platform || !def || !d) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} />
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.grabber} />

          {/* Platform ··· Anorha icon pair */}
          <View style={styles.iconRow}>
            <View style={styles.iconTile}>
              <PlatformLogo type={platform} size={34} />
            </View>
            <View style={styles.dots}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.dot} />
              ))}
            </View>
            <View style={styles.iconTile}>
              <Image source={ANORHA_MARK} style={styles.anorhaImg} resizeMode="contain" />
            </View>
          </View>

          <Text style={styles.title}>{d.title}</Text>
          <Text style={styles.subtitle}>{d.subtitle}</Text>

          <View style={styles.bulletCard}>
            {d.bullets.map((b, i) => {
              const Ico = BULLET_ICONS[i] ?? RefreshCw;
              return (
                <View key={b} style={[styles.bulletRow, i > 0 && styles.bulletBorder]}>
                  <View style={styles.bulletIcon}>
                    <Ico size={18} color="#52525B" />
                  </View>
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              );
            })}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.continueBtn, busy && styles.disabled]}
            disabled={busy}
            onPress={onContinue}
            accessibilityRole="button"
            accessibilityLabel={`Continue to ${def.label}`}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.continueLabel}>Continue to {def.label}</Text>
            )}
          </Pressable>

          <Pressable onPress={onCancel} disabled={busy} style={styles.cancelBtn} hitSlop={8}>
            <Text style={styles.cancel}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#E4E4E7', marginBottom: 22 },

  iconRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 22 },
  iconTile: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  anorhaImg: { width: 48, height: 48, borderRadius: 12 },
  dots: { flexDirection: 'row', gap: 5, paddingHorizontal: 12 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#D4D4D8' },

  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 22,
    paddingHorizontal: 6,
  },

  bulletCard: {
    width: '100%',
    backgroundColor: '#F6F7F4',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    paddingHorizontal: 16,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15 },
  bulletBorder: { borderTopWidth: 1, borderTopColor: '#ECEBE6' },
  bulletIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: '#3F3F46', lineHeight: 20 },

  error: { color: '#DC2626', fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 14, textAlign: 'center' },

  continueBtn: {
    width: '100%',
    backgroundColor: '#93C822',
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 22,
  },
  continueLabel: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 16 },
  disabled: { opacity: 0.6 },

  cancelBtn: { paddingVertical: 14, marginTop: 2 },
  cancel: { color: '#71717A', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
