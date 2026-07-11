import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { AppStackParamList } from '../navigation/AppNavigator';
import { useImportHub } from '../hooks/useImportHub';
import { RC } from '../components/resolve/ResolveKit';
import { LobbyHeader, UpNextRow, IconName } from '../components/quest/LobbyKit';

type RouteType = RouteProp<AppStackParamList, 'ImportHub'>;
type NavType = StackNavigationProp<AppStackParamList, 'ImportHub'>;

type LaneKey = 'matches' | 'photos' | 'details';

// Import Inbox hub — the single wrapper around importing (docs/import-hub-redesign.md).
// Modeled on an email backlog: one total, grouped lanes, in-flight progress. You
// visit it when you want; nothing drags you in.
export default function ImportHubScreen() {
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavType>();
  const insets = useSafeAreaInsets();
  const completedLane = route.params?.completedLane;

  const { loading, error, refresh, totalNeedsYou, scanning, lanes } = useImportHub();

  const [expandedMatches, setExpandedMatches] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh();
    // The hook fires its fetches immediately; drop the spinner after a beat.
    setTimeout(() => setRefreshing(false), 800);
  }, [refresh]);

  const allClear = !loading && !error && totalNeedsYou === 0;

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

  const onMatchesPress = useCallback(() => {
    const byConn = lanes.matches.byConnection;
    if (byConn.length <= 1) {
      const only = byConn[0];
      if (only) openMatches(only.connectionId, only.platformName);
      return;
    }
    // >1 connection with matches → expand into per-connection rows.
    setExpandedMatches((v) => !v);
  }, [lanes.matches.byConnection, openMatches]);

  const openPhotos = useCallback(() => {
    navigation.navigate('BackfillOptimizer', { source: 'hub-photos' });
  }, [navigation]);

  const openDetails = useCallback(() => {
    navigation.navigate('BackfillOptimizer', { source: 'hub-details' });
  }, [navigation]);

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

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <LobbyHeader title="Import inbox" onBack={() => navigation.goBack()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={RC.green} colors={[RC.green]} />}
      >
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        {loading ? (
          <View style={styles.heroLoading}>
            <ActivityIndicator size="large" color={RC.green} />
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <MaterialCommunityIcons name="cloud-off-outline" size={30} color={RC.danger} />
            <Text style={styles.errorTitle}>Couldn’t load your inbox</Text>
            <Text style={styles.errorSub}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} activeOpacity={0.85} onPress={refresh}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : allClear ? (
          <View style={styles.hero}>
            <View style={styles.allClearBadge}>
              <MaterialCommunityIcons name="check" size={34} color="#fff" />
            </View>
            <Text style={styles.allClearTitle}>All caught up</Text>
            <Text style={styles.allClearSub}>
              New items from your stores show up here as they import. Nothing needs you right now.
            </Text>
          </View>
        ) : (
          <View style={styles.hero}>
            <Text style={styles.heroCount}>{totalNeedsYou}</Text>
            <Text style={styles.heroLabel}>item{totalNeedsYou === 1 ? '' : 's'} need you</Text>
          </View>
        )}

        {/* ── "Cleared" acknowledgment on return from a completed lane ──────── */}
        {completedLabel && !loading && !error && (
          <View style={styles.completedNote}>
            <MaterialCommunityIcons name="check-circle" size={15} color={RC.greenDark} />
            <Text style={styles.completedNoteText}>{completedLabel} cleared</Text>
          </View>
        )}

        {/* ── In-flight strip (non-blocking) ────────────────────────────────── */}
        {scanning.length > 0 && (
          <View style={styles.inflight}>
            <ActivityIndicator size="small" color={RC.greenDark} />
            <Text style={styles.inflightText} numberOfLines={2}>
              Importing from {scanNames}… items will land here
            </Text>
          </View>
        )}

        {/* ── Lanes ─────────────────────────────────────────────────────────── */}
        {!loading && !error && (
          <View style={styles.lanes}>
            <UpNextRow
              icon={'link-variant' as IconName}
              title="Review matches"
              sub={matchesSub}
              count={lanes.matches.count}
              state={laneState('matches', lanes.matches.count)}
              onPress={lanes.matches.count > 0 ? onMatchesPress : undefined}
            />
            {expandedMatches && lanes.matches.byConnection.length > 1 && (
              <View style={styles.subLanes}>
                {lanes.matches.byConnection.map((b) => (
                  <UpNextRow
                    key={b.connectionId}
                    icon={'store-outline' as IconName}
                    title={b.platformName}
                    count={b.count}
                    state="active"
                    onPress={() => openMatches(b.connectionId, b.platformName)}
                  />
                ))}
              </View>
            )}

            <UpNextRow
              icon={'camera' as IconName}
              title="Add photos"
              sub={lanes.photos.count > 0 ? 'Items missing photos' : 'Every item has photos'}
              count={lanes.photos.count}
              state={laneState('photos', lanes.photos.count)}
              onPress={lanes.photos.count > 0 ? openPhotos : undefined}
            />

            <UpNextRow
              icon={'star-four-points' as IconName}
              title="Fix details"
              sub={lanes.details.count > 0 ? 'Titles, descriptions, SKUs' : 'Every item has details'}
              count={lanes.details.count}
              state={laneState('details', lanes.details.count)}
              onPress={lanes.details.count > 0 ? openDetails : undefined}
            />
          </View>
        )}
      </ScrollView>

      {/* ── Pinned CTA ──────────────────────────────────────────────────────── */}
      {!loading && (
        <>
          <LinearGradient colors={['rgba(255,255,255,0)', '#FFFFFF']} style={styles.fade} pointerEvents="none" />
          <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
            {allClear || error || !firstNonEmpty ? (
              <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.goBack()} style={styles.primaryBtn}>
                <Text style={styles.primaryText}>Done</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity activeOpacity={0.9} onPress={onContinue} style={styles.primaryBtn}>
                <Text style={styles.primaryText}>Continue</Text>
                <MaterialCommunityIcons name="arrow-right" size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RC.bg },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 150 },

  // Hero
  heroLoading: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  hero: { alignItems: 'center', paddingTop: 28, paddingBottom: 28 },
  heroCount: { fontSize: 68, fontWeight: '800', color: RC.ink, letterSpacing: -2, lineHeight: 74 },
  heroLabel: { fontSize: 16, fontWeight: '600', color: RC.muted, marginTop: 2 },

  allClearBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: RC.green, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  allClearTitle: { fontSize: 22, fontWeight: '800', color: RC.ink, letterSpacing: -0.4 },
  allClearSub: { fontSize: 14, fontWeight: '500', color: RC.muted, textAlign: 'center', lineHeight: 20, marginTop: 8, paddingHorizontal: 24 },

  // Error
  errorCard: { alignItems: 'center', paddingTop: 44, paddingHorizontal: 24, gap: 8 },
  errorTitle: { fontSize: 17, fontWeight: '700', color: RC.ink, marginTop: 6 },
  errorSub: { fontSize: 13, fontWeight: '500', color: RC.muted, textAlign: 'center', lineHeight: 18 },
  retryBtn: { marginTop: 12, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12, backgroundColor: RC.surface2 },
  retryText: { fontSize: 14, fontWeight: '700', color: RC.ink },

  // Cleared note
  completedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 12 },
  completedNoteText: { fontSize: 13, fontWeight: '700', color: RC.greenDark },

  // In-flight strip
  inflight: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: RC.greenSoft, borderWidth: 1, borderColor: RC.greenLine, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  inflightText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: RC.greenInk },

  // Lanes
  lanes: { marginTop: 4 },
  subLanes: { paddingLeft: 16, marginTop: -2, marginBottom: 6 },

  // Footer
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 130 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16 },
  primaryBtn: { height: 54, borderRadius: 14, backgroundColor: RC.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
});
