// Per-store sync settings. Reached by tapping a store under Integrations
// (SettingsScreen → SyncRules). This is the calm "all settings" surface — the
// same list-card + autosave language as NotificationSettings, NOT the old 4-step
// wizard. One scroll of grouped toggles; every change autosaves (quiet "Saved").
//
// Only the money-movers are surfaced: automation (auto-sync / add-new), what
// syncs (inventory / prices), and direction. The fields this screen has no UI
// for — sourceOfTruth, mode, schedule, destinations — are ROUND-TRIPPED from the
// loaded rules so a calm edit here never clobbers what the engine had. Payload
// shape stays identical to SyncPreferencesSheet / the engine contract.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, ActivityIndicator, StatusBar,
} from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  RefreshCw, PlusCircle, Package, Tag, ArrowLeftRight, ArrowUpFromLine, ArrowDownToLine,
  AlertTriangle, ChevronRight, Link2Off, Check,
} from 'lucide-react-native';

import { AppStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { normalizeDisplayName } from '../config/platforms';
import { useImportHub } from '../hooks/useImportHub';
import PageHeader from '../components/ui/PageHeader';
import PlatformAvatar from '../components/PlatformAvatar';
import ErrorModal from '../components/ErrorModal';
import { createLogger } from '../utils/logger';

const log = createLogger('SyncRulesScreen');

// System-B palette (matches ConnectionsScreen / NotificationSettings).
const INK = '#18181B';
const SUBTLE = '#71717A';
const MUTED = '#9CA3AF';
const FAINT = '#D4D4D8';
const BG = '#F6F7F4';
const SURFACE = '#FFFFFF';
const BORDER = '#ECEBE6';
const HAIRLINE = '#F1F1EE';
const GREEN = '#93C822';
const GREEN_DARK = '#43631A';
const GREEN_TINT = 'rgba(147,200,34,0.12)';
const AMBER = '#BA7517';
const AMBER_TINT = 'rgba(186,117,23,0.12)';
const RED = '#DC2626';

// Canonical backend enums (sync-rules.service.ts) — keep in lockstep with the engine.
type SyncDirection = 'bidirectional' | 'push_only' | 'pull_only';
type SourceOfTruth = 'ANORHA' | 'PLATFORM';

// The essentials this screen actually edits.
interface Rules {
  syncDirection: SyncDirection;
  autoUpdate: boolean; // propagateUpdates
  autoCreate: boolean; // createNew
  syncInventory: boolean;
  syncPricing: boolean;
}

// Fields with no UI here — round-tripped verbatim so an edit can't reset them.
interface Preserved {
  sourceOfTruth: SourceOfTruth;
  mode: 'manual' | 'auto' | 'batch';
  schedule: any;
  destinations: any;
}

const DIRECTION_OPTIONS: { value: SyncDirection; title: string; sub: string; Icon: any }[] = [
  { value: 'bidirectional', title: 'Two-way sync', sub: 'Changes flow in both directions', Icon: ArrowLeftRight },
  { value: 'push_only', title: 'Push to platform', sub: 'Anorha updates your store only', Icon: ArrowUpFromLine },
  { value: 'pull_only', title: 'Pull from platform', sub: 'Your store updates Anorha only', Icon: ArrowDownToLine },
];

const statusOf = (raw?: string): { label: string; color: string } => {
  const s = (raw || '').toLowerCase();
  if (s.includes('error') || s.includes('expired') || s.includes('revoked') || s.includes('fail')) return { label: 'Needs reconnect', color: RED };
  if (s.includes('scan') || s.includes('sync')) return { label: 'Syncing', color: AMBER };
  return { label: 'Connected', color: GREEN_DARK };
};

type RouteType = RouteProp<AppStackParamList, 'SyncRules'>;
type NavType = StackNavigationProp<AppStackParamList, 'SyncRules'>;

const SyncRulesScreen = () => {
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavType>();
  const insets = useSafeAreaInsets();
  const { connectionId } = route.params;
  const routeParams = route.params as any;

  const [platformType, setPlatformType] = useState<string>(routeParams?.platformName || '');
  const [displayName, setDisplayName] = useState<string>('');
  const [status, setStatus] = useState<string>('active');

  const [loading, setLoading] = useState(true);
  const [rulesReady, setRulesReady] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const [rules, setRules] = useState<Rules>({
    syncDirection: 'bidirectional',
    autoUpdate: true,
    autoCreate: true,
    syncInventory: true,
    syncPricing: true,
  });
  const preserved = useRef<Preserved>({
    sourceOfTruth: 'ANORHA',
    mode: 'manual',
    schedule: null,
    destinations: { connectionIds: [connectionId] },
  });

  // Passive "needs you" signal — the ONE explicit deep-link into the review deck.
  const hub = useImportHub();
  const attn = hub.lanes.matches.byConnection.find((b) => b.connectionId === connectionId)?.count || 0;

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRequestRef = useRef(0);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const name = normalizeDisplayName(displayName || platformType || 'Platform');
  const st = statusOf(status);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setRulesReady(false);
      try {
        const { data, error } = await supabase
          .from('PlatformConnections')
          .select('DisplayName, PlatformType, Status, SyncRules')
          .eq('Id', connectionId)
          .single();
        if (!alive) return;
        if (error) { log.error('load sync rules', error); return; }

        setDisplayName(data?.DisplayName || '');
        setPlatformType(data?.PlatformType || platformType);
        setStatus(data?.Status || 'active');

        const r = (data as any)?.SyncRules;
        if (r) {
          const legacyDir: Record<string, SyncDirection> = {
            'two-way': 'bidirectional', 'push-only': 'push_only', 'pull-only': 'pull_only',
          };
          const dir = r.syncDirection;
          const sot: SourceOfTruth | undefined =
            r.productDetailsSoT || r.inventorySoT ||
            (r.sourceOfTruth === 'platform' ? 'PLATFORM' : r.sourceOfTruth === 'sssync' ? 'ANORHA' : undefined);
          setRules({
            syncDirection: (dir && legacyDir[dir]) || (dir as SyncDirection) || 'bidirectional',
            autoUpdate: r.propagateUpdates !== undefined ? r.propagateUpdates : r.autoUpdate !== undefined ? r.autoUpdate : true,
            autoCreate: r.createNew !== undefined ? r.createNew : r.autoCreate !== undefined ? r.autoCreate : true,
            syncInventory: r.syncInventory !== undefined ? r.syncInventory : true,
            syncPricing: r.syncPricing !== undefined ? r.syncPricing : true,
          });
          preserved.current = {
            sourceOfTruth: sot || 'ANORHA',
            mode: (r.mode as Preserved['mode']) || 'manual',
            schedule: r.schedule ?? null,
            destinations: r.destinations ?? { connectionIds: [connectionId] },
          };
        }
        setRulesReady(true);
      } catch (err) {
        log.error('load sync rules', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [connectionId]);

  // Autosave — merge the change, PUT the full canonical payload, revert on failure.
  const persist = async (next: Rules, prev: Rules) => {
    const request = ++saveRequestRef.current;
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSaveState('saving');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error('Auth required');
      const p = preserved.current;
      const body = {
        syncDirection: next.syncDirection,
        productDetailsSoT: p.sourceOfTruth,
        inventorySoT: p.sourceOfTruth,
        createNew: next.autoCreate,
        propagateUpdates: next.autoUpdate,
        syncInventory: next.syncInventory,
        syncPricing: next.syncPricing,
        mode: p.mode,
        schedule: p.mode === 'batch' ? p.schedule : null,
        destinations: p.destinations,
      };
      const res = await fetch(`${API_BASE_URL}/api/sync-rules/connections/${connectionId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      if (request !== saveRequestRef.current) return;
      setSaveState('saved');
      savedTimer.current = setTimeout(() => {
        if (request === saveRequestRef.current) setSaveState('idle');
      }, 1600);
    } catch (err) {
      log.error('save sync rules', err);
      if (request !== saveRequestRef.current) return;
      setRules(prev); // this was the state visible before the latest change
      setSaveState('error');
    }
  };

  const update = (patch: Partial<Rules>) => {
    if (!rulesReady) return;
    setRules((prev) => {
      const next = { ...prev, ...patch };
      persist(next, prev);
      return next;
    });
  };

  const disconnect = async () => {
    setDisconnectOpen(false);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error('Auth required');
      // Non-destructive: keep all products/inventory (mirrors ConnectionsScreen).
      const res = await fetch(`${API_BASE_URL}/api/platform-connections/${connectionId}/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleanupStrategy: 'keep' }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      navigation.goBack();
    } catch (e: any) {
      log.error('disconnect', e);
      setSaveState('error');
    }
  };

  const SaveBadge = () => {
    if (saveState === 'saving') return <Text style={styles.badgeMuted}>Saving…</Text>;
    if (saveState === 'saved') return (
      <View style={styles.badgeSaved}><Check size={13} color={GREEN_DARK} /><Text style={styles.badgeSavedText}>Saved</Text></View>
    );
    if (saveState === 'error') return <Text style={styles.badgeError}>Couldn't save</Text>;
    return null;
  };

  const ToggleRow = ({ Icon, label, description, value, onValueChange, first }: any) => (
    <View style={[styles.row, !first && styles.rowDivider]}>
      <View style={styles.rowIcon}><Icon size={22} color={INK} /></View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: FAINT, true: GREEN }} thumbColor="#FFFFFF" />
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Sync settings" onBack={() => navigation.goBack()} right={<SaveBadge />} />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={GREEN} /></View>
        ) : (
          <>
            {/* Store identity + live status */}
            <View style={styles.storeCard}>
              <PlatformAvatar platformType={(platformType || '').toLowerCase()} size="medium" />
              <View style={{ flex: 1 }}>
                <Text style={styles.storeName} numberOfLines={1}>{name}</Text>
                <View style={styles.statusRow}>
                  <View style={[styles.dot, { backgroundColor: st.color }]} />
                  <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>
            </View>

            {/* Status loud: the one deep-link into the review deck */}
            {attn > 0 && (
              <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('SyncInbox', { connectionId, platformName: name })} style={styles.needsRow}>
                <View style={styles.needsIcon}><AlertTriangle size={20} color={AMBER} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.needsTitle}>{attn} {attn === 1 ? 'item needs' : 'items need'} you</Text>
                  <Text style={styles.needsSub}>Review matches</Text>
                </View>
                <ChevronRight size={20} color={MUTED} />
              </TouchableOpacity>
            )}

            <Text style={styles.sectionLabel}>Automation</Text>
            <View style={styles.listCard}>
              <ToggleRow first Icon={RefreshCw} label="Auto-sync changes" description="Push updates as they happen." value={rules.autoUpdate} onValueChange={(v: boolean) => update({ autoUpdate: v })} />
              <ToggleRow Icon={PlusCircle} label="Add new items automatically" description="Create listings for products it hasn't seen." value={rules.autoCreate} onValueChange={(v: boolean) => update({ autoCreate: v })} />
            </View>

            <Text style={styles.sectionLabel}>What syncs</Text>
            <View style={styles.listCard}>
              <ToggleRow first Icon={Package} label="Inventory" description="Keep stock counts in step." value={rules.syncInventory} onValueChange={(v: boolean) => update({ syncInventory: v })} />
              <ToggleRow Icon={Tag} label="Prices" description="Keep prices in step." value={rules.syncPricing} onValueChange={(v: boolean) => update({ syncPricing: v })} />
            </View>

            <Text style={styles.sectionLabel}>Sync direction</Text>
            <View style={styles.listCard}>
              {DIRECTION_OPTIONS.map((opt, i) => {
                const selected = rules.syncDirection === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    activeOpacity={0.85}
                    onPress={() => update({ syncDirection: opt.value })}
                    style={[styles.row, i > 0 && styles.rowDivider]}
                  >
                    <View style={styles.rowIcon}><opt.Icon size={22} color={selected ? GREEN_DARK : SUBTLE} /></View>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, selected && { color: GREEN_DARK }]}>{opt.title}</Text>
                      <Text style={styles.rowDescription}>{opt.sub}</Text>
                    </View>
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected && <Check size={14} color="#FFFFFF" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Quiet destructive action */}
            <TouchableOpacity activeOpacity={0.7} onPress={() => setDisconnectOpen(true)} style={styles.disconnectRow}>
              <Link2Off size={19} color={RED} />
              <Text style={styles.disconnectText}>Disconnect {name}</Text>
            </TouchableOpacity>
            <Text style={styles.disconnectHint}>Your products stay in Anorha.</Text>
          </>
        )}
      </ScrollView>

      <ErrorModal
        visible={disconnectOpen}
        type="warning"
        title={`Disconnect ${name}?`}
        message="Your products stay in Anorha. You can reconnect anytime."
        buttonText="Keep connected"
        onClose={() => setDisconnectOpen(false)}
        secondaryButtonText="Disconnect"
        onSecondaryPress={disconnect}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  center: { paddingVertical: 90, alignItems: 'center', justifyContent: 'center' },

  // Save badge (in the header's right slot)
  badgeMuted: { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  badgeSaved: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: GREEN_TINT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeSavedText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: GREEN_DARK },
  badgeError: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: AMBER },

  // Store identity
  storeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: SURFACE,
    borderRadius: 20, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 22,
  },
  storeName: { fontSize: 18, fontFamily: 'Inter_700Bold', color: INK },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Needs-you attention row
  needsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: SURFACE,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 22,
  },
  needsIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: AMBER_TINT },
  needsTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: INK },
  needsSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: SUBTLE, marginTop: 2 },

  // Section
  sectionLabel: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold', color: SUBTLE,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4,
  },
  listCard: { backgroundColor: SURFACE, borderRadius: 20, paddingHorizontal: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 24 },

  // Row (toggle + option share this)
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  rowIcon: { width: 28, alignItems: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: INK },
  rowDescription: { fontSize: 13, fontFamily: 'Inter_400Regular', color: SUBTLE, marginTop: 2 },

  // Direction radio
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: FAINT, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: GREEN, backgroundColor: GREEN },

  // Disconnect
  disconnectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 4 },
  disconnectText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: RED },
  disconnectHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', marginTop: -2 },
});

export default SyncRulesScreen;
