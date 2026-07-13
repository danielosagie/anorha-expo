import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { AppStackParamList } from '../navigation/AppNavigator';
import { useImportHub, HubConnection } from '../hooks/useImportHub';
import {
  IC,
  InboxHeader,
  HeroNumeral,
  SuccessBlock,
  PillButton,
  NumberedCard,
  SectionCaption,
  AccountRow,
} from '../components/importinbox/InboxKit';
import SyncPreferencesSheet from '../components/importinbox/SyncPreferencesSheet';

type RouteType = RouteProp<AppStackParamList, 'ImportHub'>;
type NavType = StackNavigationProp<AppStackParamList, 'ImportHub'>;

type LaneKey = 'matches' | 'photos' | 'details';

// Import Inbox hub — the single wrapper around importing (docs/import-hub-redesign.md).
// Modeled on an email backlog: one total, grouped lanes, in-flight progress. You
// visit it when you want; nothing drags you in. Re-skinned to the Avec look — a
// giant thin count that COUNTS UP on arrival, calm numbered step-cards, and a
// "Your stores" account list (see InboxKit). It goes straight to the working
// lanes — no one-time explainer pass; the structure speaks for itself.
export default function ImportHubScreen() {
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavType>();
  const insets = useSafeAreaInsets();
  const completedLane = route.params?.completedLane;

  const { loading, error, refresh, totalNeedsYou, scanning, lanes, connections } = useImportHub();

  const [refreshing, setRefreshing] = useState(false);

  // Store-preferences bottom sheet — the essentials-only tune for one connection,
  // opened from a "Your stores" row (tap on a synced row, long-press on any row).
  // Data is RETAINED across close (matching CompareSheet's always-mounted +
  // visible-toggle convention) so the slide-out animation still has content; a
  // separate `prefsVisible` flag drives open/close.
  const [prefsConn, setPrefsConn] = useState<{
    connectionId: string;
    platformName: string;
    platformType?: string;
    needsAttention: number;
  } | null>(null);
  const [prefsVisible, setPrefsVisible] = useState(false);

  // CSVColumnMappingScreen finishes with navigation.replace('ImportHub',
  // { connectionId }). The per-connection match sub-rows are gone (the "Your
  // stores" list below supersedes them), so instead of auto-expanding we HIGHLIGHT
  // that connection's store row so the just-imported store is easy to spot.
  const handoffConnectionId = route.params?.connectionId;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // refresh() now resolves only once both data sources have settled — hold
      // the spinner until then instead of a fixed timeout.
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // A total match-status outage shouldn't hide the optimizer lanes — their counts
  // load independently. In that case run degraded: hero + lanes stay, matches goes quiet.
  const degraded = !!error && lanes.photos.count + lanes.details.count > 0;
  const hardError = !!error && !degraded;

  const allClear = !loading && !error && totalNeedsYou === 0;

  // Straight to the working lanes whenever we're not loading or hard-errored.
  const showLanes = !loading && !hardError;

  // Guided-pass order: the first non-empty lane is the "active" (highlighted)
  // step; the rest stay tappable but calm. On return from a completed lane, that
  // lane is now empty so the next one naturally becomes the highlight.
  const firstNonEmpty: LaneKey | null = useMemo(() => {
    if (lanes.matches.count > 0) return 'matches';
    if (lanes.photos.count > 0) return 'photos';
    if (lanes.details.count > 0) return 'details';
    return null;
  }, [lanes]);

  const laneState = useCallback(
    (key: LaneKey, count: number): 'active' | 'locked' | 'done' => {
      if (count === 0) return 'done';
      return key === firstNonEmpty ? 'active' : 'locked';
    },
    [firstNonEmpty],
  );

  const openMatches = useCallback(
    (connectionId: string, platformName: string) => {
      navigation.navigate('SyncInbox', { connectionId, platformName });
    },
    [navigation],
  );

  // Matches card tap: no more expand. With "Your stores" carrying per-connection
  // access, a card with >1 connection just dives into the MOST-NEEDY one's deck.
  const onMatchesPress = useCallback(() => {
    const byConn = lanes.matches.byConnection;
    if (!byConn.length) return;
    const target = byConn.reduce((a, b) => (b.count > a.count ? b : a), byConn[0]);
    openMatches(target.connectionId, target.platformName);
  }, [lanes.matches.byConnection, openMatches]);

  const openPhotos = useCallback(() => {
    navigation.navigate('BackfillOptimizer', { source: 'hub-photos' });
  }, [navigation]);

  const openDetails = useCallback(() => {
    navigation.navigate('BackfillOptimizer', { source: 'hub-details' });
  }, [navigation]);

  // Open the essentials preferences sheet for a store (its logo/name/attention
  // come straight off the hub row — no extra fetch here; the sheet loads the rules).
  const openStorePrefs = useCallback((conn: HubConnection) => {
    setPrefsConn({
      connectionId: conn.connectionId,
      platformName: conn.platformName || conn.platformType || '',
      platformType: conn.platformType,
      needsAttention: conn.needsAttention,
    });
    setPrefsVisible(true);
  }, []);

  // "Your stores" row TAP:
  //   • attention row (needsAttention > 0) → straight into the review deck, as before.
  //   • synced row (needsAttention === 0) → the preferences sheet (was: push SyncRules).
  // Every row also responds to a LONG-PRESS → the preferences sheet (the secondary
  // path for attention rows, whose tap is reserved for the deck). Long-press is used
  // over a trailing gear so nothing shrinks the tap target or misfires against the
  // count/chevron. Both paths prefer the friendly display name over the raw slug.
  const openStore = useCallback(
    (conn: HubConnection) => {
      if (conn.needsAttention > 0) {
        const platformName = conn.platformName || conn.platformType || '';
        navigation.navigate('SyncInbox', { connectionId: conn.connectionId, platformName });
        return;
      }
      openStorePrefs(conn);
    },
    [navigation, openStorePrefs],
  );

  // Sheet → "N need you" row: close, then dive into this connection's deck.
  const openPrefsInbox = useCallback(() => {
    const c = prefsConn;
    setPrefsVisible(false);
    if (c) navigation.navigate('SyncInbox', { connectionId: c.connectionId, platformName: c.platformName });
  }, [prefsConn, navigation]);

  // Sheet → "All settings": close, then open the full SyncRules management screen.
  // SyncRules only types { connectionId }; the extra platformName rides along via a
  // variable so it doesn't trip the excess-property check (SyncRulesScreen reads it).
  const openPrefsAllSettings = useCallback(() => {
    const c = prefsConn;
    setPrefsVisible(false);
    if (!c) return;
    const params = { connectionId: c.connectionId, platformName: c.platformName };
    navigation.navigate('SyncRules', params);
  }, [prefsConn, navigation]);

  // Continue → dive into the first non-empty lane (matches → photos → details).
  const onContinue = useCallback(() => {
    if (lanes.matches.count > 0) {
      const first = lanes.matches.byConnection[0];
      if (first) openMatches(first.connectionId, first.platformName);
      return;
    }
    if (lanes.photos.count > 0) return openPhotos();
    if (lanes.details.count > 0) return openDetails();
  }, [lanes, openMatches, openPhotos, openDetails]);

  const matchesSub = useMemo(() => {
    if (lanes.matches.count === 0) return 'Nothing to review';
    const names = lanes.matches.byConnection.map((b) => b.platformName).filter(Boolean);
    if (names.length === 0) return 'Items to link or add';
    return names.join(' · ');
  }, [lanes.matches]);

  // A quiet closure beat when returning from a just-finished lane. The refresh
  // (on focus) and the next-lane highlight (firstNonEmpty → 'active') are handled
  // generically below; this only acknowledges what was cleared.
  const completedLabel =
    completedLane === 'matches' ? 'Matches' : completedLane === 'photos' ? 'Photos' : completedLane === 'details' ? 'Details' : null;

  const scanNames = useMemo(() => {
    const names = Array.from(new Set(scanning.map((s) => s.platformName).filter(Boolean)));
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }, [scanning]);

  // Matches lane derived state (kept out of JSX so the degraded/done/active
  // branches read clearly). Degraded ⇒ the inbox failed to load, so the lane
  // isn't actually cleared: not done, calm "couldn't load" copy, and the card
  // itself becomes the retry affordance (no boxed banner).
  const matchesLaneState = degraded ? 'locked' : laneState('matches', lanes.matches.count);
  const photosLaneState = laneState('photos', lanes.photos.count);
  const detailsLaneState = laneState('details', lanes.details.count);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <InboxHeader title="Import inbox" onBack={() => navigation.goBack()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={IC.accent} colors={[IC.accent]} />}
      >
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        {loading ? (
          <View style={styles.heroLoading}>
            <ActivityIndicator size="large" color={IC.accent} />
          </View>
        ) : hardError ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>Couldn’t load your inbox</Text>
            <Text style={styles.errorSub}>{error}</Text>
            <PillButton label="Retry" variant="secondary" onPress={refresh} style={styles.errorRetry} />
          </View>
        ) : allClear ? (
          <View style={styles.heroPad}>
            <SuccessBlock
              title="All caught up"
              lines={['New items from your stores show up here as they import.']}
            />
          </View>
        ) : (
          <HeroNumeral value={totalNeedsYou} label={`item${totalNeedsYou === 1 ? '' : 's'} need you`} animate />
        )}

        {/* ── "Cleared" acknowledgment on return from a completed lane ──────── */}
        {completedLabel && !loading && !error && (
          <View style={styles.inlineNote}>
            <MaterialCommunityIcons name="check" size={15} color={IC.accent} />
            <Text style={styles.inlineNoteText}>{completedLabel} cleared</Text>
          </View>
        )}

        {/* ── In-flight line (non-blocking, no banner box) ──────────────────── */}
        {scanning.length > 0 && (
          <View style={styles.inflight}>
            <ActivityIndicator size="small" color={IC.muted} />
            <Text style={styles.inflightText} numberOfLines={2}>
              {scanNames ? `Importing from ${scanNames}… items land here as they arrive` : 'Importing… items land here as they arrive'}
            </Text>
          </View>
        )}

        {/* ── Lanes → Avec numbered step-cards ──────────────────────────────── */}
        {showLanes && (
          <View style={styles.lanes}>
            <NumberedCard
              index={1}
              title="Review matches"
              done={matchesLaneState === 'done'}
              active={matchesLaneState === 'active'}
              sub={
                matchesLaneState === 'done'
                  ? 'Done'
                  : degraded
                    ? 'Couldn’t load right now'
                    : matchesSub
              }
              count={degraded ? undefined : lanes.matches.count}
              onPress={
                degraded
                  ? refresh
                  : lanes.matches.count > 0
                    ? onMatchesPress
                    : undefined
              }
            />

            <NumberedCard
              index={2}
              title="Add photos"
              done={photosLaneState === 'done'}
              active={photosLaneState === 'active'}
              sub={photosLaneState === 'done' ? 'Done' : 'Items missing photos'}
              count={lanes.photos.count}
              onPress={lanes.photos.count > 0 ? openPhotos : undefined}
            />

            <NumberedCard
              index={3}
              title="Fix details"
              done={detailsLaneState === 'done'}
              active={detailsLaneState === 'active'}
              sub={detailsLaneState === 'done' ? 'Done' : 'Titles, descriptions, SKUs'}
              count={lanes.details.count}
              onPress={lanes.details.count > 0 ? openDetails : undefined}
            />
          </View>
        )}

        {/* ── Your stores — the Avec account list (per-connection) ──────────── */}
        {showLanes && connections.length > 0 && (
          <View style={styles.stores}>
            <SectionCaption>Your stores</SectionCaption>
            {connections.map((conn) => (
              <AccountRow
                key={conn.connectionId}
                logoType={conn.platformType || conn.platformName}
                name={conn.platformName}
                detail={conn.platformType}
                count={conn.needsAttention}
                rightLabel={conn.needsAttention > 0 ? undefined : 'Synced'}
                highlighted={!!handoffConnectionId && conn.connectionId === handoffConnectionId}
                onPress={() => openStore(conn)}
                onLongPress={() => openStorePrefs(conn)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Pinned CTA ──────────────────────────────────────────────────────── */}
      {!loading && (
        <>
          <LinearGradient colors={['rgba(255,255,255,0)', '#FFFFFF']} style={styles.fade} pointerEvents="none" />
          <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
            {allClear || hardError || !firstNonEmpty ? (
              <PillButton label="Done" onPress={() => navigation.goBack()} />
            ) : (
              <PillButton label="Continue" onPress={onContinue} />
            )}
          </View>
        </>
      )}

      {/* Store preferences — essentials-only bottom sheet (synced-row tap /
          any-row long-press). Full management stays on SyncRules via "All settings". */}
      {prefsConn && (
        <SyncPreferencesSheet
          visible={prefsVisible}
          onClose={() => setPrefsVisible(false)}
          connectionId={prefsConn.connectionId}
          platformName={prefsConn.platformName}
          platformType={prefsConn.platformType}
          needsAttention={prefsConn.needsAttention}
          onOpenInbox={openPrefsInbox}
          onOpenAllSettings={openPrefsAllSettings}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: IC.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 150 },

  // Hero
  heroLoading: { alignItems: 'center', justifyContent: 'center', paddingVertical: 72 },
  heroPad: { paddingTop: 36, paddingBottom: 24 },

  // Hard error — calm, no icon tile
  errorBlock: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 8 },
  errorTitle: { fontSize: 22, fontWeight: '700', color: IC.ink, letterSpacing: -0.5, textAlign: 'center' },
  errorSub: { fontSize: 15, color: IC.muted, textAlign: 'center', lineHeight: 21, marginTop: 10 },
  errorRetry: { alignSelf: 'stretch', marginTop: 22, marginHorizontal: 16 },

  // Inline note (cleared acknowledgment)
  inlineNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14 },
  inlineNoteText: { fontSize: 14, color: IC.muted },

  // In-flight line
  inflight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 18 },
  inflightText: { flexShrink: 1, fontSize: 14, color: IC.muted, textAlign: 'center', lineHeight: 20 },

  // Lanes
  lanes: { marginTop: 4 },

  // Your stores
  stores: { marginTop: 22 },

  // Footer
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 130 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20 },
});
