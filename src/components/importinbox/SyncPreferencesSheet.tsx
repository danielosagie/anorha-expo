// SyncPreferencesSheet — the "quick tune this store" bottom sheet, opened from the
// Import Hub's "Your stores" list. It is the calm, essentials-only counterpart to
// the full SyncRulesScreen: the same per-connection rules payload, the same PUT
// endpoint, but reduced to the two decisions a seller changes most (which way sync
// flows, and whether it happens on its own). Everything heavier — source-of-truth,
// destinations, reconcile, disconnect — stays on the full screen, reachable via the
// quiet "All settings" link in the footer.
//
// PARITY WITH SyncRulesScreen (src/screens/SyncRulesScreen.tsx) — deliberate, not
// coincidental. This sheet must NOT invent its own payload:
//   • Load reads PlatformConnections.SyncRules and parses it with the SAME legacy-
//     aware coercion SyncRulesScreen.loadSyncRules uses (createNew||autoCreate, the
//     'two-way'→'bidirectional' map, productDetailsSoT||inventorySoT, …).
//   • Save PUTs the SAME body shape to the SAME `${API_BASE_URL}/api/sync-rules/
//     connections/:id` endpoint SyncRulesScreen.saveSyncRules uses. The fields this
//     sheet has no UI for (sourceOfTruth, syncInventory, syncPricing, mode,
//     schedule, destinations) are ROUND-TRIPPED from the loaded rules so a quick
//     edit here never silently resets what the full screen configured.
// If the full screen's shapes ever change, this file changes in lockstep.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import BaseModal from '../BaseModal';
import PlatformLogo from '../PlatformLogo';
import { IC, PillButton, SectionCaption, SheetGrabber, OptionRow } from './InboxKit';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../config/env';
import { createLogger } from '../../utils/logger';

const log = createLogger('SyncPreferencesSheet');

// Canonical backend enums — kept identical to SyncRulesScreen so saved directives
// stay readable/enforceable by the sync engine.
type SyncDirection = 'bidirectional' | 'push_only' | 'pull_only';
type SourceOfTruth = 'ANORHA' | 'PLATFORM';

// SyncRulesScreen builds its URL as `${API_BASE_URL}/api/sync-rules/...` (the raw
// base, NOT the /api-normalized one) — mirror that exactly for endpoint parity.
const API_ROOT = API_BASE_URL;

const DIRECTION_OPTIONS: { value: SyncDirection; title: string; sub: string }[] = [
  { value: 'bidirectional', title: 'Two-way sync', sub: 'Changes flow in both directions' },
  { value: 'push_only', title: 'Push to platform', sub: 'Anorha updates your store only' },
  { value: 'pull_only', title: 'Pull from platform', sub: 'Your store updates Anorha only' },
];

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// Fields the sheet doesn't surface but must preserve verbatim across a save so a
// quick edit here can't clobber the full screen's scheduling / destinations.
interface PreservedRules {
  sourceOfTruth: SourceOfTruth;
  syncInventory: boolean;
  syncPricing: boolean;
  mode: 'manual' | 'auto' | 'batch';
  schedule: any;
  destinations: any;
}

