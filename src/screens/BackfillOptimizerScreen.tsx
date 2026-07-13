import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';

import { OptimizerBatchGenerateView } from '../components/optimizer/OptimizerBatchGenerateView';
import { OptimizerPhotoModeView } from '../components/optimizer/OptimizerPhotoModeView';
import OptimizerReviewView from '../components/optimizer/OptimizerReviewView';
import { useOptimizerQueues, ClassifiedProduct } from '../hooks/useOptimizerQueues';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { getPlatform } from '../config/platforms';
import {
  IC,
  InboxHeader,
  HeroNumeral,
  SuccessBlock,
  PillButton,
  NumberedCard,
} from '../components/importinbox/InboxKit';

// Optimize v2 — one lobby of grouped gaps (photos · details · manual), each
// routing to the fix it needs. Photo + details keep the real camera / AI views;
// the manual queue runs the new "Fill the gaps" resolver deck.

type Bucket = 'photo' | 'data' | 'manual';
type ScreenView =
  | { kind: 'lobby' }
  | { kind: 'explainer' }
  | { kind: 'review' }
  | { kind: 'lesson'; q: 'photo' | 'data' }
  | { kind: 'done'; n: number; label: string };

const BUCKET_ORDER: Bucket[] = ['photo', 'data', 'manual'];

const plural = (n: number) => (n === 1 ? '' : 's');

