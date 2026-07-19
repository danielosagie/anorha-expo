import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useResolution } from '../hooks/useResolution';
import ErrorModal from '../components/ErrorModal';
import MatchReviewDeck from '../components/import/MatchReviewDeck';
import { RC } from '../components/resolve/ResolveKit';
import { IC, InboxHeader, GroupRow, PillButton } from '../components/importinbox/InboxKit';
import { groupItems, itemsForGroup, reasonKeyOf, REASON_LABELS, type GroupKey } from '../components/import/attentionGroups';
import type { SyncItem } from '../types/syncItem';

type RouteType = RouteProp<AppStackParamList, 'SyncInbox'>;
type NavType = StackNavigationProp<AppStackParamList, 'SyncInbox'>;

// One deck run: a filtered group (`groupKey`) or the whole queue (`groupKey:null`).
// `items` is snapshotted at entry so the deck's input can't shift under it, and
// `runId` forces a fresh MatchReviewDeck mount (→ fresh snapshot) per run.
type DeckView = { mode: 'deck'; groupKey: GroupKey | null; runId: number; items: SyncItem[] };
type InboxView = { mode: 'groups' } | DeckView;

type SessionCounts = { linked: number; created: number; ignored: number };

// The async inbox (SYNC_REBUILD stage 3). Two surfaces feed off the resolver's
// `needsAttention`:
//   • GROUPS VIEW (Avec "review the rest") — the default when there's work: an
//     emphasized "All items" row over one soft-card row per attention reason.
//   • the MatchReviewDeck (the loved swipe stack) — entered from a group row
//     ("just this bucket") or "Review all" ("everything in order").
// It NEVER blocks: sync already started on connect; this only resolves the rare
// ambiguous item.
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

  // The session's CONFIRMED-resolve tally and the source of truth for the
  // completion arc. Keyed by platformId (not a running counter) so an undo +
  // re-decide OVERWRITES the item's outcome instead of double-counting, and so
  // it spans every deck run this session. resolveSafe records here ONLY when the
  // resolve actually settled server-side — a caught failure rolls the row back
  // and is deliberately never recorded, so the summary can't overstate what
  // persisted. (The deck's own optimistic tally counts a card the instant it's
  // swiped, before the server answers; we no longer trust it for the summary.)
  const confirmedRef = useRef<Record<string, SyncItem['resolution']['kind']>>({});
  const resolveAttemptRef = useRef<Record<string, number>>({});

  // A failed resolve refreshes+rolls back in the hook; surface it to the user
  // too, and DON'T record it. Reaching the
  // line after `await resolve(...)` means the hook did NOT throw: the item is
  // settled and the row was removed. The caught-failure branch is excluded.
  const resolveSafe = useCallback(
    async (platformId: string, choice: SyncItem['resolution']['kind'], canonicalId?: string) => {
      const attempt = (resolveAttemptRef.current[platformId] ?? 0) + 1;
      resolveAttemptRef.current[platformId] = attempt;
      try {
        const res = await resolve(platformId, choice, canonicalId);
        if (resolveAttemptRef.current[platformId] === attempt) confirmedRef.current[platformId] = choice;
        return res;
      } catch (error) {
        if (resolveAttemptRef.current[platformId] === attempt) {
          delete confirmedRef.current[platformId];
          setResolveErrorVisible(true);
        }
        throw error;
      }
    },
    [resolve],
  );

  const needsAttention = result?.needsAttention ?? [];
  const summary = result?.summary;
  const groups = useMemo(() => groupItems(needsAttention), [needsAttention]);

  // View-state machine. Starts on the groups list; the deck is only ever entered
  // by an explicit tap. Because `mode:'deck'` is sticky until onDeckDone fires,
  // it IS the old mount-latch: the deck stays mounted through the resolver
  // optimistically emptying `needsAttention` on the last card, so its completion
  // beat ("All caught up" → Done) is always reached. Exit is always via
  // onDeckDone (never an unmount from the queue draining).
  const [view, setView] = useState<InboxView>({ mode: 'groups' });
  // A quiet "{group} cleared" closure beat, shown on the groups list after a
  // filtered run finishes while other groups still have work (hub's pattern).
  const [clearedNote, setClearedNote] = useState<string | null>(null);
  const runIdRef = useRef(0);

  const enterDeck = useCallback(
    (groupKey: GroupKey | null) => {
      const items = groupKey === null ? needsAttention.slice() : itemsForGroup(needsAttention, groupKey);
      if (items.length === 0) return;
      runIdRef.current += 1;
      setClearedNote(null);
      setView({ mode: 'deck', groupKey, runId: runIdRef.current, items });
    },
    [needsAttention],
  );

  // The real ending: the import variant of PublishConfirmation with the whole
  // session tally + the auto-pilot totals. Replaces (not pushes) so Back can't
  // re-enter the just-cleared deck.
  //
  // NOTE: `origin`/`importCounts`/`connectionId`/`platformName` aren't in the
  // typed PublishConfirmation params — the screen reads them via `route.params`
  // (untyped), the same way BackfillOptimizer already passes `origin:'import'`.
  // Contract documented in docs/import-hub-handoff.md; no AppNavigator edit.
  const goToCompletion = useCallback(() => {
    // Derive the tally from the CONFIRMED map (settled resolves only), so a
    // failed resolve that rolled back never inflates the summary.
    const c: SessionCounts = { linked: 0, created: 0, ignored: 0 };
    for (const choice of Object.values(confirmedRef.current)) {
      if (choice === 'link') c.linked += 1;
      else if (choice === 'create') c.created += 1;
      else if (choice === 'ignore') c.ignored += 1;
    }
    navigation.replace('PublishConfirmation' as any, {
      origin: 'import',
      connectionId,
      platformName,
      platforms: platformName ? [platformName] : [],
      importCounts: {
        linked: c.linked,
        created: c.created,
        ignored: c.ignored,
        autoLinked: summary?.autoLinked ?? 0,
        autoCreated: summary?.autoCreated ?? 0,
      },
    });
  }, [navigation, connectionId, platformName, summary]);

  // The deck hands control back here. No counts → the user backed out via the
  // deck's top arrow. Counts → a real completion of that run.
  const onDeckDone = useCallback(
    (counts?: SessionCounts) => {
      if (view.mode !== 'deck') return;
      const groupKey = view.groupKey;

      // Backed out (no counts).
      if (!counts) {
        if (groupKey === null) {
          // The all-items run behaves exactly like today's full deck: leave.
          navigation.goBack();
        } else {
          // A filtered run's back arrow returns to the groups list, not goBack.
          setView({ mode: 'groups' });
        }
        return;
      }

      // A real completion. `counts` (the deck's optimistic tally) still marks a
      // completion vs a back-out, but it is NO LONGER folded into the session
      // total: those numbers count a card the instant it's swiped, even if the
      // resolve later failed and rolled back. The completion arc reads the
      // confirmed map (populated by resolveSafe) instead — see goToCompletion.

      // Is there other work left? The all-items run always ends the arc. For a
      // filtered run, "remaining" is everything NOT in the group we just cleared
      // — matched by key, so any of that group's rows still lingering behind an
      // in-flight optimistic removal don't get miscounted as remaining work.
      const remaining =
        groupKey === null ? [] : needsAttention.filter((it) => reasonKeyOf(it) !== groupKey);

      if (remaining.length === 0) {
        // Last remaining work → the existing completion arc, with the whole
        // session's counts (all groups + all-items runs combined).
        goToCompletion();
      } else {
        // More groups to go → back to the list with a quiet closure beat.
        setClearedNote(groupKey ? REASON_LABELS[groupKey] : null);
        setView({ mode: 'groups' });
      }
    },
    [view, needsAttention, navigation, goToCompletion],
  );

  const total = needsAttention.length;

  return (
    <View style={styles.container}>
      {view.mode === 'deck' ? (
        // The deck owns the screen for the length of one run (filtered or all).
        <MatchReviewDeck
          key={`deck-${view.runId}`}
          items={view.items}
          platformName={platformName}
          resolve={resolveSafe}
          resolving={resolving}
          topInset={insets.top}
          onDone={onDeckDone}
        />
      ) : total > 0 ? (
        // ── GROUPS VIEW — Avec "review the rest" (light mode, IC tokens) ───────
        <View style={[styles.groupsScreen, { paddingTop: insets.top + 4 }]}>
          <InboxHeader title="Review matches" onBack={() => navigation.goBack()} />
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.groupsScroll}
            showsVerticalScrollIndicator={false}
          >
            {!!platformName && <Text style={styles.groupsPlatform}>{platformName}</Text>}

            {!!clearedNote && (
              <View style={styles.inlineNote}>
                <MaterialCommunityIcons name="check" size={15} color={IC.accent} />
                <Text style={styles.inlineNoteText}>{clearedNote} cleared</Text>
              </View>
            )}

            {/* Avec's 'overall' — the emphasized all-items row */}
            <GroupRow
              label="All items"
              count={total}
              onPress={() => enterDeck(null)}
              style={styles.allRow}
            />

            <View style={styles.groupsList}>
              {groups.map((g) => (
                <GroupRow key={g.key} label={g.label} count={g.items.length} onPress={() => enterDeck(g.key)} />
              ))}
            </View>
          </ScrollView>

          <View style={[styles.groupsFooter, { paddingBottom: insets.bottom + 18 }]}>
            <PillButton label={`Review all ${total}`} onPress={() => enterDeck(null)} />
          </View>
        </View>
      ) : (
        // ── loading / error / syncing / all-caught-up (unchanged) ─────────────
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
            <View style={styles.center}>
              {(summary?.total ?? 0) === 0 ? (
                <>
                  <Text style={styles.emptyTitle}>Nothing needs review</Text>
                  <Text style={styles.emptyText}>Import progress stays in the Import inbox.</Text>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('ImportHub')}
                    style={styles.inboxBtn}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.inboxBtnText}>Open Import inbox</Text>
                  </TouchableOpacity>
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

  // Groups view (Avec / IC tokens)
  groupsScreen: { flex: 1, backgroundColor: IC.bg },
  groupsScroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 140 },
  groupsPlatform: { fontSize: 13, color: IC.muted, textAlign: 'center', marginBottom: 18 },
  inlineNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14 },
  inlineNoteText: { fontSize: 14, color: IC.muted },
  allRow: { backgroundColor: IC.cardActive, borderWidth: 1, borderColor: IC.accent, marginBottom: 16 },
  groupsList: {},
  groupsFooter: { paddingHorizontal: 20, paddingTop: 10, backgroundColor: IC.bg },

  // Loading / error / empty states (legacy RC chrome)
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