function ToggleRow({
  label,
  sub,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleBody}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {!!sub && <Text style={styles.toggleSub}>{sub}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityHint={sub}
        trackColor={{ false: IC.hairline, true: IC.accent }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={IC.hairline}
      />
    </View>
  );
}

export default function SyncPreferencesSheet({
  visible,
  onClose,
  connectionId,
  platformName,
  platformType,
  needsAttention,
  onOpenInbox,
  onOpenAllSettings,
}: {
  visible: boolean;
  onClose: () => void;
  connectionId: string;
  /** Friendly store name for the header (e.g. "myshop"). */
  platformName: string;
  /** Raw PlatformType — brand logo + muted subtitle (e.g. "shopify"). */
  platformType?: string;
  /** Parked-inbox count for this connection; >0 shows the quiet "needs you" row. */
  needsAttention: number;
  /** Closes the sheet and dives into this connection's review deck (SyncInbox). */
  onOpenInbox: () => void;
  /** Closes the sheet and opens the full SyncRules management screen. */
  onOpenAllSettings: () => void;
}) {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Save stays disabled until a load for THIS connection succeeds — a failed read
  // would otherwise let a full PUT of defaults (or a previous store's state)
  // clobber the hidden round-tripped rules.
  const [rulesReady, setRulesReady] = useState(false);

  // Editable essentials.
  const [syncDirection, setSyncDirection] = useState<SyncDirection>('bidirectional');
  const [autoUpdate, setAutoUpdate] = useState(true); // propagateUpdates
  const [autoCreate, setAutoCreate] = useState(true); // createNew

  // Round-tripped (untouched) rules — defaults mirror SyncRulesScreen's.
  const [preserved, setPreserved] = useState<PreservedRules>({
    sourceOfTruth: 'ANORHA',
    syncInventory: true,
    syncPricing: true,
    mode: 'manual',
    schedule: null,
    destinations: { connectionIds: [connectionId] },
  });

  // Load existing rules whenever the sheet opens for a connection. Mirrors
  // SyncRulesScreen.loadSyncRules field-for-field, plus captures the preserved set.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      setRulesReady(false);
      try {
        const { data, error: qErr } = await supabase
          .from('PlatformConnections')
          .select('SyncRules')
          .eq('Id', connectionId)
          .single();

        if (qErr) {
          log.error('Error loading sync rules:', qErr);
          if (alive) setError('Couldn’t load preferences.');
          return;
        }

        const rules = (data as any)?.SyncRules;
        if (!alive) return;

        if (rules) {
          // Direction: canonical enum with back-compat for legacy hyphenated values.
          const legacyDir: Record<string, SyncDirection> = {
            'two-way': 'bidirectional',
            'push-only': 'push_only',
            'pull-only': 'pull_only',
          };
          const dir = rules.syncDirection;
          setSyncDirection((dir && legacyDir[dir]) || (dir as SyncDirection) || 'bidirectional');

          // Source of truth: productDetailsSoT/inventorySoT ('PLATFORM'|'ANORHA'),
          // falling back to the legacy 'sssync'/'platform' shape.
          const sot: SourceOfTruth | undefined =
            rules.productDetailsSoT ||
            rules.inventorySoT ||
            (rules.sourceOfTruth === 'platform'
              ? 'PLATFORM'
              : rules.sourceOfTruth === 'sssync'
                ? 'ANORHA'
                : undefined);

          // createNew / propagateUpdates are canonical; keep legacy autoCreate /
          // autoUpdate as fallbacks (exactly as SyncRulesScreen does).
          setAutoCreate(
            rules.createNew !== undefined ? rules.createNew : rules.autoCreate !== undefined ? rules.autoCreate : true,
          );
          setAutoUpdate(
            rules.propagateUpdates !== undefined
              ? rules.propagateUpdates
              : rules.autoUpdate !== undefined
                ? rules.autoUpdate
                : true,
          );

          setPreserved({
            sourceOfTruth: sot || 'ANORHA',
            syncInventory: rules.syncInventory !== undefined ? rules.syncInventory : true,
            syncPricing: rules.syncPricing !== undefined ? rules.syncPricing : true,
            mode: (rules.mode as PreservedRules['mode']) || 'manual',
            schedule: rules.schedule ?? null,
            destinations: rules.destinations ?? { connectionIds: [connectionId] },
          });
        } else {
          // No rules yet — reset to the same defaults the full screen starts from.
          setSyncDirection('bidirectional');
          setAutoCreate(true);
          setAutoUpdate(true);
          setPreserved({
            sourceOfTruth: 'ANORHA',
            syncInventory: true,
            syncPricing: true,
            mode: 'manual',
            schedule: null,
            destinations: { connectionIds: [connectionId] },
          });
        }
        setRulesReady(true);
      } catch (err) {
        log.error('Error loading sync rules:', err);
        if (alive) setError('Couldn’t load preferences.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, connectionId]);

  // Save — identical endpoint + body shape to SyncRulesScreen.saveSyncRules. The
  // preserved fields ride along unchanged so this quick edit is purely additive.
  const save = async () => {
    if (!rulesReady || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error('Auth required');

      const updates: Record<string, any> = {
        syncDirection,
        productDetailsSoT: preserved.sourceOfTruth,
        inventorySoT: preserved.sourceOfTruth,
        createNew: autoCreate,
        propagateUpdates: autoUpdate,
        syncInventory: preserved.syncInventory,
        syncPricing: preserved.syncPricing,
        mode: preserved.mode,
        schedule: preserved.mode === 'batch' ? preserved.schedule : null,
        destinations: preserved.destinations,
      };

      const res = await fetch(`${API_ROOT}/api/sync-rules/connections/${connectionId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);

      // Calm success: just close. The full screen owns the noisier confirmations.
      onClose();
    } catch (err: any) {
      log.error('Error saving sync rules:', err);
      setError('Couldn’t save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const attnLabel =
    needsAttention === 1 ? '1 item needs you' : `${needsAttention} items need you`;

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      position="bottom"
      containerStyle={{ padding: 0, maxHeight: '86%', alignItems: 'stretch' }}
    >
      <SheetGrabber />

      {/* Header — logo · store name + platform · close */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <PlatformLogo type={platformType || platformName} size={22} />
        </View>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {platformName}
          </Text>
          {!!(platformType || '').trim() && (
            <Text style={styles.headerSub} numberOfLines={1}>
              {platformType}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={HIT} activeOpacity={0.7} style={styles.headerClose}>
          <MaterialCommunityIcons name="close" size={22} color={IC.muted} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={IC.accent} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Quiet "needs you" row — the one deep-link into this store's deck. */}
          {needsAttention > 0 && (
            <TouchableOpacity activeOpacity={0.85} onPress={onOpenInbox} style={styles.needsRow}>
              <View style={styles.needsBody}>
                <Text style={styles.needsTitle}>{attnLabel}</Text>
                <Text style={styles.needsSub}>Review matches</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={IC.muted} />
            </TouchableOpacity>
          )}

          <SectionCaption>Sync direction</SectionCaption>
          {DIRECTION_OPTIONS.map((opt) => (
            <OptionRow
              key={opt.value}
              title={opt.title}
              sub={opt.sub}
              selected={syncDirection === opt.value}
              onPress={() => setSyncDirection(opt.value)}
            />
          ))}

          <View style={styles.sectionGap} />
          <SectionCaption>Automation</SectionCaption>
          <View style={styles.toggleGroup}>
            <ToggleRow
              label="Auto-sync changes"
              sub="Push updates as they happen"
              value={autoUpdate}
              onValueChange={setAutoUpdate}
            />
            <View style={styles.toggleDivider} />
            <ToggleRow
              label="Add new items automatically"
              sub="Create listings for products it hasn’t seen"
              value={autoCreate}
              onValueChange={setAutoCreate}
            />
          </View>
        </ScrollView>
      )}

      {/* Footer — Save · inline error · quiet "All settings" link */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        {!!error && <Text style={styles.errorText}>{error}</Text>}
        <PillButton label="Save" onPress={save} loading={saving} disabled={loading || !rulesReady || saving} />
        <TouchableOpacity onPress={onOpenAllSettings} activeOpacity={0.7} style={styles.allSettings} hitSlop={HIT}>
          <Text style={styles.allSettingsText}>All settings</Text>
        </TouchableOpacity>
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: IC.hairline,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: IC.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerBody: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: IC.ink, letterSpacing: -0.3 },
  headerSub: { fontSize: 13, color: IC.muted, marginTop: 2, textTransform: 'capitalize' },
  headerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Loading
  loading: { paddingVertical: 56, alignItems: 'center', justifyContent: 'center' },

  // Scroll body
  scroll: { flexShrink: 1 },
  scrollBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },

  // "Needs you" quiet row
  needsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: IC.card,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  needsBody: { flex: 1, minWidth: 0 },
  needsTitle: { fontSize: 16, fontWeight: '700', color: IC.ink, letterSpacing: -0.2 },
  needsSub: { fontSize: 14, color: IC.muted, marginTop: 2 },

  sectionGap: { height: 18 },

  // Toggle group (one soft card, hairline-split rows)
  toggleGroup: { backgroundColor: IC.card, borderRadius: 16, paddingHorizontal: 16 },
  toggleDivider: { height: 1, backgroundColor: IC.hairline },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  toggleBody: { flex: 1, minWidth: 0 },
  toggleLabel: { fontSize: 16, fontWeight: '600', color: IC.ink, letterSpacing: -0.2 },
  toggleSub: { fontSize: 14, color: IC.muted, marginTop: 2, lineHeight: 19 },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: IC.hairline,
    gap: 12,
  },
  errorText: { fontSize: 14, color: IC.muted, textAlign: 'center' },
  allSettings: { alignItems: 'center', paddingVertical: 4 },
  allSettingsText: { fontSize: 15, color: IC.muted, fontWeight: '600' },
});