export function BackfillOptimizerScreen() {
  const navigation = useNavigation<StackNavigationProp<any>>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const newlyImportedIds: string[] = Array.isArray(route.params?.newlyImportedIds)
    ? route.params.newlyImportedIds
    : [];
  const newlyImportedSet = useMemo(() => new Set(newlyImportedIds), [newlyImportedIds]);

  // When entered from the import hub, scope the queues to THIS import's connection
  // so the counts here match the hub exactly (same hook, same scope). A standalone
  // entry with no connectionId falls back to the whole catalog.
  const connectionId: string | undefined = route.params?.connectionId || undefined;

  const [view, setView] = useState<ScreenView>({ kind: 'lobby' });
  // Per-task completion so finishing photos never evicts an item that ALSO needs
  // details from the details queue (and vice-versa).
  const [completedPhotoIds, setCompletedPhotoIds] = useState<Set<string>>(new Set());
  const [completedDetailIds, setCompletedDetailIds] = useState<Set<string>>(new Set());

  const { loading, error, products, counts, photoNeededItems, dataNeededItems, manualQueueItems, refresh } =
    useOptimizerQueues({ connectionId });

  const prioritize = useCallback(
    (list: ClassifiedProduct[], done: Set<string>) => {
      const remaining = list.filter((i) => !done.has(i.Id));
      return [...remaining].sort((a, b) => {
        const an = newlyImportedSet.has(a.Id) ? 0 : 1;
        const bn = newlyImportedSet.has(b.Id) ? 0 : 1;
        return an - bn;
      });
    },
    [newlyImportedSet],
  );

  const photoQueue = useMemo(() => prioritize(photoNeededItems, completedPhotoIds), [prioritize, photoNeededItems, completedPhotoIds]);
  const dataQueue = useMemo(() => prioritize(dataNeededItems, completedDetailIds), [prioritize, dataNeededItems, completedDetailIds]);
  const manualQueue = useMemo(() => prioritize(manualQueueItems, completedDetailIds), [prioritize, manualQueueItems, completedDetailIds]);

  const queueFor = (b: Bucket) => (b === 'photo' ? photoQueue : b === 'data' ? dataQueue : manualQueue);
  const remainingFor = (b: Bucket) => queueFor(b).length;

  const polishedCount = Math.max(counts.total - counts.attention, 0);
  const firstBucket = BUCKET_ORDER.find((b) => remainingFor(b) > 0) || null;

  // The product-detail review walks a snapshot of ids but reads the LIVE rows so
  // edits/generation show fresh. Channel pills come from the connected platforms.
  const [reviewIds, setReviewIds] = useState<Set<string>>(new Set());
  const { connections } = usePlatformConnections();
  const platformKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections || []) {
      if (c?.IsEnabled === false) continue;
      const def = getPlatform(c?.PlatformType);
      if (def) set.add(def.key);
    }
    return Array.from(set);
  }, [connections]);
  const reviewProducts = useMemo(() => products.filter((p) => reviewIds.has(p.Id)), [products, reviewIds]);

  const markDone = useCallback(
    (ids: string[], task: 'photo' | 'details') => {
      const setter = task === 'photo' ? setCompletedPhotoIds : setCompletedDetailIds;
      setter((prev) => new Set([...prev, ...ids]));
      refresh();
    },
    [refresh],
  );

  // End of the optimize stage → the shared completion screen (PublishConfirmation,
  // import variant). Same screen the match stage lands on, so the two stages end
  // the same way.
  const finishOptimize = useCallback(() => {
    navigation.navigate('PublishConfirmation' as any, {
      origin: 'import',
      importCount: polishedCount,
      savedToInventory: false,
      // Hub uses this for its "{lane} cleared" note; details is the later bucket.
      completedLane: completedDetailIds.size > 0 ? 'details' : 'photos',
    });
  }, [navigation, polishedCount, completedDetailIds]);

  const enterBucket = (b: Bucket) => {
    if (remainingFor(b) === 0) return;
    if (b === 'photo') {
      setView({ kind: 'lesson', q: 'photo' });
      return;
    }
    // Details (data + manual) → the product-detail review editor.
    setReviewIds(new Set([...dataQueue, ...manualQueue].map((p) => p.Id)));
    setView({ kind: 'review' });
  };

  // Entered from a hub lane (source: 'hub-photos' | 'hub-details') → drop the user
  // straight into that queue once the counts have loaded, skipping the lobby.
  // Fires once; if the target queue is empty we simply stay in the lobby.
  const initialSource: string | undefined = route.params?.source;
  const autoEnteredRef = useRef(false);
  useEffect(() => {
    if (autoEnteredRef.current || loading) return;
    if (initialSource !== 'hub-photos' && initialSource !== 'hub-details') {
      autoEnteredRef.current = true;
      return;
    }
    autoEnteredRef.current = true;
    if (initialSource === 'hub-photos') {
      if (photoQueue.length > 0) setView({ kind: 'lesson', q: 'photo' });
    } else {
      // hub-details → the details (data + manual) review path, same gating as
      // enterBucket.
      const detailIds = [...dataQueue, ...manualQueue].map((p) => p.Id);
      if (detailIds.length > 0) {
        setReviewIds(new Set(detailIds));
        setView({ kind: 'review' });
      }
    }
  }, [loading, initialSource, photoQueue, dataQueue, manualQueue]);

  // ── Photo / Details lessons keep the real camera + AI views ───────────────
  if (view.kind === 'lesson' && view.q === 'photo') {
    return (
      <OptimizerPhotoModeView
        onBack={() => setView({ kind: 'lobby' })}
        onComplete={(ids: string[]) => {
          markDone(ids, 'photo');
          // Photos done → name the next task (the explainer) when details remain,
          // otherwise fall through to the between-flows done beat.
          if (dataQueue.length + manualQueue.length > 0) setView({ kind: 'explainer' });
          else setView({ kind: 'done', n: ids.length, label: 'photos added' });
        }}
        queueProducts={photoQueue}
      />
    );
  }

  // ── Explainer — the task handoff between photos and details ───────────────
  if (view.kind === 'explainer') {
    const n = dataQueue.length + manualQueue.length;
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <InboxHeader onBack={() => setView({ kind: 'lobby' })} />
        <View style={styles.centerBody}>
          <Text style={styles.centerTitle}>Now, the details</Text>
          <Text style={styles.centerCopy}>
            We&rsquo;ll write the title, description and category for {n} item{plural(n)} — for every
            channel. You just review each one.
          </Text>
        </View>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
          <PillButton
            label={`Generate details for ${n}`}
            onPress={() => {
              setReviewIds(new Set([...dataQueue, ...manualQueue].map((p) => p.Id)));
              if (dataQueue.length > 0) setView({ kind: 'lesson', q: 'data' });
              else setView({ kind: 'review' });
            }}
          />
          <TouchableOpacity
            onPress={() => enterBucket(dataQueue.length > 0 ? 'data' : 'manual')}
            style={styles.quietBtn}
            activeOpacity={0.6}
          >
            <Text style={styles.quietText}>I&rsquo;ll write them myself</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Review — product-detail editor with per-channel readiness pills ────────
  if (view.kind === 'review') {
    return (
      <OptimizerReviewView
        products={reviewProducts}
        platforms={platformKeys}
        onBack={() => setView({ kind: 'lobby' })}
        onComplete={(ids) => {
          const done = ids.length ? ids : reviewProducts.map((p) => p.Id);
          markDone(done, 'details');
          setView({ kind: 'done', n: done.length, label: 'details ready' });
        }}
      />
    );
  }

  // AI bulk-generate (existing view), then drop into the review to confirm.
  if (view.kind === 'lesson' && view.q === 'data') {
    return (
      <OptimizerBatchGenerateView
        onBack={() => setView({ kind: 'lobby' })}
        onComplete={(ids: string[]) => {
          markDone(ids, 'details');
          setView({ kind: 'review' });
        }}
        queueProducts={dataQueue}
      />
    );
  }

  // ── Done — between flows ──────────────────────────────────────────────────
  if (view.kind === 'done') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
        <View style={styles.centerBody}>
          <SuccessBlock
            title={`${view.n} ${view.label}`}
            lines={[firstBucket ? 'A little more to polish.' : 'Everything is polished.']}
          />
        </View>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
          <PillButton
            label={firstBucket ? 'Keep going' : 'Finish'}
            onPress={() => (firstBucket ? setView({ kind: 'lobby' }) : finishOptimize())}
          />
        </View>
      </View>
    );
  }

  // ── Lobby · the optimize intro — a calm sibling of the hub ────────────────
  // Direct entry only (the hub deep-links PAST this via source: hub-photos /
  // hub-details). Two numbered cards name the tasks; the pill starts the first
  // open one, or finishes when nothing's left.
  const photosLeft = photoQueue.length;
  const detailsLeft = dataQueue.length + manualQueue.length;
  const startBucket: Bucket | null =
    photosLeft > 0 ? 'photo' : dataQueue.length > 0 ? 'data' : manualQueue.length > 0 ? 'manual' : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <InboxHeader title="Optimize" onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={IC.accent} />
        </View>
      ) : error ? (
        // The count load failed — a zeroed lobby would read as a false "all done".
        // Offer a calm retry instead of a blank/misleading screen.
        <View style={styles.center}>
          <Text style={styles.centerCopy}>Couldn’t check what’s left.</Text>
          <TouchableOpacity onPress={refresh} activeOpacity={0.7} style={{ marginTop: 14 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: IC.accent }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.lobbyContent} showsVerticalScrollIndicator={false}>
          <HeroNumeral
            value={counts.attention}
            label={counts.attention === 1 ? 'item to polish' : 'items to polish'}
          />
          <View style={styles.cardList}>
            <NumberedCard
              index={1}
              title="Photos"
              done={photosLeft === 0}
              active={photosLeft > 0}
              sub={photosLeft > 0 ? `${photosLeft} item${plural(photosLeft)} missing photos` : 'Done'}
              count={photosLeft}
              onPress={photosLeft > 0 ? () => enterBucket('photo') : undefined}
            />
            <NumberedCard
              index={2}
              title="Details"
              done={detailsLeft === 0}
              active={detailsLeft > 0 && photosLeft === 0}
              sub={
                detailsLeft === 0
                  ? 'Done'
                  : photosLeft > 0
                    ? 'Add photos first'
                    : 'Titles, descriptions and SKUs'
              }
              count={detailsLeft}
              onPress={
                detailsLeft > 0
                  ? () => enterBucket(dataQueue.length > 0 ? 'data' : 'manual')
                  : undefined
              }
            />
          </View>
        </ScrollView>
      )}

      <LinearGradient colors={['rgba(255,255,255,0)', IC.bg]} style={styles.fade} pointerEvents="none" />
      <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
        <PillButton
          label={startBucket ? 'Start' : 'Finish'}
          onPress={startBucket ? () => enterBucket(startBucket) : finishOptimize}
        />
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.quietBtn} activeOpacity={0.6}>
          <Text style={styles.quietText}>{startBucket ? 'Later' : 'Back'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: IC.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Lobby body (hero numeral + numbered cards). Bottom padding clears the pinned footer.
  lobbyContent: { paddingHorizontal: 20, paddingBottom: 170 },
  cardList: { marginTop: 4 },

  // Centered editorial beats (explainer handoff + done). Calm copy, no quest cards.
  centerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, gap: 12 },
  centerTitle: { fontSize: 26, fontWeight: '700', color: IC.ink, letterSpacing: -0.6, textAlign: 'center' },
  centerCopy: { fontSize: 16, color: IC.muted, textAlign: 'center', lineHeight: 23 },

  // Pinned footer (full-width pill + quiet muted text button), shared by every beat.
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, gap: 4 },
  quietBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  quietText: { fontSize: 15, fontWeight: '600', color: IC.muted },
});
