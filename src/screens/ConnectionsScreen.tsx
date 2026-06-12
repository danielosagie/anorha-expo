// Connections — everything the org plugs into, in one place:
// selling platforms (live status), POOLS (the location groups inventory syncs and
// partners share through — managed here now, not buried in the legacy profile),
// and apps (Slack/Gmail via Composio, placeholders until it's configured).

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Plus, Slack, Mail, Layers, Handshake, RefreshCw, Trash2 } from 'lucide-react-native';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';
import { useOrg } from '../context/OrgContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import PlatformAvatar from '../components/PlatformAvatar';
import CreatePoolSheet from '../components/pools/CreatePoolSheet';
import { PageHeader } from '../components/ui/PageHeader';

const statusOf = (raw?: string): { label: string; color: string } => {
  const s = (raw || '').toLowerCase();
  if (s.includes('active') || s.includes('connect') || s === 'ok' || s === 'live') return { label: 'Connected', color: '#43631A' };
  if (s.includes('error') || s.includes('expired') || s.includes('revoked') || s.includes('fail')) return { label: 'Needs reconnect', color: '#DC2626' };
  if (s.includes('sync')) return { label: 'Syncing…', color: '#A2611A' };
  return { label: raw || 'Connected', color: '#71717A' };
};

/** "myshop.myshopify.com" → "myshop". */
const shopLabel = (c: any): string =>
  String(c.DisplayName || c.PlatformType || 'Platform').replace(/\.myshopify\.com$/i, '');

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
                    navigation.navigate('ImportOverview', { connectionId: c.Id, platformName: c.PlatformType })
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

        {/* Pools — the location groups that platforms sync and partners share through */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.section, { marginBottom: 0 }]}>Pools</Text>
          <TouchableOpacity
            style={styles.newPoolPill}
            activeOpacity={0.8}
            onPress={() => setCreatePoolOpen(true)}
            disabled={!currentOrg?.id}
          >
            <Plus size={14} color="#FFFFFF" />
            <Text style={styles.newPoolPillText}>New pool</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {poolsLoading && pools.length === 0 ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
          ) : pools.length === 0 ? (
            <Text style={styles.empty}>
              No pools yet. Pools group your store locations so inventory syncs together —
              and they're what you share with partners.
            </Text>
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
        <Text style={styles.appsHint}>
          Tap a pool to manage its locations and partner sharing.
        </Text>

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
                onPress={() => Alert.alert(a.label, `Connecting ${a.label} runs through Composio — it'll be available here once Composio is set up.`)}
              >
                <Text style={styles.connectPillText}>Connect</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <Text style={styles.appsHint}>Slack and Gmail connect through Composio — available once it's set up.</Text>
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
