// ConnectAccountsStep — the final, skippable onboarding step. The user hooks up
// their selling platforms here; each successful connect kicks off a background
// inventory pull + draft-mapping build (via usePlatformConnect) so listings are
// ready to review by the time they finish poking around the app.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';

import PlatformLogo from '../PlatformLogo';
import ConnectFlowSheet from '../ConnectFlowSheet';
import { listPlatforms } from '../../config/platforms';

import { type ConnectablePlatform } from '../../hooks/usePlatformConnect';
import { usePlatformConnections } from '../../context/PlatformConnectionsContext';
import { useFacebookJobStatus } from '../../hooks/useFacebookJobStatus';
import { derivePlatformConnectStatus } from '../../lib/platformConnectStatus';

const INK = '#1C1B17';
const SUBTLE = '#8A887E';
const DIM = '#71717A';
const GREEN = '#93C822';
const GREEN_DEEP = '#4A7C00';
const BORDER = '#EAE6DA';
const DIVIDER = '#F1F2F4';

type PlatformDef = {
  key: ConnectablePlatform;
  name: string;
};

const PLATFORMS: PlatformDef[] = listPlatforms({ connectableOnly: true }).map((d) => ({
  key: d.key as ConnectablePlatform,
  name: d.label,
}));

export default function ConnectAccountsStep({
  orgId,
  orgName,
  email,
  onDone,
}: {
  orgId?: string | null;
  orgName?: string;
  email?: string;
  onDone: () => void;
}) {
  const { liveConnections, refresh } = usePlatformConnections();
  const { computerOnline, presenceLoaded } = useFacebookJobStatus();

  // The platform whose combined connect flow (OAuth + link-computer) is open.
  const [flowPlatform, setFlowPlatform] = useState<ConnectablePlatform | null>(null);
  // Platforms the user finished connecting during THIS session (optimistic).
  const [justConnected, setJustConnected] = useState<Set<ConnectablePlatform>>(new Set());

  // Fully connected = every required step done (Facebook needs OAuth AND a linked
  // computer). justConnected covers the brief window before the row lands live.
  const isFullyConnected = useCallback(
    (key: ConnectablePlatform) =>
      justConnected.has(key) ||
      derivePlatformConnectStatus(key, liveConnections, { computerOnline, presenceLoaded }).isFullyConnected,
    [justConnected, liveConnections, computerOnline, presenceLoaded],
  );

  const connectedCount = useMemo(
    () => PLATFORMS.filter((p) => isFullyConnected(p.key)).length,
    [isFullyConnected],
  );
  const name = orgName?.trim() || 'My store';
  const initial = name.charAt(0).toUpperCase();

  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.wrap}>
      <Text style={styles.title}>Connect your stores</Text>
      <Text style={styles.subtitle}>We'll pull your products in.</Text>

      <View style={styles.card}>
        {/* Org summary */}
        <View style={styles.orgRow}>
          <View style={styles.orgAvatar}><Text style={styles.orgInitial}>{initial}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orgName} numberOfLines={1}>{name}</Text>
            {!!email && <Text style={styles.orgEmail} numberOfLines={1}>{email}</Text>}
          </View>
          {connectedCount > 0 && (
            <View style={styles.orgStat}>
              <Text style={styles.orgStatNum}>{connectedCount}</Text>
              <Text style={styles.orgStatLbl}>Connected</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>CONNECTED STORES</Text>

        {PLATFORMS.map((p, i) => {
          const connected = isFullyConnected(p.key);
          return (
            <View key={p.key} style={[styles.row, i > 0 && styles.rowBorder]}>
              <View style={styles.logoSquare}>
                <PlatformLogo type={p.key} size={22} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{p.name}</Text>
                {justConnected.has(p.key) ? (
                  <Text style={styles.rowStatus} numberOfLines={1}>Importing inventory…</Text>
                ) : null}
              </View>

              {connected ? (
                <View style={styles.connectedWrap}>
                  <View style={styles.checkCircle}><Check size={11} color="#FFFFFF" /></View>
                  <Text style={styles.connectedText}>Connected</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.connectPill}
                  onPress={() => setFlowPlatform(p.key)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.connectText}>Connect</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      <Text style={styles.hint}>
        We only read and sync what you connect. Disconnect anytime in Settings.
      </Text>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryBtn} onPress={onDone} activeOpacity={0.9}>
          <Text style={styles.primaryText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={onDone} activeOpacity={0.7}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </View>

      <ConnectFlowSheet
        visible={!!flowPlatform}
        platform={flowPlatform}
        orgId={orgId}
        onCancel={() => setFlowPlatform(null)}
        onConnected={() => {
          setJustConnected((prev) => (flowPlatform ? new Set(prev).add(flowPlatform) : prev));
          setFlowPlatform(null);
          refresh?.();
          setTimeout(() => refresh?.(), 2500);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24 },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: 'Inter_700Bold',
    color: INK,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Inter_500Medium',
    color: SUBTLE,
    marginTop: 6,
    marginBottom: 22,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  orgAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  orgInitial: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  orgName: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#18181B' },
  orgEmail: { fontSize: 13, fontFamily: 'Inter_500Medium', color: DIM, marginTop: 2 },
  orgStat: { alignItems: 'center', paddingLeft: 8 },
  orgStatNum: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#18181B' },
  orgStatLbl: { fontSize: 11, fontFamily: 'Inter_500Medium', color: DIM, marginTop: 1 },

  divider: { height: 1, backgroundColor: DIVIDER },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: DIM, letterSpacing: 0.6, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 2 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 60, paddingVertical: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#EFEBDF' },
  logoSquare: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F1EFE6', alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: INK },
  rowStatus: { fontSize: 12, fontFamily: 'Inter_500Medium', color: GREEN_DEEP, marginTop: 2 },
  rowError: { color: '#DC2626' },

  connectPill: {
    height: 32,
    borderRadius: 999,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectText: { color: GREEN_DEEP, fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  connectingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    borderRadius: 999,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(147,200,34,0.12)',
  },
  connectingText: { color: GREEN_DEEP, fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  connectedWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  checkCircle: { width: 18, height: 18, borderRadius: 9, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  connectedText: { color: '#4A7C01', fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  hint: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    marginTop: 14,
    marginHorizontal: 4,
  },

  footer: { marginTop: 'auto', paddingTop: 24, gap: 12, alignItems: 'center' },
  primaryBtn: {
    width: '100%',
    backgroundColor: GREEN,
    height: 54,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  skipBtn: { height: 24, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: SUBTLE, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
