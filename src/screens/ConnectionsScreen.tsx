// Connections — everything the org plugs into, in one place:
// selling platforms (live status), POOLS (the location groups inventory syncs and
// partners share through — managed here now, not buried in the legacy profile),
// and apps (Slack/Gmail via Composio, shown as planned until configured).

import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Plus, Slack, Mail, Layers, Handshake, RefreshCw, Trash2, Monitor } from 'lucide-react-native';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import LinkComputerSheet from '../components/LinkComputerSheet';
import LinkComputerScanSheet from '../components/LinkComputerScanSheet';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';
import { useOrg } from '../context/OrgContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { BRAND_PRIMARY } from '../design/tokens';
import PlatformAvatar from '../components/PlatformAvatar';
import PlatformConnectSheet from '../components/PlatformConnectSheet';
import CreatePoolSheet from '../components/pools/CreatePoolSheet';
import { PageHeader } from '../components/ui/PageHeader';
import { getPlatform, normalizeDisplayName } from '../config/platforms';
import { usePlatformConnect, ConnectablePlatform } from '../hooks/usePlatformConnect';
import { pickCsvImportPayload } from '../utils/pickCsvImport';

const statusOf = (raw?: string): { label: string; color: string } => {
  const s = (raw || '').toLowerCase();
  if (s.includes('active') || s.includes('connect') || s === 'ok' || s === 'live') return { label: 'Connected', color: '#43631A' };
  if (s.includes('error') || s.includes('expired') || s.includes('revoked') || s.includes('fail')) return { label: 'Needs reconnect', color: '#DC2626' };
  if (s.includes('sync')) return { label: 'Syncing…', color: '#A2611A' };
  return { label: raw || 'Connected', color: '#71717A' };
};

/** "myshop.myshopify.com" → "myshop"; resolves known platforms to their label. */
const shopLabel = (c: any): string =>
  normalizeDisplayName(String(c.DisplayName || c.PlatformType || 'Platform'));

