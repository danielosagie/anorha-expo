import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { OptimizerBatchGenerateView } from '../components/optimizer/OptimizerBatchGenerateView';
import { OptimizerPhotoModeView } from '../components/optimizer/OptimizerPhotoModeView';
import OptimizerReviewView from '../components/optimizer/OptimizerReviewView';
import { useOptimizerQueues, ClassifiedProduct } from '../hooks/useOptimizerQueues';
import { RC } from '../components/resolve/ResolveKit';
import { OptimizeResolver, OptimizeCase, Decision } from '../components/resolve/optimizeResolvers';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { getPlatform } from '../config/platforms';
import {
  LobbyHeader,
  HeaderPill,
  IconName,
} from '../components/quest/LobbyKit';

// Optimize v2 — one lobby of grouped gaps (photos · details · manual), each
// routing to the fix it needs. Photo + details keep the real camera / AI views;
// the manual queue runs the new "Fill the gaps" resolver deck.

type Bucket = 'photo' | 'data' | 'manual';
type ScreenView =
  | { kind: 'lobby' }
  | { kind: 'explainer' }
  | { kind: 'review' }
  | { kind: 'lesson'; q: 'photo' | 'data' }
  | { kind: 'datachoose' }
  | { kind: 'dataselect' }
  | { kind: 'manual'; i: number }
  | { kind: 'datamanual'; i: number }
  | { kind: 'done'; n: number; label: string };

const BUCKET_ORDER: Bucket[] = ['photo', 'data', 'manual'];

const plural = (n: number) => (n === 1 ? '' : 's');

function firstImage(p: ClassifiedProduct): string | null {
  const imgs = (p.ProductImages as any[]) || [];
  return imgs[0]?.ImageUrl || imgs[0]?.imageUrl || null;
}

function manualCaseFor(p: ClassifiedProduct): OptimizeCase {
  const any = p as any;
  const price = any.Price ?? any.price;
  const stock = any.Quantity ?? any.InventoryQuantity ?? any.quantity;
  const barcode = any.Barcode ?? any.barcode;
  return {
    id: p.Id,
    kind: 'manual',
    title: 'Fill the gaps',
    note: 'Can’t auto-guess',
    itemTitle: p.Title || 'Item',
    itemImage: firstImage(p),
    itemSub: p.reason,
    fields: [
      { label: 'SKU', value: p.Sku || '', placeholder: 'e.g. 1001-B', required: !p.Sku },
      { label: 'Price', value: price ? `$${price}` : '', placeholder: '$0.00', required: !price, half: true },
      { label: 'Stock', value: stock != null ? String(stock) : '', placeholder: '0', half: true },
      { label: 'Barcode / UPC', value: barcode || '', placeholder: 'optional' },
    ],
  };
}

// "Fill by hand" for the details bucket — title + description, not SKU/price.
function dataManualCase(p: ClassifiedProduct): OptimizeCase {
  return {
    id: p.Id,
    kind: 'manual',
    title: 'Write the details',
    note: p.reason,
    itemTitle: p.Title || 'Item',
    itemImage: firstImage(p),
    fields: [
      { label: 'Title', value: p.Title || '', placeholder: 'Product title', required: (p.Title || '').trim().length < 5 },
      { label: 'Description', value: p.Description || '', placeholder: 'Describe the item' },
    ],
  };
}

