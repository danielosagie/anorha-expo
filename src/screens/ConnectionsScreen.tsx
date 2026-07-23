// Connections — everything the org plugs into, in one place:
// selling platforms (live status), POOLS (the location groups inventory syncs and
// partners share through — managed here now, not buried in the legacy profile),
// and apps (Slack/Gmail via Composio, placeholders until it's configured).

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, InteractionManager, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import PlatformAvatar from '../components/PlatformAvatar';
import PlatformConnectSheet from '../components/PlatformConnectSheet';
import CreatePoolSheet from '../components/pools/CreatePoolSheet';
import { PageHeader } from '../components/ui/PageHeader';
import { getPlatform, normalizeDisplayName } from '../config/platforms';
import { usePlatformConnect, ConnectablePlatform } from '../hooks/usePlatformConnect';
import { useImportHub } from '../hooks/useImportHub';
import { pickAndParseCsv } from '../utils/csvImport';
import ErrorModal from '../components/ErrorModal';
import { isVisiblePlatformConnection } from '../lib/platformConnectStatus';
import PartnerBadge from '../components/PartnerBadge';
import { buildPartnerInventoryOrigins, PartnerInventoryOrigin } from '../lib/partnerInventory';

const statusOf = (raw?: string, enabled = true): { label: string; color: string } => {
  const s = (raw || '').toLowerCase();
  if (!enabled || s === 'inactive') return { label: 'Disconnected', color: '#71717A' };
  if (s === 'active' || s === 'live') return { label: 'Synced', color: '#43631A' };
  if (s === 'review' || s === 'needs-attention') return { label: 'Needs review', color: '#BA7517' };
  if (s === 'error' || s.includes('expired') || s.includes('revoked') || s.includes('fail')) return { label: 'Import failed', color: '#DC2626' };
  if (s === 'pending' || s === 'scanning') return { label: 'Scanning products…', color: '#A2611A' };
  if (s === 'syncing' || s === 'reconciling' || s === 'ready_to_sync') return { label: 'Importing inventory…', color: '#A2611A' };
  return { label: 'Checking status', color: '#71717A' };
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
  const {
    connections,
    liveConnections,
    loading,
    error: connectionsError,
    refresh,
    updateConnectionLocally,
  } = usePlatformConnections();
  const overlay = usePlatformPickerOverlay();
  const { currentOrg } = useOrg();

  // Soft-disconnected rows (IsEnabled=false) stay in the API payload, but a
  // platform the user disconnected must leave this list. Reconnecting goes
  // through the real OAuth flow on ConnectPlatforms, not PATCH /enable.
  const visibleConnections = useMemo(
    () => (liveConnections || []).filter(isVisiblePlatformConnection),
    [liveConnections]
  );

  // Import attention remains on each connection row; there is no aggregate card.
  const hub = useImportHub();
  const attentionByConn = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of hub.lanes.matches.byConnection) m[b.connectionId] = b.count;
    return m;
  }, [hub.lanes.matches.byConnection]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [partners, setPartners] = useState<PartnerInventoryOrigin[]>([]);
  const [managing, setManaging] = useState(false);
  // CSV pick/parse failures surface in an ErrorModal (native Alert stays for the
  // pre-existing platform flows).
  const [importError, setImportError] = useState<{ title: string; message: string } | null>(null);

  // Pick + parse a CSV, then hand off to the column-mapping screen via the shared
  // util's documented contract. Replaces the old "CSV lives under Profile" alert.
  const runCsvImport = useCallback(async () => {
    try {
      const picked = await pickAndParseCsv();
      if (!picked) return; // user cancelled the picker
      navigation.navigate('CSVColumnMapping', {
        csvHeaders: picked.headers,
        csvData: picked.data,
        sampleRow: picked.sampleRow,
      });
    } catch (e: any) {
      setImportError({ title: 'Import failed', message: e?.message || 'Could not read that CSV file.' });
    }
  }, [navigation]);

  // Connected computers (the desktop[s] that post to Facebook) + the link/manage sheet.
  const { computers } = useFacebookJobStatus();
  const [linkComputerOpen, setLinkComputerOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  // Wire the global platform-picker overlay so choosing a platform from the
  // "Connect a platform" sheet shows the consent page, then opens the OAuth
  // webview. Without this, the sheet opened but `overlay.onStartConnect` was
  // undefined here (only ProfileScreen registered one), so taps did nothing.
  const { connect } = usePlatformConnect({ orgId: currentOrg?.id });
  const [consentPlatform, setConsentPlatform] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleStartConnect = useCallback(
    (platform: string) => {
      overlay.hide();
      if (platform === 'csv') {
        // Run the CSV picker after the overlay dismisses (iOS won't present two
        // modals at once), then hand off to CSVColumnMapping.
        InteractionManager.runAfterInteractions(() => { void runCsvImport(); });
        return;
      }
      const def = getPlatform(platform);
      if (!def?.connect) {
        Alert.alert(def?.label ?? 'Platform', `${def?.label ?? 'This platform'} can’t be connected in-app yet.`);
        return;
      }
      // Show the per-platform consent page; the webview opens on "Continue".
      setConnectError(null);
      setConsentPlatform(def.key);
    },
    [overlay, runCsvImport],
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
          const previous = connections.find(connection => connection.Id === c.Id);
          updateConnectionLocally(c.Id, { IsEnabled: false, Status: 'inactive' });
          try {
            const token = await ensureSupabaseJwt();
            const r = await fetch(`${API_BASE_URL}/api/platform-connections/${c.Id}/disconnect`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ cleanupStrategy: 'keep' }),
            });
            if (!r.ok) throw new Error(await r.text());
            await refresh?.();
          } catch {
            if (previous) updateConnectionLocally(c.Id, previous);
            else await refresh?.();
            Alert.alert('Error', 'Failed to disconnect. Please try again.');
          }
        },
      },
    ]);
  };

  const retryImport = useCallback(async (connection: any) => {
    try {
      const token = await ensureSupabaseJwt();
      const reenable = connection.IsEnabled === false || String(connection.Status).toLowerCase() === 'inactive';
      const endpoint = reenable
        ? `${API_BASE_URL}/api/platform-connections/${connection.Id}/enable`
        : `${API_BASE_URL}/api/sync/connections/${connection.Id}/start-scan`;
      const response = await fetch(endpoint, {
        method: reenable ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed (${response.status})`);
      }
      await refresh?.();
    } catch (error: any) {
      Alert.alert('Couldn’t start import', error?.message || 'Please try again.');
    }
  }, [refresh]);

  const [poolsLoading, setPoolsLoading] = useState(false);
  const [createPoolOpen, setCreatePoolOpen] = useState(false);

  const loadPools = useCallback(async () => {
    if (!currentOrg?.id) return;
    setPoolsLoading(true);
    try {
      const token = await ensureSupabaseJwt();
      const headers = { Authorization: `Bearer ${token}` };
      const [poolsResponse, partnershipsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/pools/org/${currentOrg.id}`, { headers }),
        fetch(`${API_BASE_URL}/api/cross-org/partnerships?orgId=${currentOrg.id}`, { headers }),
      ]);
      const data = poolsResponse.ok ? await poolsResponse.json() : [];
      const partnershipData = partnershipsResponse.ok ? await partnershipsResponse.json() : {};
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
      setPartners(buildPartnerInventoryOrigins(
        partnershipData?.partnerships || [],
        list,
        currentOrg.id,
      ));
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

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Connections" onBack={() => navigation.goBack()} />

        {/* Selling platforms — Manage flips rows into refresh/remove */}
        <View style={[styles.sectionHeaderRow, { marginTop: 0 }]}>
          <Text style={[styles.section, { marginBottom: 0 }]}>Selling platforms</Text>
          {visibleConnections.length > 0 && (
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
          {loading && visibleConnections.length === 0 ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
          ) : connectionsError && visibleConnections.length === 0 ? (
            <TouchableOpacity style={styles.loadingRow} onPress={() => refresh?.()}>
              <Text style={styles.empty}>Couldn’t load your connections. Tap to retry.</Text>
            </TouchableOpacity>
          ) : visibleConnections.length === 0 ? (
            <Text style={styles.empty}>No platforms connected yet.</Text>
          ) : (
            visibleConnections.map((c: any, i: number) => {
              const st = statusOf(c.Status, c.IsEnabled !== false);
              const attn = attentionByConn[c.Id] || 0;
              return (
                <TouchableOpacity
                  key={c.Id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (c.IsEnabled === false || String(c.Status).toLowerCase() === 'inactive') {
                      void retryImport(c);
                      return;
                    }
                    if (attn > 0) {
                      navigation.navigate('SyncInbox', { connectionId: c.Id, platformName: c.PlatformType });
                      return;
                    }
                    navigation.navigate('SyncRules', { connectionId: c.Id, platformName: c.PlatformType });
                  }}
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
                        onPress={(e: any) => { e.stopPropagation?.(); void retryImport(c); }}
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
                    <View style={styles.rowRight}>
                      {attn > 0 && (
                        // Passive attention pill — the ONE explicit deep-link into
                        // the review deck for this connection.
                        <TouchableOpacity
                          style={styles.attnPill}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                          onPress={(e: any) => {
                            e.stopPropagation?.();
                            navigation.navigate('SyncInbox', { connectionId: c.Id, platformName: c.PlatformType });
                          }}
                        >
                          <Text style={styles.attnPillText}>{attn} need you</Text>
                        </TouchableOpacity>
                      )}
                      <ChevronRight size={20} color="#D4D4D8" />
                    </View>
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

        {partners.length > 0 ? (
          <>
            <Text style={[styles.section, { marginTop: 26 }]}>Partners</Text>
            <View style={styles.card}>
              {partners.map((partner, index) => (
                <TouchableOpacity
                  key={partner.id}
                  style={[styles.row, index > 0 && styles.rowBorder]}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('PartnershipDetail', { partnership: partner.partnership })}
                >
                  <PartnerBadge
                    name={partner.name}
                    initials={partner.initials}
                    logoUrl={partner.logoUrl}
                    size={44}
                  />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{partner.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {partner.productCount !== undefined
                        ? `${partner.productCount} shared ${partner.productCount === 1 ? 'item' : 'items'}`
                        : 'Shared inventory'}
                    </Text>
                  </View>
                  <ChevronRight size={20} color="#D4D4D8" />
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

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
            <><Text style={styles.empty}>
                No pools yet. Pools group your store locations so inventory syncs together —
                and they're what you share with partners.
              </Text><TouchableOpacity
                style={[styles.connectBtn, {backgroundColor: "#666"}]}
                activeOpacity={0.8}
                onPress={() => setCreatePoolOpen(true)}
                disabled={!currentOrg?.id}
              >
                  <Plus size={14} color="#FFFFFF" />
                  <Text style={styles.newPoolPillText}>New pool</Text>
                </TouchableOpacity></>
            
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
            style={[styles.connectBtn, {backgroundColor: "#666",}]}
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
              <TouchableOpacity
                style={styles.connectPill}
                activeOpacity={0.8}
                onPress={() => Alert.alert(a.label, `Connecting ${a.label} is coming soon!`)}
              >
                <Text style={styles.connectPillText}>Connect</Text>
              </TouchableOpacity>
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

      <ErrorModal
        visible={!!importError}
        type="error"
        title={importError?.title || 'Import failed'}
        message={importError?.message || ''}
        onClose={() => setImportError(null)}
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
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  attnPill: { backgroundColor: 'rgba(162,97,26,0.12)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  attnPillText: { color: '#A2611A', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  rowTitle: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  rowSub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular', marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  poolIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(147,200,34,0.14)' },
  poolIconPartner: { backgroundColor: 'rgba(162,97,26,0.12)' },
  newPoolPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#18181B', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  newPoolPillText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

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
  connectPill: { backgroundColor: '#18181B', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  connectPillText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#93C822', borderRadius: 16, paddingVertical: 15, marginTop: 14 },
  connectText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
  appsHint: { color: '#9CA3AF', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 10, marginLeft: 4, lineHeight: 17 },
});

export default ConnectionsScreen;
