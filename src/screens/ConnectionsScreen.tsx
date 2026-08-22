// Connections: selling platforms, computers, pools, and partners in one place.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, InteractionManager, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Plus, Layers, Handshake, Trash2, Monitor } from 'lucide-react-native';
import { usePlatformConnections, type PlatformConnectionRow } from '../context/PlatformConnectionsContext';
import LinkComputerSheet from '../components/LinkComputerSheet';
import LinkComputerScanSheet from '../components/LinkComputerScanSheet';
import { useComputerJobStatus, type ConnectedComputer } from '../hooks/useComputerJobStatus';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';
import { useOrg } from '../context/OrgContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import PlatformAvatar from '../components/PlatformAvatar';
import ConnectFlowSheet from '../components/ConnectFlowSheet';
import CreatePoolSheet from '../components/pools/CreatePoolSheet';
import { PageHeader } from '../components/ui/PageHeader';
import { getPlatform, normalizeDisplayName } from '../config/platforms';
import { useImportStatus } from '../hooks/useImportStatus';
import { api } from '../lib/apiClient';
import { pickAndParseCsv } from '../utils/csvImport';
import ErrorModal from '../components/ErrorModal';
import PartnerBadge from '../components/PartnerBadge';
import { buildPartnerInventoryOrigins, PartnerInventoryOrigin } from '../lib/partnerInventory';
import {
  connectionImportPresentationsById,
  latestImportsByConnection,
  listSellingPlatformConnections,
} from '../lib/connectionImportPresentation';
import { connectionRowModel } from '../lib/connectionRowModel';
import { shouldOpenImportQuestionQueue } from '../lib/connectionImportRoute';
import {
  alreadyTerminalCancelCopy,
  parseCancelImportReceipt,
} from '../lib/cancelImportReceipt';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** "myshop.myshopify.com" → "myshop"; resolves known platforms to their label. */
const shopLabel = (
  c: Pick<PlatformConnectionRow, 'DisplayName' | 'PlatformType'>,
): string => {
  const displayName = String(c.DisplayName || '').trim();
  if (String(c.PlatformType || '').toLowerCase() === 'csv' && (!displayName || UUID_PATTERN.test(displayName))) {
    return 'CSV import';
  }
  return normalizeDisplayName(displayName || String(c.PlatformType || 'Platform'));
};

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

const ConnectionsScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const {
    connections,
    progressByConnectionId,
    hasResolvedConnections,
    error: connectionsError,
    refresh,
    updateConnectionLocally,
  } = usePlatformConnections();
  const overlay = usePlatformPickerOverlay();
  const { currentOrg } = useOrg();

  // Import attention remains on each connection row; there is no aggregate card.
  const importStatus = useImportStatus();
  const recentImportByConnection = useMemo(() => {
    return latestImportsByConnection(importStatus.recentImports);
  }, [importStatus.recentImports]);
  const presentationByConnectionId = useMemo(
    () => connectionImportPresentationsById({
      connections,
      aggregateConnections: importStatus.connections,
      recentImports: importStatus.recentImports,
      progressByConnectionId,
    }),
    [connections, importStatus.connections, importStatus.recentImports, progressByConnectionId],
  );
  const activeConnections = useMemo(
    () => listSellingPlatformConnections(connections),
    [connections],
  );
  const [pools, setPools] = useState<Pool[]>([]);
  const [partners, setPartners] = useState<PartnerInventoryOrigin[]>([]);
  // CSV pick/parse failures surface in an ErrorModal (native Alert stays for the
  // pre-existing platform flows).
  const [importError, setImportError] = useState<{ title: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshConnections = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([refresh(), importStatus.refresh()]);
    } finally {
      setRefreshing(false);
    }
  }, [importStatus.refresh, refresh]);

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

  // Connected computers used by registry platforms with computer-mediated writes.
  const {
    computers,
    degraded,
    presenceLoaded,
    presenceUnavailable,
    refreshPresence,
  } = useComputerJobStatus();
  const computerStatusUnavailable = degraded || presenceUnavailable;
  const [linkComputerOpen, setLinkComputerOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [unlinkingWorkerId, setUnlinkingWorkerId] = useState<string | null>(null);

  // The global picker hands every platform to the one shared connect flow. This
  // keeps store-specific steps, such as Shopify's picker, on the same path.
  const [flowPlatform, setFlowPlatform] = useState<string | null>(null);
  const [retryConnectionId, setRetryConnectionId] = useState<string | null>(null);

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
      setRetryConnectionId(null);
      setFlowPlatform(def.key);
    },
    [overlay, runCsvImport],
  );

  const openImportRetry = useCallback((connection: PlatformConnectionRow) => {
    setRetryConnectionId(connection.Id);
    setFlowPlatform(connection.PlatformType);
  }, []);

  // Manage mode: the one sanctioned way to remove a connection. Restored after
  // the row simplification removed it and left no disconnect path at all.
  const [managing, setManaging] = useState(false);
  const disconnectPlatform = useCallback((c: PlatformConnectionRow) => {
    Alert.alert('Remove connection', `Disconnect "${shopLabel(c)}"? Your products stay in Anorha.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
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
            // NEVER restore the pre-disconnect row: the backend disables the row
            // BEFORE its cascade and leaves it disabled even on failure, so an
            // optimistic rollback would show "connected" for a dead connection.
            await refresh?.();
            Alert.alert('Error', 'Failed to disconnect. Please try again.');
          } finally {
            void importStatus.refresh();
          }
        },
      },
    ]);
  }, [updateConnectionLocally, refresh, importStatus]);

  const unlinkComputer = useCallback((computer: ConnectedComputer) => {
    if (!computer.workerId) {
      Alert.alert("Can't unlink", 'This computer is missing its link details. Link it again, then try.');
      return;
    }
    const workerId = computer.workerId;
    Alert.alert(
      'Unlink computer?',
      'It will stop posting from this computer.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: async () => {
            setUnlinkingWorkerId(workerId);
            try {
              await api.post(`/api/devices/${encodeURIComponent(workerId)}/revoke`);
              refreshPresence();
            } catch {
              Alert.alert("Couldn't unlink", 'Please try again.');
            } finally {
              setUnlinkingWorkerId(null);
            }
          },
        },
      ],
    );
  }, [refreshPresence]);

  // Hold the latest handler in a ref so the focus effect below can stay stable.
  const startConnectRef = useRef(handleStartConnect);
  startConnectRef.current = handleStartConnect;
  useFocusEffect(
    useCallback(() => {
      overlay.enableForScreen((p: string) => startConnectRef.current(p));
      return () => overlay.disableForScreen();
    }, [overlay.enableForScreen, overlay.disableForScreen]),
  );

  const cancelImport = useCallback((connection: PlatformConnectionRow) => {
    Alert.alert(
      'Cancel import?',
      'Pending items will be skipped. Products already imported will stay.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Cancel import',
          style: 'destructive',
          onPress: async () => {
            try {
              const receipt = parseCancelImportReceipt(
                await api.post(`/api/sync/connections/${connection.Id}/cancel-import`),
              );
              if (receipt.alreadyTerminal) {
                const copy = alreadyTerminalCancelCopy(receipt);
                Alert.alert(copy.title, copy.message);
              }
            } catch (error: any) {
              Alert.alert('Couldn’t cancel import', error?.message || 'Please try again.');
            } finally {
              await Promise.allSettled([refresh?.(), importStatus.refresh()]);
            }
          },
        },
      ],
    );
  }, [importStatus.refresh, refresh]);

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
      // means unrestricted. Filtering on it would hide even pools they create.
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
      // Keep whatever we had because pools are a convenience view here.
    } finally {
      setPoolsLoading(false);
    }
  }, [currentOrg?.id, currentOrg?.role, currentOrg?.assignedPoolIds]);

  // Reload on every focus. Pool edits and deletes happen on the detail screen and
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
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshConnections}
            progressViewOffset={insets.top}
            tintColor="#93C822"
            colors={['#93C822']}
          />
        )}
      >
        <PageHeader title="Connections" onBack={() => navigation.goBack()} />

        {/* Selling platforms. Each row has one status and one trailing affordance. */}
        <View style={[styles.sectionHeaderRow, { marginTop: 0 }]}>
          <Text style={[styles.section, { marginBottom: 0 }]}>Selling platforms</Text>
          {activeConnections.length > 0 && (
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
          {!hasResolvedConnections && activeConnections.length === 0 && !connectionsError ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
          ) : connectionsError && activeConnections.length === 0 ? (
            <TouchableOpacity style={styles.loadingRow} onPress={() => refresh?.()}>
              <Text style={styles.empty}>Couldn’t load your connections. Tap to retry.</Text>
            </TouchableOpacity>
          ) : activeConnections.length === 0 ? (
            <Text style={styles.empty}>No active platforms connected.</Text>
          ) : (
            activeConnections.map((c, i) => {
              const recentImport = recentImportByConnection.get(c.Id);
              const st = presentationByConnectionId.get(c.Id)!;
              const rowModel = connectionRowModel(st, { showCancelImport: true });
              const importInProgress = st.importInProgress;
              const title = shopLabel(c);
              const openConnection = () => {
                if (st.requiresReconnect) {
                  handleStartConnect(c.PlatformType);
                  return;
                }
                if (st.kind === 'failed' && st.canRetryImport) {
                  openImportRetry(c);
                  return;
                }
                if (shouldOpenImportQuestionQueue({
                  importInProgress,
                  attentionCount: st.attentionCount,
                })) {
                  navigation.navigate('ImportQuestionQueue', {
                    connectionId: c.Id,
                    importId: recentImport?.importId,
                    platformName: c.PlatformType,
                  });
                  return;
                }
                navigation.navigate('SyncRules', { connectionId: c.Id, platformName: c.PlatformType });
              };
              return (
                <TouchableOpacity
                  key={c.Id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  activeOpacity={0.7}
                  onLongPress={importInProgress ? () => cancelImport(c) : undefined}
                  onPress={openConnection}
                >
                  <PlatformAvatar platformType={(c.PlatformType || '').toLowerCase()} size="medium" />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
                    <View style={styles.statusRow}>
                      <View style={[styles.dot, { backgroundColor: rowModel.status.color }]} />
                      <Text style={[styles.statusText, { color: rowModel.status.color }]} numberOfLines={1}>
                        {rowModel.status.label}
                      </Text>
                    </View>
                  </View>
                  {managing ? (
                    <TouchableOpacity
                      style={styles.rowAction}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Disconnect ${title}`}
                      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                      onPress={(event: any) => {
                        event.stopPropagation?.();
                        disconnectPlatform(c);
                      }}
                    >
                      <Trash2 size={16} color="#DC2626" />
                    </TouchableOpacity>
                  ) : rowModel.trailing.type === 'action' ? (
                    <TouchableOpacity
                      style={styles.rowAction}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${rowModel.trailing.label} ${title}`}
                      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                      onPress={(event: any) => {
                        event.stopPropagation?.();
                        if (rowModel.trailing.type === 'action' && rowModel.trailing.label === 'Cancel') {
                          cancelImport(c);
                        } else {
                          openConnection();
                        }
                      }}
                    >
                      <Text style={styles.rowActionText}>{rowModel.trailing.label}</Text>
                    </TouchableOpacity>
                  ) : (
                    <ChevronRight size={20} color="#D4D4D8" />
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {importStatus.error ? (
          <Text style={styles.importStatusError}>Couldn't check imports. Pull to retry.</Text>
        ) : null}

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

        {/* Computers are the linked desktops that post for computer-written channels. Tap a
            row (or "Link a computer") to check status / set one up. */}
        <Text style={[styles.section, { marginTop: 26 }]}>Computers</Text>
        <View style={styles.card}>
          {computers.length === 0 ? (
            <Text style={styles.empty}>
              {computerStatusUnavailable
                ? "Can't check now"
                : presenceLoaded
                  ? 'No computers linked yet.'
                  : 'Checking'}
            </Text>
          ) : (
            computers.map((comp, i) => {
              const statusKnown = presenceLoaded && !computerStatusUnavailable;
              const color = statusKnown ? (comp.online ? '#93C822' : '#BA7517') : '#71717A';
              const statusLabel = !statusKnown
                ? (computerStatusUnavailable ? "Can't check now" : 'Checking')
                : comp.online
                  ? 'Online'
                  : `Offline, ${lastSeenLabel(comp.lastSeenAt)}`;
              return (
                <TouchableOpacity
                  key={comp.id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  activeOpacity={0.7}
                  onPress={() => setLinkComputerOpen(true)}
                >
                  <View style={styles.poolIcon}>
                    <Monitor size={20} color="#93C822" />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {computers.length <= 1 ? 'Your computer' : `Computer ${i + 1}`}
                    </Text>
                    <View style={styles.statusRow}>
                      <View style={[styles.dot, { backgroundColor: color }]} />
                      <Text style={[styles.statusText, { color }]} numberOfLines={1}>
                        {statusLabel}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.computerActions}>
                    <TouchableOpacity
                      style={styles.manageBtn}
                      disabled={unlinkingWorkerId !== null}
                      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                      onPress={(event: any) => {
                        event.stopPropagation?.();
                        unlinkComputer(comp);
                      }}
                    >
                      {unlinkingWorkerId === comp.workerId
                        ? <ActivityIndicator size="small" color="#52525B" />
                        : <Trash2 size={16} color="#DC2626" />}
                    </TouchableOpacity>
                    <ChevronRight size={20} color="#D4D4D8" />
                  </View>
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

        {/* Pools are location groups that platforms sync and partners share through. */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.section, { marginBottom: 0 }]}>Pools</Text>

        </View>
        <View style={styles.card}>
          {poolsLoading && pools.length === 0 ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
          ) : pools.length === 0 ? (
            <><Text style={styles.empty}>
                No pools yet. Pools group your store locations so inventory syncs together,
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
                    : <Layers size={20} color="#93C822" />}
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

      <ConnectFlowSheet
        visible={!!flowPlatform}
        platform={flowPlatform}
        orgId={currentOrg?.id}
        retryConnectionId={retryConnectionId}
        onCancel={() => {
          setFlowPlatform(null);
          setRetryConnectionId(null);
        }}
        onConnected={(connectionId, attentionCount) => {
          const platformName = flowPlatform || 'Platform';
          setFlowPlatform(null);
          setRetryConnectionId(null);
          const presentation = connectionId
            ? presentationByConnectionId.get(connectionId)
            : undefined;
          if (connectionId && shouldOpenImportQuestionQueue({
            importInProgress: presentation?.importInProgress === true,
            attentionCount,
          })) {
            navigation.navigate('ImportQuestionQueue', { connectionId, platformName });
          }
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
  managePill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#E4E4E7', backgroundColor: '#FFFFFF' },
  managePillOn: { backgroundColor: '#18181B', borderColor: '#18181B' },
  managePillText: { fontSize: 13, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, borderWidth: 1, borderColor: '#ECEBE6' },
  loadingRow: { paddingVertical: 26, alignItems: 'center' },
  empty: { paddingVertical: 22, textAlign: 'center', color: '#9CA3AF', fontFamily: 'Inter_500Medium', fontSize: 13, paddingHorizontal: 8, lineHeight: 19 },
  importStatusError: { color: '#71717A', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 8, marginLeft: 4 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  rowInfo: { flex: 1 },
  rowAction: { minWidth: 52, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  rowActionText: { color: '#52525B', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  rowTitle: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  rowSub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular', marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  poolIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(147,200,34,0.14)' },
  poolIconPartner: { backgroundColor: 'rgba(162,97,26,0.12)' },
  newPoolPillText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  computerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  manageBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F1EE',
    alignItems: 'center', justifyContent: 'center',
  },
  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#93C822', borderRadius: 16, paddingVertical: 15, marginTop: 14 },
  connectText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
});

export default ConnectionsScreen;
