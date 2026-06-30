import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useResolution } from '../hooks/useResolution';
import type { SyncItem, AttentionReason } from '../types/syncItem';

type RouteType = RouteProp<AppStackParamList, 'SyncInbox'>;
type NavType = StackNavigationProp<AppStackParamList, 'SyncInbox'>;

const REASON_LABEL: Record<AttentionReason, string> = {
  multiple_candidates: 'Multiple possible matches',
  weak_match: 'Weak match — confirm',
  look_alike_group: 'Look-alike group',
  duplicate_target: 'Possible duplicate',
  field_conflict: 'Conflicting details',
  bundle: 'Bundle / kit',
  stale_link: 'Link needs reconnecting',
};

// The async inbox (SYNC_REBUILD stage 3). Renders the connection's
// `needsAttention` items as a dismissible list — Link / New / Ignore per card.
// It NEVER blocks: sync already started on connect; this only resolves the rare
// ambiguous item. The certain buckets (auto-linked/created) are shown for
// reassurance.
const SyncInboxScreen: React.FC = () => {
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavType>();
  const { connectionId, platformName } = route.params;
  const { result, loading, error, resolving, refresh, resolve } = useResolution(connectionId);

  const onResolve = useCallback(
    (item: SyncItem, choice: 'link' | 'create' | 'ignore') => {
      let canonicalId: string | undefined;
      if (choice === 'link') {
        const candidates = item.candidates ?? [];
        if (candidates.length === 0) return; // no target to link to
        // `recommended` is a which-candidate hint, not an id.
        canonicalId = (item.recommended === 'secondary' ? candidates[1]?.id : candidates[0]?.id) ?? candidates[0]?.id;
      }
      // Best-effort; the hook handles optimistic removal + rollback on failure.
      resolve(item.platformId, choice, canonicalId).catch(() => {});
    },
    [resolve],
  );

  const renderItem = useCallback(
    ({ item }: { item: SyncItem }) => {
      const hasCandidates = (item.candidates?.length ?? 0) > 0;
      const busy = resolving === item.platformId;
      return (
        <View style={styles.card}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Icon name="package-variant-closed" size={20} color="#9ca3af" />
            </View>
          )}
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title || item.sku || item.platformId}
            </Text>
            <Text style={styles.cardReason} numberOfLines={1}>
              {item.attention ? REASON_LABEL[item.attention] : 'Needs a look'}
            </Text>
          </View>
          <View style={styles.actions}>
            {hasCandidates && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.linkBtn]}
                disabled={busy}
                onPress={() => onResolve(item, 'link')}
              >
                <Icon name="link-variant" size={16} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, styles.newBtn]}
              disabled={busy}
              onPress={() => onResolve(item, 'create')}
            >
              <Icon name="plus" size={16} color="#2563eb" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.ignoreBtn]}
              disabled={busy}
              onPress={() => onResolve(item, 'ignore')}
            >
              <Icon name="close" size={16} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [resolving, onResolve],
  );

  const needsAttention = result?.needsAttention ?? [];
  const summary = result?.summary;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{platformName || 'Sync'} inbox</Text>
          {summary && (
            <Text style={styles.headerSub}>
              {summary.autoLinked} linked · {summary.autoCreated} created automatically
            </Text>
          )}
        </View>
      </View>

      {loading && !result ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : error && !result ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : needsAttention.length === 0 ? (
        <View style={styles.center}>
          <Icon name="check-circle-outline" size={40} color="#16a34a" />
          <Text style={styles.emptyText}>All set — everything is syncing.</Text>
        </View>
      ) : (
        <FlatList
          data={needsAttention}
          keyExtractor={(i) => i.platformId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
          ListHeaderComponent={
            <Text style={styles.listHeader}>{needsAttention.length} need a quick look</Text>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  backBtn: { padding: 4, marginRight: 4 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#111827' },
  headerSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { marginTop: 10, fontSize: 15, color: '#6b7280' },
  errorText: { fontSize: 14, color: '#dc2626', textAlign: 'center' },
  retryBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#f3f4f6', borderRadius: 8 },
  retryText: { color: '#111827', fontWeight: '500' },
  list: { padding: 12 },
  listHeader: { fontSize: 13, color: '#6b7280', marginBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fffbeb', borderColor: '#fde68a', borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 8 },
  thumb: { width: 44, height: 44, borderRadius: 8, marginRight: 10 },
  thumbPlaceholder: { backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  cardReason: { fontSize: 12, color: '#92400e', marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  linkBtn: { backgroundColor: '#2563eb' },
  newBtn: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe' },
  ignoreBtn: { backgroundColor: '#f3f4f6' },
});

export default SyncInboxScreen;
