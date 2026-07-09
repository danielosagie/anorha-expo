import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BaseModal from './BaseModal';
import PlatformLogo from './PlatformLogo';
import type { PlatformConnectionRow } from '../context/PlatformConnectionsContext';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { usePlatformConnect, type ConnectablePlatform } from '../hooks/usePlatformConnect';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
import { useOrg } from '../context/OrgContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { getPlatform, normalizeDisplayName } from '../config/platforms';
import {
  derivePlatformConnectStatus,
  getPlatformConnectStatusDisplay,
} from '../lib/platformConnectStatus';

interface Props {
  visible: boolean;
  connection: PlatformConnectionRow | null;
  onClose: () => void;
  onReview: (connection: PlatformConnectionRow) => void;
  onSyncRules: (connection: PlatformConnectionRow) => void;
}

type BusyAction = 'rescan' | 'reconnect' | 'disconnect' | null;

const AMBER = '#A2611A';
const RED = '#DC2626';
const TEXT_SECONDARY = '#6B7280';

const formatSyncDate = (dateString: string): string => {
  const timestamp = new Date(dateString).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export default function ConnectionDetailSheet({
  visible,
  connection,
  onClose,
  onReview,
  onSyncRules,
}: Props) {
  const { currentOrg } = useOrg();
  const { refresh } = usePlatformConnections();
  const { computerOnline, presenceLoaded } = useFacebookJobStatus();
  const { connect, startScan } = usePlatformConnect({ orgId: currentOrg?.id });
  const [busy, setBusy] = useState<BusyAction>(null);

  const platform = connection ? getPlatform(connection.PlatformType) : undefined;
  const status = useMemo(() => {
    if (!connection) return null;
    const derived = derivePlatformConnectStatus(connection.PlatformType, [connection], {
      computerOnline,
      presenceLoaded,
    });
    const raw = (connection.Status || '').toLowerCase();
    if (derived.uiState === 'needs-reauth') {
      return { label: 'Needs reconnect', color: RED, icon: 'alert-circle-outline' };
    }
    if (raw === 'review' || raw === 'pending' || raw === 'inactive') {
      return { label: 'Needs attention', color: AMBER, icon: 'alert-circle-outline' };
    }
    if (['scanning', 'syncing', 'reconciling'].includes(raw)) {
      return { label: 'Syncing', color: AMBER, icon: 'sync' };
    }
    const display = getPlatformConnectStatusDisplay(derived);
    return {
      ...display,
      icon: derived.uiState === 'connected' ? 'check-circle-outline' : 'alert-circle-outline',
    };
  }, [connection, computerOnline, presenceLoaded]);

  if (!connection || !platform || !status) return null;

  const accountName = normalizeDisplayName(connection.DisplayName || platform.label);
  const canReview = (connection.Status || '').toLowerCase() === 'review';
  const syncLabel = connection.LastSyncSuccessAt
    ? formatSyncDate(connection.LastSyncSuccessAt)
    : '';

  const handleRescan = async () => {
    setBusy('rescan');
    try {
      await startScan(connection.Id);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleReconnect = async () => {
    if (!platform.connect) return;
    setBusy('reconnect');
    try {
      const result = await connect(platform.key as ConnectablePlatform);
      if (result.success) {
        await refresh();
        onClose();
      } else if (!result.cancelled) {
        Alert.alert('Reconnect failed', result.errorMessage || 'Please try again.');
      }
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = () => {
    Alert.alert('Remove connection', `Disconnect "${accountName}"? Your products stay in Anorha.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          setBusy('disconnect');
          try {
            const token = await ensureSupabaseJwt();
            const response = await fetch(
              `${API_BASE_URL}/api/platform-connections/${connection.Id}/disconnect`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ cleanupStrategy: 'keep' }),
              },
            );
            if (!response.ok) throw new Error(await response.text());
            await refresh();
            onClose();
          } catch {
            Alert.alert('Error', 'Failed to disconnect. Please try again.');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const action = (
    label: string,
    icon: string,
    onPress: () => void,
    options: { destructive?: boolean; loading?: boolean } = {},
  ) => (
    <TouchableOpacity
      style={styles.actionRow}
      onPress={onPress}
      activeOpacity={0.75}
      disabled={busy !== null}
    >
      <View style={[styles.actionIcon, options.destructive && styles.actionIconDanger]}>
        {options.loading ? (
          <ActivityIndicator size="small" color={options.destructive ? RED : '#43631A'} />
        ) : (
          <Icon name={icon} size={20} color={options.destructive ? RED : '#43631A'} />
        )}
      </View>
      <Text style={[styles.actionText, options.destructive && styles.actionTextDanger]}>{label}</Text>
      <Icon name="chevron-right" size={20} color="#C4C8CE" />
    </TouchableOpacity>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={busy === null ? onClose : undefined}
      position="bottom"
      showCloseButton={false}
      containerStyle={styles.sheet}
    >
      <View style={styles.handle} />

      <View style={styles.header}>
        <View style={styles.logoWrap}>
          <PlatformLogo type={platform.key} size={28} fallbackIcon="store" />
        </View>
        <View style={styles.identity}>
          <Text style={styles.platformName}>{platform.label}</Text>
          <Text style={styles.accountName} numberOfLines={1}>{accountName}</Text>
        </View>
        <TouchableOpacity
          style={styles.closeCircle}
          onPress={onClose}
          disabled={busy !== null}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="close" size={18} color={TEXT_SECONDARY} />
        </TouchableOpacity>
      </View>

      <View style={styles.stateRow}>
        <View style={[styles.statusPill, { backgroundColor: `${status.color}14` }]}>
          <Icon name={status.icon} size={16} color={status.color} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
        {syncLabel ? <Text style={styles.lastSync}>Last synced {syncLabel}</Text> : null}
      </View>

      <View style={styles.actions}>
        {canReview ? action('Review items', 'clipboard-text-outline', () => onReview(connection)) : null}
        {action('Rescan', 'refresh', handleRescan, { loading: busy === 'rescan' })}
        {platform.connect
          ? action('Reconnect', 'link-variant', handleReconnect, { loading: busy === 'reconnect' })
          : null}
        {action('Sync rules', 'tune-variant', () => onSyncRules(connection))}
        {action('Disconnect', 'link-variant-off', handleDisconnect, {
          destructive: true,
          loading: busy === 'disconnect',
        })}
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingTop: 12,
    paddingBottom: 28,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'stretch',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  logoWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F6F7F4',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: { flex: 1 },
  platformName: { fontSize: 17, fontWeight: '700', color: '#18181B', letterSpacing: -0.2 },
  accountName: { color: TEXT_SECONDARY, fontSize: 13, fontWeight: '500', marginTop: 2 },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F4F4F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: { fontSize: 12, fontWeight: '700' },
  lastSync: { color: TEXT_SECONDARY, fontSize: 12.5, fontWeight: '500', flexShrink: 1 },
  actions: {
    borderWidth: 1,
    borderColor: '#ECEBE6',
    borderRadius: 18,
    overflow: 'hidden',
  },
  actionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECEBE6',
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F1F6E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconDanger: { backgroundColor: '#FEF2F2' },
  actionText: { flex: 1, color: '#18181B', fontSize: 15, fontWeight: '600' },
  actionTextDanger: { color: RED },
});
