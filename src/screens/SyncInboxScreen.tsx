import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useResolution } from '../hooks/useResolution';
import ErrorModal from '../components/ErrorModal';
import MatchReviewDeck from '../components/import/MatchReviewDeck';
import type { SyncItem } from '../types/syncItem';

type RouteType = RouteProp<AppStackParamList, 'SyncInbox'>;
type NavType = StackNavigationProp<AppStackParamList, 'SyncInbox'>;

// The async inbox (SYNC_REBUILD stage 3). Renders the connection's
// `needsAttention` items as a dismissible list — Link / New / Ignore per card.
// It NEVER blocks: sync already started on connect; this only resolves the rare
// ambiguous item. The certain buckets (auto-linked/created) are shown for
// reassurance.
const SyncInboxScreen: React.FC = () => {
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavType>();
  const insets = useSafeAreaInsets();
  const { connectionId, platformName } = route.params;
  const { result, loading, error, resolving, refresh, resolve } = useResolution(connectionId);

  // A failed resolve rolls the row back (the hook refreshes), but the user still
  // needs to know their tap didn't stick — same ErrorModal pattern as the other
  // save paths (GenerateDetails / ProductDetail), never a native Alert.
  const [resolveErrorVisible, setResolveErrorVisible] = useState(false);

  // A failed resolve refreshes+rolls back in the hook; surface it to the user
  // too. Swallow the rejection (return null) so the deck's fire-and-forget
  // commit doesn't produce an unhandled rejection.
  const resolveSafe = useCallback(
    (platformId: string, choice: SyncItem['resolution']['kind'], canonicalId?: string) =>
      resolve(platformId, choice, canonicalId).catch(() => {
        setResolveErrorVisible(true);
        return null;
      }),
    [resolve],
  );

  const needsAttention = result?.needsAttention ?? [];
  const summary = result?.summary;

  // When there are items to review, the deck owns the whole screen — it brings
  // its own top bar (back · progress · N left) and swipe stack. The plain
  // header only shows for the loading / error / all-set states.
  const showDeck = !!result && !(error && !result) && needsAttention.length > 0;

  return (
    <View style={styles.container}>
      {showDeck ? (
        <MatchReviewDeck
          items={needsAttention}
          platformName={platformName}
          resolve={resolveSafe}
          resolving={resolving}
          topInset={insets.top}
          onDone={() => navigation.goBack()}
        />
      ) : (
        <>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Icon name="chevron-left" size={26} color="#111827" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>{platformName || 'Sync'} inbox</Text>
              {summary && (
                <Text style={styles.headerSub}>
                  {summary.autoLinked} linked · {summary.autoCreated} new
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
          ) : (
            // total === 0 → the scan hasn't produced anything yet (still polling):
            // claim nothing. Otherwise every item is decided → "All set".
            <View style={styles.center}>
              {(summary?.total ?? 0) === 0 ? (
                <>
                  <ActivityIndicator />
                  <Text style={styles.emptyText}>Syncing…</Text>
                </>
              ) : (
                <>
                  <Icon name="check-circle-outline" size={40} color="#16a34a" />
                  <Text style={styles.emptyText}>All set</Text>
                </>
              )}
            </View>
          )}
        </>
      )}

      <ErrorModal
        visible={resolveErrorVisible}
        type="error"
        title="Couldn’t save"
        message="Try again."
        onClose={() => setResolveErrorVisible(false)}
      />
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
});

export default SyncInboxScreen;