/** "just now" / "5m ago" / "2h ago" / "3d ago" for a last-heartbeat timestamp. */
const lastSeenLabel = (ms: number): string => {
  if (!ms) return 'never seen';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

type Pool = { id: string; name: string; description?: string; isPartnerPool?: boolean };

const APPS = [
  { key: 'slack', label: 'Slack', sub: 'Post updates, read channels', icon: (c: string) => <Slack size={22} color={c} />, tint: '#4A154B' },
  { key: 'gmail', label: 'Gmail', sub: 'Send and read email', icon: (c: string) => <Mail size={22} color={c} />, tint: '#C5221F' },
];

const ConnectionsScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { liveConnections, loading, refresh } = usePlatformConnections();
  const overlay = usePlatformPickerOverlay();
  const { currentOrg } = useOrg();

  const [pools, setPools] = useState<Pool[]>([]);
  const [managing, setManaging] = useState(false);

  // Connected computers (the desktop[s] that post to Facebook) + the link/manage sheet.
  const { computers, refresh: refreshComputers } = useFacebookJobStatus();
  const [linkComputerOpen, setLinkComputerOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  // Wire the global platform-picker overlay so choosing a platform from the
  // "Connect a platform" sheet shows the consent page, then opens the OAuth
  // webview.
  const { connect } = usePlatformConnect({ orgId: currentOrg?.id });
  const [consentPlatform, setConsentPlatform] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleStartConnect = useCallback(
    async (platform: string) => {
      overlay.hide();
      if (platform === 'csv') {
        const payload = await pickCsvImportPayload();
        if (payload) {
          navigation.navigate('CSVColumnMapping' as never, payload as never);
        }
        return;
      }
      const def = getPlatform(platform);
      if (!def?.connect) {
        navigation.navigate('ConnectPlatforms' as never);
        return;
      }
      // Show the per-platform consent page; the webview opens on "Continue".
      setConnectError(null);
      setConsentPlatform(def.key);
    },
    [navigation, overlay],
  );

  // "Continue to <Platform>" on the consent page → run the OAuth webview.
  const handleContinueConnect = useCallback(async () => {
    if (!consentPlatform) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await connect(consentPlatform as ConnectablePlatform);
      if (res.success) {
        setConsentPlatform(null);
        refresh?.();
      } else if (!res.cancelled && res.errorMessage) {
        setConnectError(res.errorMessage);
      }
      // res.cancelled → user backed out of the browser; keep the sheet open.
    } finally {
      setConnecting(false);
    }
  }, [consentPlatform, connect, refresh]);

  // Hold the latest handler in a ref so the focus effect below can stay stable.
  const startConnectRef = useRef(handleStartConnect);
  startConnectRef.current = handleStartConnect;
  useFocusEffect(
    useCallback(() => {
      overlay.enableForScreen((p: string) => startConnectRef.current(p));
      return () => overlay.disableForScreen();
    }, [overlay.enableForScreen, overlay.disableForScreen]),
  );

  const disconnectPlatform = (c: any) => {
    Alert.alert('Remove connection', `Disconnect "${shopLabel(c)}"? Your products stay in Anorha.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          try {
            const token = await ensureSupabaseJwt();
            const r = await fetch(`${API_BASE_URL}/api/platform-connections/${c.Id}/disconnect`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ cleanupStrategy: 'keep' }),
            });
            if (!r.ok) throw new Error(await r.text());
            refresh?.();
          } catch {
            Alert.alert('Error', 'Failed to disconnect. Please try again.');
          }
        },
      },
    ]);
  };
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [createPoolOpen, setCreatePoolOpen] = useState(false);

  const loadPools = useCallback(async () => {
    if (!currentOrg?.id) return;
    setPoolsLoading(true);
    try {
      const token = await ensureSupabaseJwt();
      const res = await fetch(`${API_BASE_URL}/api/pools/org/${currentOrg.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      let list: any[] = Array.isArray(data) ? data : [];
      // Non-admins with EXPLICIT pool assignments only see those. An empty list
      // means unrestricted — filtering on it would hide even pools they create.
      if (
        currentOrg.role !== 'org:admin' &&
        Array.isArray(currentOrg.assignedPoolIds) &&
        currentOrg.assignedPoolIds.length > 0
      ) {
        const allowed = new Set(currentOrg.assignedPoolIds);
        list = list.filter((p) => allowed.has(p.id));
      }
      setPools(list.map((p) => ({ id: p.id, name: p.name, description: p.description, isPartnerPool: p.isPartnerPool })));
    } catch {
      // keep whatever we had — pools are a convenience view here
    } finally {
      setPoolsLoading(false);
    }
  }, [currentOrg?.id, currentOrg?.role, currentOrg?.assignedPoolIds]);

  // Reload on every focus — pool edits/deletes happen on the detail screen and
  // this list stays mounted underneath it.
  useFocusEffect(
    useCallback(() => {
      refresh?.();
      void loadPools();
    }, [refresh, loadPools]),
  );

  // Pull-to-refresh: re-pull everything the page shows — selling platforms, the
  // pools list, and the browserJobs bootstrap (so a degraded/blank Computers
  // section recovers without relaunching the app).
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([
      Promise.resolve(refresh?.()),
      loadPools(),
      refreshComputers?.(),
    ]).finally(() => setRefreshing(false));
  }, [refresh, loadPools, refreshComputers]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND_PRIMARY} colors={[BRAND_PRIMARY]} />}
      >
        <PageHeader title="Connections" onBack={() => navigation.goBack()} />

        {/* Selling platforms — Manage flips rows into refresh/remove */}
        <View style={[styles.sectionHeaderRow, { marginTop: 0 }]}>
          <Text style={[styles.section, { marginBottom: 0 }]}>Selling platforms</Text>
          {(liveConnections?.length || 0) > 0 && (
            <TouchableOpacity
              style={[styles.managePill, managing && styles.managePillOn]}
              activeOpacity={0.8}
              onPress={() => setManaging((v) => !v)}
            >
              <Text style={[styles.managePillText, managing && { color: '#FFFFFF' }]}>
                {managing ? 'Done' : 'Manage'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.card}>
          {loading && (liveConnections?.length || 0) === 0 ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
          ) : (liveConnections?.length || 0) === 0 ? (
            <Text style={styles.empty}>No platforms connected yet.</Text>
          ) : (
            liveConnections.map((c: any, i: number) => {
              const st = statusOf(c.Status);
              return (
                <TouchableOpacity
                  key={c.Id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  activeOpacity={0.7}
                  onPress={() =>
                    navigation.navigate('SyncInbox', { connectionId: c.Id, platformName: c.PlatformType })
                  }
                >
                  <PlatformAvatar platformType={(c.PlatformType || '').toLowerCase()} size="medium" />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{shopLabel(c)}</Text>
                    <View style={styles.statusRow}>
                      <View style={[styles.dot, { backgroundColor: st.color }]} />
                      <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                  {managing ? (
                    <View style={styles.manageActions}>
                      <TouchableOpacity
                        style={styles.manageBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                        onPress={(e: any) => { e.stopPropagation?.(); refresh?.(); }}
                      >
                        <RefreshCw size={16} color="#52525B" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.manageBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                        onPress={(e: any) => { e.stopPropagation?.(); disconnectPlatform(c); }}
                      >
                        <Trash2 size={16} color="#DC2626" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <ChevronRight size={20} color="#D4D4D8" />
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <TouchableOpacity style={styles.connectBtn} onPress={() => overlay.show()} activeOpacity={0.85}>
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.connectText}>Connect a platform</Text>
        </TouchableOpacity>

        {/* Computers — the linked desktop(s) that post to Facebook for you. Tap a
            row (or "Link a computer") to check status / set one up. */}
        <Text style={[styles.section, { marginTop: 26 }]}>Computers</Text>
        <View style={styles.card}>
          {computers.length === 0 ? (
            <Text style={styles.empty}>No computers linked yet.</Text>
          ) : (
            computers.map((comp, i) => {
              const color = comp.online ? '#43631A' : '#BA7517';
              return (
                <TouchableOpacity
                  key={comp.id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  activeOpacity={0.7}
                  onPress={() => setLinkComputerOpen(true)}
                >
                  <View style={styles.poolIcon}>
                    <Monitor size={20} color="#43631A" />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {computers.length <= 1 ? 'Your computer' : `Computer ${i + 1}`}
                    </Text>
                    <View style={styles.statusRow}>
                      <View style={[styles.dot, { backgroundColor: color }]} />
                      <Text style={[styles.statusText, { color }]} numberOfLines={1}>
                        {comp.online ? 'Online' : `Offline · ${lastSeenLabel(comp.lastSeenAt)}`}
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color="#D4D4D8" />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <TouchableOpacity style={styles.connectBtn} onPress={() => setScanOpen(true)} activeOpacity={0.85}>
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.connectText}>Link a computer</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setLinkComputerOpen(true)} activeOpacity={0.7} style={{ alignSelf: 'center', paddingVertical: 8 }}>
          <Text style={{ color: '#71717A', fontSize: 13, fontWeight: '500' }}>Don't have it on your computer yet?</Text>
        </TouchableOpacity>

        {/* Pools — the location groups that platforms sync and partners share through */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.section, { marginBottom: 0 }]}>Pools</Text>
        </View>
        <View style={styles.card}>
          {poolsLoading && pools.length === 0 ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
          ) : pools.length === 0 ? (
            <Text style={styles.empty}>Group locations for shared stock.</Text>
          ) : (
            pools.map((p, i) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('PoolDetail', { poolId: p.id, name: p.name, isPartnerPool: p.isPartnerPool })}
              >
                <View style={[styles.poolIcon, p.isPartnerPool && styles.poolIconPartner]}>
                  {p.isPartnerPool
                    ? <Handshake size={20} color="#A2611A" />
                    : <Layers size={20} color="#43631A" />}
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {p.isPartnerPool ? 'Shared with a partner' : p.description || 'Location group'}
                  </Text>
                </View>
                <ChevronRight size={20} color="#D4D4D8" />
              </TouchableOpacity>
            ))
          )}
        </View>
        <TouchableOpacity
          style={styles.connectBtn}
          activeOpacity={0.8}
          onPress={() => setCreatePoolOpen(true)}
          disabled={!currentOrg?.id}
        >
          <Plus size={16} color="#FFFFFF" />
          <Text style={styles.connectText}>New pool</Text>
        </TouchableOpacity>

        {/* Apps (Slack, Gmail, …) */}
        <Text style={[styles.section, { marginTop: 26 }]}>Apps</Text>
        <View style={styles.card}>
          {APPS.map((a, i) => (
            <View key={a.key} style={[styles.row, i > 0 && styles.rowBorder]}>
              <View style={[styles.appIcon, { backgroundColor: `${a.tint}15` }]}>{a.icon(a.tint)}</View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>{a.label}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{a.sub}</Text>
              </View>
              <View style={styles.plannedPill}>
                <Text style={styles.plannedPillText}>Planned</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <CreatePoolSheet
        visible={createPoolOpen}
        orgId={currentOrg?.id || ''}
        onClose={() => setCreatePoolOpen(false)}
        onCreated={() => {
          setCreatePoolOpen(false);
          void loadPools();
        }}
      />

      <PlatformConnectSheet
        visible={!!consentPlatform}
        platform={consentPlatform}
        busy={connecting}
        error={connectError}
        onContinue={handleContinueConnect}
        onCancel={() => {
          if (connecting) return;
          setConsentPlatform(null);
          setConnectError(null);
        }}
      />

      <LinkComputerSheet
        visible={linkComputerOpen}
        orgId={currentOrg?.id}
        onClose={() => setLinkComputerOpen(false)}
      />

      <LinkComputerScanSheet
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7F4' },

  section: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 10 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, borderWidth: 1, borderColor: '#ECEBE6' },
  loadingRow: { paddingVertical: 26, alignItems: 'center' },
  empty: { paddingVertical: 22, textAlign: 'center', color: '#9CA3AF', fontFamily: 'Inter_500Medium', fontSize: 13, paddingHorizontal: 8, lineHeight: 19 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  rowSub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular', marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  poolIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(147,200,34,0.14)' },
  poolIconPartner: { backgroundColor: 'rgba(162,97,26,0.12)' },

  appIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  managePill: {
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECEBE6',
  },
  managePillOn: { backgroundColor: '#18181B', borderColor: '#18181B' },
  managePillText: { fontSize: 13, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  manageActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  manageBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F1EE',
    alignItems: 'center', justifyContent: 'center',
  },
  plannedPill: { backgroundColor: '#F4F4F5', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  plannedPillText: { color: '#71717A', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#93C822', borderRadius: 16, paddingVertical: 15, marginTop: 14 },
  connectText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
  appsHint: { color: '#9CA3AF', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 10, marginLeft: 4, lineHeight: 17 },
});

export default ConnectionsScreen;
