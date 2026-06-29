/**
 * LinkComputerScanSheet — scan the QR shown on your computer to link it.
 *
 * The desktop tray shows a QR holding a short-lived pairing code. We scan it,
 * extract the code, and POST it to the backend (Supabase-authed) which links
 * that computer to THIS account. COPY = outcome, not plumbing (no-internal-leak):
 * we say "your computer", never the tray/queue/runtime.
 */
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BaseModal from './BaseModal';
import { ensureSupabaseJwt } from '../lib/supabase';
import { BRAND_PRIMARY } from '../design/tokens';

const API_BASE = (
  process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://api.sssync.app'
).replace(/\/$/, '');

/** The QR holds https://app.anorha.app/link?code=XXXX (or a bare code). */
function extractCode(scanned: string): string {
  const m = scanned.match(/[?&]code=([^&\s]+)/);
  return (m ? decodeURIComponent(m[1]) : scanned).trim();
}

type Phase = 'scan' | 'linking' | 'done' | 'error';

export default function LinkComputerScanSheet({
  visible,
  onClose,
  onLinked,
}: {
  visible: boolean;
  onClose: () => void;
  onLinked?: (name?: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('scan');
  const [msg, setMsg] = useState('');
  const handled = useRef(false);

  const onScan = useCallback(
    async (result: { data?: string; rawValue?: string }) => {
      if (handled.current) return;
      const code = extractCode(result?.data || result?.rawValue || '');
      if (!code) return;
      handled.current = true;
      setPhase('linking');
      try {
        const token = await ensureSupabaseJwt();
        const res = await fetch(`${API_BASE}/api/devices/claim-pairing`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairingCode: code }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.message || "Couldn't link this computer.");
        setMsg(json?.name ? `Linked ${json.name}` : 'Computer linked');
        setPhase('done');
        onLinked?.(json?.name);
      } catch (e: any) {
        setMsg(e?.message || 'Something went wrong.');
        setPhase('error');
      }
    },
    [onLinked],
  );

  const reset = () => { handled.current = false; setMsg(''); setPhase('scan'); };
  const close = () => { reset(); onClose(); };

  return (
    <BaseModal visible={visible} onClose={close} position="bottom" showCloseButton={false}>
      <View style={styles.wrap}>
        <Text style={styles.title}>Link a computer</Text>

        {phase === 'scan' && (
          !permission?.granted ? (
            <View style={styles.center}>
              <Icon name="qrcode-scan" size={36} color={BRAND_PRIMARY} />
              <Text style={styles.body}>Allow the camera to scan the code on your computer.</Text>
              <TouchableOpacity style={styles.cta} onPress={requestPermission} activeOpacity={0.85}>
                <Text style={styles.ctaTx}>Allow camera</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.cameraBox}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                onBarcodeScanned={onScan}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              />
              <Text style={styles.hint}>Point at the code on your computer</Text>
            </View>
          )
        )}

        {phase === 'linking' && (
          <View style={styles.center}>
            <ActivityIndicator color={BRAND_PRIMARY} />
            <Text style={styles.body}>Linking…</Text>
          </View>
        )}

        {phase === 'done' && (
          <View style={styles.center}>
            <Icon name="check-circle" size={40} color={BRAND_PRIMARY} />
            <Text style={styles.body}>{msg}</Text>
            <TouchableOpacity style={styles.cta} onPress={close} activeOpacity={0.85}>
              <Text style={styles.ctaTx}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.center}>
            <Icon name="alert-circle-outline" size={36} color="#BA7517" />
            <Text style={styles.body}>{msg}</Text>
            <TouchableOpacity style={styles.cta} onPress={reset} activeOpacity={0.85}>
              <Text style={styles.ctaTx}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 4, gap: 14 },
  title: { fontSize: 20, fontWeight: '800', color: '#18181B', letterSpacing: -0.2 },
  center: { alignItems: 'center', gap: 12, paddingVertical: 16 },
  body: { fontSize: 15, color: '#52525B', textAlign: 'center', lineHeight: 21, maxWidth: 280 },
  cameraBox: { width: '100%', aspectRatio: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', justifyContent: 'flex-end' },
  hint: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 12, backgroundColor: 'rgba(0,0,0,0.4)' },
  cta: { backgroundColor: BRAND_PRIMARY, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, marginTop: 4 },
  ctaTx: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
