import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useResolution } from '../hooks/useResolution';
import ErrorModal from '../components/ErrorModal';
import MatchReviewDeck from '../components/import/MatchReviewDeck';
import { RC } from '../components/resolve/ResolveKit';
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

  // Deck done → a real ending: the import variant of PublishConfirmation with the
  // session tally + the auto-pilot totals, from where the user continues to
  // photos/details or lands back in the inbox. Replaces (not pushes) so Back
  // can't re-enter the just-cleared deck.
  //
  // NOTE: `origin`/`importCounts`/`connectionId`/`platformName` aren't in the
  // typed PublishConfirmation params — the screen reads them via `route.params`
  // (untyped), the same way BackfillOptimizer already passes `origin:'import'`.
  // Contract documented in docs/import-hub-handoff.md; no AppNavigator edit.
  const onDeckDone = useCallback(
    (counts?: { linked: number; created: number; ignored: number }) => {
      // No counts → the user backed out via the deck's top arrow: just return to
      // where they came from (the hub). Only a real completion (counts present)
      // advances to the summary.
      if (!counts) {
        navigation.goBack();
        return;
      }
      navigation.replace('PublishConfirmation' as any, {
        origin: 'import',
        connectionId,
        platformName,
        platforms: platformName ? [platformName] : [],
        importCounts: {
          linked: counts?.linked ?? 0,
          created: counts?.created ?? 0,
          ignored: counts?.ignored ?? 0,
          autoLinked: summary?.autoLinked ?? 0,
          autoCreated: summary?.autoCreated ?? 0,
        },
      });
    },
    [navigation, connectionId, platformName, summary],
  );

  // Keep the deck mounted once it has shown items, so its completion beat ("All
  // caught up" → Done → summary) survives the resolver optimistically emptying
  // needsAttention on the last card. Without this latch the deck unmounts the
  // instant the last resolve confirms and the ending is never reached. Exit is
  // always via navigation (onDeckDone), so nothing keeps it around after.
  const [deckLatched, setDeckLatched] = useState(false);
  useEffect(() => {
    if (needsAttention.length > 0) setDeckLatched(true);
  }, [needsAttention.length]);

  // When there are items to review, the deck owns the whole screen — it brings
  // its own top bar (back · progress · N left) and swipe stack. The plain
  // header only shows for the loading / error / all-caught states.
  const showDeck = (deckLatched || needsAttention.length > 0) && !!result && !(error && !result);

  return (
    <View style={styles.container}>
      {showDeck ? (
        <MatchReviewDeck
          items={needsAttention}
          platformName={platformName}
          resolve={resolveSafe}
          resolving={resolving}
          topInset={insets.top}
          onDone={onDeckDone}
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
              <MaterialCommunityIcons name="chevron-left" size={26} color={RC.ink} />
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
              <ActivityIndicator color={RC.green} />
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
            // claim nothing. Otherwise every item is decided → "All caught up".
            <View style={styles.center}>
              {(summary?.total ?? 0) === 0 ? (
                <>
                  <ActivityIndicator color={RC.green} />
                  <Text style={styles.emptyText}>Syncing…</Text>
                </>
              ) : (
                <>
                  <View style={styles.doneBadge}>
                    <MaterialCommunityIcons name="check" size={30} color="#fff" />
                  </View>
                  <Text style={styles.emptyTitle}>All caught up here</Text>
                  <Text style={styles.emptyText}>Everything from {platformName || 'this store'} is sorted.</Text>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('ImportHub')}
                    style={styles.inboxBtn}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.inboxBtnText}>Open Import inbox</Text>
                  </TouchableOpacity>
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
  container: { flex: 1, backgroundColor: RC.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RC.line,
  },
  backBtn: { padding: 4, marginRight: 4 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: RC.ink },
  headerSub: { fontSize: 12, color: RC.muted, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  doneBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: RC.green, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: RC.ink },
  emptyText: { marginTop: 8, fontSize: 14, color: RC.muted, textAlign: 'center', lineHeight: 20 },
  errorText: { fontSize: 14, color: RC.danger, textAlign: 'center' },
  retryBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: RC.surface2, borderRadius: 8 },
  retryText: { color: RC.ink, fontWeight: '500' },
  inboxBtn: { marginTop: 18, paddingHorizontal: 22, paddingVertical: 12, backgroundColor: RC.green, borderRadius: 12 },
  inboxBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

export default SyncInboxScreen;
