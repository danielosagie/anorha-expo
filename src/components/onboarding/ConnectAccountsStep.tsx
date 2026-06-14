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
  ActivityIndicator,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import PlatformLogo from '../PlatformLogo';

import { usePlatformConnect, ConnectablePlatform } from '../../hooks/usePlatformConnect';
import { usePlatformConnections } from '../../context/PlatformConnectionsContext';

const INK = '#18181B';
const SUBTLE = '#71717A';
const GREEN = '#93C822';
const GREEN_DEEP = '#43631A';
const HAIRLINE = '#ECEBE6';

type PlatformDef = {
  key: ConnectablePlatform;
  name: string;
  blurb: string;
};

const PLATFORMS: PlatformDef[] = [
  { key: 'shopify', name: 'Shopify', blurb: 'Products, inventory & orders' },
  { key: 'square', name: 'Square', blurb: 'Catalog & in-store inventory' },
  { key: 'clover', name: 'Clover', blurb: 'Items & stock levels' },
  { key: 'ebay', name: 'eBay', blurb: 'Listings & sold orders' },
  { key: 'facebook', name: 'Facebook', blurb: 'Marketplace & catalogs' },
];

export default function ConnectAccountsStep({
  orgId,
  onDone,
}: {
  orgId?: string | null;
  onDone: () => void;
}) {
  const { connect } = usePlatformConnect({ orgId });
  const { liveConnections, refresh } = usePlatformConnections();

  const [busy, setBusy] = useState<ConnectablePlatform | null>(null);
  // Platforms connected during this session (we kicked off a scan for these).
  const [justConnected, setJustConnected] = useState<Set<ConnectablePlatform>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<ConnectablePlatform, string>>>({});

  // Platforms already connected before onboarding (rare, but keep it truthful).
  const alreadyConnected = useMemo(() => {
    const set = new Set<string>();
    (liveConnections || []).forEach((c: any) => set.add(String(c.PlatformType || '').toLowerCase()));
    return set;
  }, [liveConnections]);

  const handleConnect = useCallback(
    async (key: ConnectablePlatform) => {
      if (busy) return;
      setErrors((e) => ({ ...e, [key]: undefined }));
      setBusy(key);
      try {
        const res = await connect(key);
        if (res.success) {
          setJustConnected((prev) => new Set(prev).add(key));
          refresh?.();
        } else if (!res.cancelled && res.errorMessage) {
          setErrors((e) => ({ ...e, [key]: res.errorMessage }));
        }
      } finally {
        setBusy(null);
      }
    },
    [busy, connect, refresh],
  );

  const connectedCount = justConnected.size;

  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.wrap}>
      <View style={styles.iconBadge}>
        <Icon name="lightning-bolt" size={26} color={GREEN_DEEP} />
      </View>
      <Text style={styles.title}>Connect your{'\n'}accounts</Text>
      <Text style={styles.subtitle}>
        Hook up your stores now and we'll pull your inventory in and prep your draft listings while you
        explore — no waiting around later.
      </Text>

      <View style={styles.card}>
        {PLATFORMS.map((p, i) => {
          const isConnected = justConnected.has(p.key) || alreadyConnected.has(p.key);
          const isBusy = busy === p.key;
          const err = errors[p.key];
          return (
            <View key={p.key} style={[styles.row, i > 0 && styles.rowBorder]}>
              <View style={styles.logoWrap}>
                <PlatformLogo type={p.key} size={24} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{p.name}</Text>
                <Text style={[styles.rowBlurb, !!err && styles.rowError]} numberOfLines={1}>
                  {err
                    ? err
                    : justConnected.has(p.key)
                      ? 'Connected · importing inventory…'
                      : isConnected
                        ? 'Connected'
                        : p.blurb}
                </Text>
              </View>

              {isConnected ? (
                <View style={styles.connectedPill}>
                  <Check size={15} color={GREEN_DEEP} />
                  <Text style={styles.connectedText}>Done</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.connectPill, isBusy && styles.connectPillBusy]}
                  onPress={() => handleConnect(p.key)}
                  disabled={!!busy}
                  activeOpacity={0.85}
                >
                  {isBusy ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.connectText}>Connect</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      <Text style={styles.hint}>
        We only read and sync the catalog, inventory and orders you connect. Disconnect anytime in
        Settings.
      </Text>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryBtn} onPress={onDone} activeOpacity={0.9}>
          <Text style={styles.primaryText}>
            {connectedCount > 0 ? 'Continue to app' : 'Continue'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostBtn} onPress={onDone} activeOpacity={0.7}>
          <Text style={styles.ghostText}>
            {connectedCount > 0 ? 'Done — finish setup' : "I'll connect later"}
          </Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24 },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(147,200,34,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 18,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontFamily: 'Inter_700Bold',
    color: INK,
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Inter_400Regular',
    color: SUBTLE,
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  logoWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: '#F6F7F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: INK },
  rowBlurb: { fontSize: 13, fontFamily: 'Inter_400Regular', color: SUBTLE, marginTop: 2 },
  rowError: { color: '#DC2626' },

  connectPill: {
    backgroundColor: INK,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectPillBusy: { opacity: 0.85 },
  connectText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  connectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(147,200,34,0.16)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  connectedText: { color: GREEN_DEEP, fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  hint: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    marginTop: 14,
    marginHorizontal: 4,
  },

  footer: { marginTop: 'auto', paddingTop: 24, gap: 10 },
  primaryBtn: {
    backgroundColor: GREEN,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  ghostBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: SUBTLE, fontSize: 15, fontFamily: 'Inter_500Medium' },
});