export function BackfillOptimizerScreen() {
  const navigation = useNavigation<StackNavigationProp<any>>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const newlyImportedIds: string[] = Array.isArray(route.params?.newlyImportedIds)
    ? route.params.newlyImportedIds
    : [];
  const newlyImportedSet = useMemo(() => new Set(newlyImportedIds), [newlyImportedIds]);

  const [view, setView] = useState<ScreenView>({ kind: 'lobby' });
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [manualDeck, setManualDeck] = useState<OptimizeCase[]>([]);
  const [dataDeck, setDataDeck] = useState<OptimizeCase[]>([]); // details "fill by hand"
  const [dataSubset, setDataSubset] = useState<ClassifiedProduct[] | null>(null); // chosen by "pick how many"

  const { loading, products, counts, photoNeededItems, dataNeededItems, manualQueueItems, refresh } =
    useOptimizerQueues({ limit: 100 });

  const prioritize = useCallback(
    (list: ClassifiedProduct[]) => {
      const remaining = list.filter((i) => !completedIds.has(i.Id));
      return [...remaining].sort((a, b) => {
        const an = newlyImportedSet.has(a.Id) ? 0 : 1;
        const bn = newlyImportedSet.has(b.Id) ? 0 : 1;
        return an - bn;
      });
    },
    [completedIds, newlyImportedSet],
  );

  const photoQueue = useMemo(() => prioritize(photoNeededItems), [prioritize, photoNeededItems]);
  const dataQueue = useMemo(() => prioritize(dataNeededItems), [prioritize, dataNeededItems]);
  const manualQueue = useMemo(() => prioritize(manualQueueItems), [prioritize, manualQueueItems]);

  const queueFor = (b: Bucket) => (b === 'photo' ? photoQueue : b === 'data' ? dataQueue : manualQueue);
  const remainingFor = (b: Bucket) => queueFor(b).length;

  const polishedCount = Math.max(
    counts.total - counts.photoNeeded - counts.dataNeeded - counts.manualQueue,
    0,
  );
  const attention = photoQueue.length + dataQueue.length + manualQueue.length;
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

  const dataChooseCase: OptimizeCase = useMemo(
    () => ({
      id: 'data-choose',
      kind: 'datachoose',
      title: `${dataQueue.length} need details`,
      note: 'Weak titles & thin copy',
      count: dataQueue.length,
      chips: ['Title', 'Description', 'Tags', 'Category'],
    }),
    [dataQueue.length],
  );
  const dataSelectCase: OptimizeCase = useMemo(
    () => ({
      id: 'data-select',
      kind: 'dataselect',
      title: 'Pick how many',
      note: 'Tap to include',
      rows: dataQueue.map((it) => ({ id: it.Id, title: it.Title || 'Item', sub: it.Sku || undefined, miss: it.reason, on: true })),
    }),
    [dataQueue],
  );

  const markDone = useCallback(
    (ids: string[]) => {
      setCompletedIds((prev) => new Set([...prev, ...ids]));
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
    });
  }, [navigation, polishedCount]);

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

  const handleLessonComplete = useCallback(
    (label: string) => (ids: string[]) => {
      markDone(ids);
      setView({ kind: 'done', n: ids.length, label });
    },
    [markDone],
  );

  // If the active manual card's queue empties, fall back to the lobby.
  useEffect(() => {
    if (view.kind === 'manual' && manualDeck.length === 0) setView({ kind: 'lobby' });
  }, [view, manualDeck.length]);

  // ── Photo / Details lessons keep the real camera + AI views ───────────────
  if (view.kind === 'lesson' && view.q === 'photo') {
    return (
      <OptimizerPhotoModeView
        onBack={() => setView({ kind: 'lobby' })}
        onComplete={(ids: string[]) => {
          markDone(ids);
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
        <View style={styles.introBackRow}>
          <TouchableOpacity onPress={() => setView({ kind: 'lobby' })} style={styles.introBackBtn} hitSlop={HIT}>
            <MaterialCommunityIcons name="arrow-left" size={20} color={RC.ink} />
          </TouchableOpacity>
        </View>
        <View style={styles.introBody}>
          <View style={styles.taskStrip}>
            <View style={styles.taskStripDone}>
              <MaterialCommunityIcons name="check-bold" size={14} color={RC.greenDark} />
              <Text style={styles.taskStripDoneText}>Photos</Text>
            </View>
            <View style={styles.taskStripLine} />
            <View style={styles.taskStripActive}>
              <Text style={styles.taskStripActiveText}>Details</Text>
            </View>
          </View>
          <Text style={styles.introTitle}>Now, the details</Text>
          <Text style={styles.introSub}>
            We&rsquo;ll write the title, description and category for {n} item{plural(n)} — for every channel.
            You just review each one.
          </Text>
        </View>
        <View style={[styles.introFooter, { paddingBottom: insets.bottom + 18 }]}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => {
              setReviewIds(new Set([...dataQueue, ...manualQueue].map((p) => p.Id)));
              if (dataQueue.length > 0) setView({ kind: 'lesson', q: 'data' });
              else setView({ kind: 'review' });
            }}
            style={styles.introPrimary}
          >
            <MaterialCommunityIcons name="star-four-points" size={18} color="#fff" />
            <Text style={styles.introPrimaryText}>Generate details for {n}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => enterBucket(dataQueue.length > 0 ? 'data' : 'manual')} style={styles.introSkip}>
            <Text style={styles.introSkipText}>I&rsquo;ll write them myself</Text>
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
          markDone(done);
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
          markDone(ids);
          setView({ kind: 'review' });
        }}
        queueProducts={dataSubset && dataSubset.length ? dataSubset : dataQueue}
      />
    );
  }

  // ── Details flow: Choose how → (generate all · pick subset · by hand) ──────
  if (view.kind === 'datachoose') {
    return (
      <OptimizeResolver
        c={dataChooseCase}
        idx={1}
        total={1}
        topInset={insets.top}
        onBack={() => setView({ kind: 'lobby' })}
        onResolve={(d, meta) => {
          if (d === 'alt') return setView({ kind: 'lobby' });
          const r = meta?.route || 'all';
          if (r === 'pick') return setView({ kind: 'dataselect' });
          if (r === 'hand') {
            setDataDeck(dataQueue.map(dataManualCase));
            return setView({ kind: 'datamanual', i: 0 });
          }
          setDataSubset(null);
          setView({ kind: 'lesson', q: 'data' });
        }}
      />
    );
  }
  if (view.kind === 'dataselect') {
    return (
      <OptimizeResolver
        c={dataSelectCase}
        idx={1}
        total={1}
        topInset={insets.top}
        onBack={() => setView({ kind: 'datachoose' })}
        onResolve={(d, meta) => {
          if (d === 'alt') {
            setDataSubset(null); // "select all" → generate for everyone
          } else {
            const ids = new Set(meta?.selectedIds || []);
            setDataSubset(dataQueue.filter((it) => ids.has(it.Id)));
          }
          setView({ kind: 'lesson', q: 'data' });
        }}
      />
    );
  }
  if (view.kind === 'datamanual') {
    const total = dataDeck.length;
    const di = Math.min(view.i, Math.max(total - 1, 0));
    const cur = dataDeck[di];
    if (cur) {
      return (
        <OptimizeResolver
          key={cur.id}
          c={cur}
          idx={di + 1}
          total={total}
          topInset={insets.top}
          onBack={() => (di > 0 ? setView({ kind: 'datamanual', i: di - 1 }) : setView({ kind: 'datachoose' }))}
          onResolve={() => {
            markDone([cur.id]);
            if (di + 1 < total) setView({ kind: 'datamanual', i: di + 1 });
            else setView({ kind: 'done', n: total, label: 'details written' });
          }}
        />
      );
    }
  }

  // ── Manual "Fill the gaps" resolver deck ──────────────────────────────────
  if (view.kind === 'manual') {
    const total = manualDeck.length;
    const di = Math.min(view.i, Math.max(total - 1, 0));
    const cur = manualDeck[di];
    if (cur) {
      return (
        <OptimizeResolver
          key={cur.id}
          c={cur}
          idx={di + 1}
          total={total}
          topInset={insets.top}
          onBack={() => (di > 0 ? setView({ kind: 'manual', i: di - 1 }) : setView({ kind: 'lobby' }))}
          onResolve={(_d: Decision) => {
            markDone([cur.id]);
            if (di + 1 < total) setView({ kind: 'manual', i: di + 1 });
            else setView({ kind: 'done', n: total, label: 'gaps filled' });
          }}
        />
      );
    }
  }

  // ── Done — between flows ──────────────────────────────────────────────────
  if (view.kind === 'done') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
        <View style={styles.doneWrap}>
          <View style={styles.doneBadge}>
            <MaterialCommunityIcons name="check" size={40} color="#fff" />
          </View>
          <Text style={styles.doneCount}>{view.n}</Text>
          <Text style={styles.doneLabel}>{view.label}</Text>
          <TouchableOpacity
            style={styles.doneBtn}
            activeOpacity={0.88}
            onPress={() => (firstBucket ? setView({ kind: 'lobby' }) : finishOptimize())}
          >
            <Text style={styles.doneBtnText}>{firstBucket ? 'Keep going' : 'All set · finish'}</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Step 0 · the optimize intro — names the two tasks (Photos · Details) ──
  const photosLeft = photoQueue.length;
  const detailsLeft = dataQueue.length + manualQueue.length;
  const startBucket: Bucket | null =
    photosLeft > 0 ? 'photo' : dataQueue.length > 0 ? 'data' : manualQueue.length > 0 ? 'manual' : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <LobbyHeader
        title="Optimize"
        countSuffix={`${counts.total} items`}
        onBack={() => navigation.goBack()}
        right={<HeaderPill label={`${counts.total - attention} ready`} icon="star-four-points" iconColor={RC.green} />}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={RC.green} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.introScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.introTitle}>
            {attention > 0 ? `Let’s finish your ${attention} item${plural(attention)}` : 'Everything’s polished'}
          </Text>
          <Text style={styles.introSub}>
            {attention > 0 ? 'Two quick tasks and they’re ready to sell.' : 'Every listing has photos & details.'}
          </Text>

          <View style={styles.taskList}>
            {/* 1 · Photos */}
            <TouchableOpacity
              activeOpacity={photosLeft === 0 ? 1 : 0.85}
              disabled={photosLeft === 0}
              onPress={() => enterBucket('photo')}
              style={styles.taskRow}
            >
              <View style={[styles.taskIcon, photosLeft === 0 && styles.taskIconDone]}>
                <MaterialCommunityIcons name={photosLeft === 0 ? 'check-bold' : 'camera'} size={23} color={RC.greenDark} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.taskTitle}>1 · Photos</Text>
                <Text style={styles.taskSub} numberOfLines={1}>Snap each item — one at a time.</Text>
              </View>
              {photosLeft === 0 ? (
                <Text style={styles.taskDoneTag}>Done</Text>
              ) : (
                <Text style={styles.taskCount}>{photosLeft}</Text>
              )}
            </TouchableOpacity>

            {/* 2 · Details */}
            <TouchableOpacity
              activeOpacity={detailsLeft === 0 ? 1 : 0.85}
              disabled={detailsLeft === 0}
              onPress={() => enterBucket(dataQueue.length > 0 ? 'data' : 'manual')}
              style={styles.taskRow}
            >
              <View style={[styles.taskIcon, detailsLeft === 0 && styles.taskIconDone]}>
                <MaterialCommunityIcons name={detailsLeft === 0 ? 'check-bold' : 'star-four-points'} size={23} color={RC.greenDark} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.taskTitle}>2 · Details</Text>
                <Text style={styles.taskSub} numberOfLines={1}>We write them — you just review.</Text>
              </View>
              {detailsLeft === 0 ? (
                <Text style={styles.taskDoneTag}>Done</Text>
              ) : (
                <Text style={styles.taskTag}>auto</Text>
              )}
            </TouchableOpacity>
          </View>

          {attention > 0 && <Text style={styles.introTime}>About 2 minutes</Text>}
        </ScrollView>
      )}

      <LinearGradient colors={['rgba(255,255,255,0)', '#FFFFFF']} style={styles.fade} pointerEvents="none" />
      <View style={[styles.introFooter, { paddingBottom: insets.bottom + 18 }]}>
        {startBucket ? (
          <TouchableOpacity activeOpacity={0.9} onPress={() => enterBucket(startBucket)} style={styles.introPrimary}>
            <Text style={styles.introPrimaryText}>{startBucket === 'photo' ? 'Start with photos' : 'Start with details'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity activeOpacity={0.9} onPress={finishOptimize} style={styles.introPrimary}>
            <Text style={styles.introPrimaryText}>Finish</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.introSkip}>
          <Text style={styles.introSkipText}>{startBucket ? 'Do it later' : 'Back to inventory'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RC.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 150 },
  progressWrap: { marginBottom: 16 },

  empty: { alignItems: 'center', paddingTop: 50, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: RC.ink, marginTop: 12 },
  emptySub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 6, textAlign: 'center', lineHeight: 18 },

  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 150 },

  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, gap: 4 },
  doneBadge: { width: 84, height: 84, borderRadius: 42, backgroundColor: RC.green, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  doneCount: { fontSize: 52, fontWeight: '800', color: RC.ink, letterSpacing: -1.5 },
  doneLabel: { fontSize: 15, fontWeight: '600', color: RC.muted },
  doneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: RC.green, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 28 },
  doneBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  // ── Step 0 intro + explainer (task framing) ───────────────────────────────
  introScroll: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 170 },
  introTitle: { fontSize: 27, fontWeight: '800', color: RC.ink, letterSpacing: -0.6, lineHeight: 32 },
  introSub: { fontSize: 14.5, fontWeight: '500', color: RC.muted, marginTop: 8 },
  taskList: { gap: 12, marginTop: 24 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: RC.line, borderRadius: 16, padding: 16 },
  taskIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: RC.greenSoft, alignItems: 'center', justifyContent: 'center' },
  taskIconDone: { backgroundColor: RC.greenSoft },
  taskTitle: { fontSize: 16, fontWeight: '700', color: RC.ink, letterSpacing: -0.2 },
  taskSub: { fontSize: 13.5, fontWeight: '500', color: RC.muted, marginTop: 2 },
  taskCount: { fontSize: 14, fontWeight: '800', color: RC.muted, fontVariant: ['tabular-nums'] },
  taskTag: { fontSize: 12, fontWeight: '700', color: RC.greenDark, backgroundColor: RC.greenSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden' },
  taskDoneTag: { fontSize: 13, fontWeight: '700', color: RC.greenDark },
  introTime: { fontSize: 12.5, fontWeight: '500', color: RC.faint, textAlign: 'center', marginTop: 20 },

  introBackRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 40 },
  introBackBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: RC.bg, borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center' },
  introBody: { flex: 1, paddingHorizontal: 22, paddingTop: 12, gap: 8 },
  taskStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  taskStripDone: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: RC.greenSoft, borderWidth: 1, borderColor: RC.greenLine, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  taskStripDoneText: { fontSize: 13, fontWeight: '700', color: RC.greenDark },
  taskStripLine: { flex: 1, height: 2, backgroundColor: RC.line },
  taskStripActive: { backgroundColor: RC.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  taskStripActiveText: { fontSize: 13, fontWeight: '800', color: '#fff' },

  introFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, gap: 6 },
  introPrimary: { height: 54, borderRadius: 14, backgroundColor: RC.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  introPrimaryText: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
  introSkip: { height: 40, alignItems: 'center', justifyContent: 'center' },
  introSkipText: { fontSize: 14, fontWeight: '600', color: RC.faint },
});
