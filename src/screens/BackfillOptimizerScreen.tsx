import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { OptimizerBatchGenerateView } from '../components/optimizer/OptimizerBatchGenerateView';
import { OptimizerPhotoModeView } from '../components/optimizer/OptimizerPhotoModeView';
import { useOptimizerQueues, ClassifiedProduct } from '../hooks/useOptimizerQueues';
import { RC, MiniProgress } from '../components/resolve/ResolveKit';
import { OptimizeResolver, OptimizeCase, Decision } from '../components/resolve/optimizeResolvers';
import {
  LobbyHeader,
  HeaderPill,
  IssueLane,
  LaneIssue,
  IconName,
} from '../components/quest/LobbyKit';
import BottomActionBar from '../components/BottomActionBar';

// Optimize v2 — one lobby of grouped gaps (photos · details · manual), each
// routing to the fix it needs. Photo + details keep the real camera / AI views;
// the manual queue runs the new "Fill the gaps" resolver deck.

type Bucket = 'photo' | 'data' | 'manual';
type ScreenView =
  | { kind: 'lobby' }
  | { kind: 'lesson'; q: 'photo' | 'data' }
  | { kind: 'datachoose' }
  | { kind: 'dataselect' }
  | { kind: 'manual'; i: number }
  | { kind: 'datamanual'; i: number }
  | { kind: 'done'; n: number; label: string };

const BUCKET_ORDER: Bucket[] = ['photo', 'data', 'manual'];

const plural = (n: number) => (n === 1 ? '' : 's');

// Lane presentation for the optimize lobby — mirrors the match lobby's
// IssueLane so the Match/Optimize Lobby layout is shared.
const OPT_META: Record<Bucket, { icon: IconName; title: string; action: string; sub: (n: number) => string }> = {
  photo: {
    icon: 'camera',
    title: 'Need photos',
    action: 'Shoot',
    sub: (n) => `${n} listing${plural(n)}`,
  },
  data: {
    icon: 'text-box-outline',
    title: 'Need details',
    action: 'Generate',
    sub: (n) => `${n} item${plural(n)}`,
  },
  manual: {
    icon: 'pencil-box-outline',
    title: 'Need SKU · price · stock',
    action: 'Fill',
    sub: (n) => `${n} item${plural(n)}`,
  },
};

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
  const readyPct = counts.total ? Math.round((polishedCount / counts.total) * 100) : 100;
  const firstBucket = BUCKET_ORDER.find((b) => remainingFor(b) > 0) || null;

  // One lobby "issue" row per non-empty bucket, first = active step.
  const optimizeIssues: LaneIssue[] = BUCKET_ORDER.map((b) => ({ b, n: remainingFor(b) }))
    .filter(({ n }) => n > 0)
    .map(({ b, n }, i) => {
      const meta = OPT_META[b];
      return {
        id: b,
        icon: meta.icon,
        title: meta.title,
        sub: meta.sub(n),
        count: n,
        state: i === 0 ? 'active' : 'locked',
        ctaLabel: `${meta.action} ${n}`,
        onFix: () => enterBucket(b),
      };
    });

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

  const enterBucket = (b: Bucket) => {
    if (remainingFor(b) === 0) return;
    if (b === 'manual') {
      setManualDeck(manualQueue.map(manualCaseFor));
      setView({ kind: 'manual', i: 0 });
    } else if (b === 'data') {
      setView({ kind: 'datachoose' });
    } else {
      setView({ kind: 'lesson', q: b });
    }
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
        onComplete={handleLessonComplete('photos added')}
        queueProducts={photoQueue}
      />
    );
  }
  if (view.kind === 'lesson' && view.q === 'data') {
    return (
      <OptimizerBatchGenerateView
        onBack={() => setView({ kind: 'datachoose' })}
        onComplete={handleLessonComplete('listings drafted')}
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
          <TouchableOpacity style={styles.doneBtn} activeOpacity={0.88} onPress={() => setView({ kind: 'lobby' })}>
            <Text style={styles.doneBtnText}>{firstBucket ? 'Keep going' : 'Back to optimize'}</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Lobby (shares the Match/Optimize Lobby layout) ────────────────────────
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <LobbyHeader
        title="Optimize"
        countSuffix={`${counts.total} Items`}
        onBack={() => navigation.goBack()}
        right={<HeaderPill label={`${readyPct}% ready`} icon="star-four-points" iconColor={RC.green} />}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={RC.green} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.progressWrap}>
            <MiniProgress
              pct={readyPct}
              left={`${polishedCount} of ${counts.total} ready`}
              right={`${readyPct}%`}
            />
          </View>

          {optimizeIssues.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="check-decagram" size={40} color={RC.green} />
              <Text style={styles.emptyTitle}>Inbox zero</Text>
              <Text style={styles.emptySub}>Every listing has photos, details & data.</Text>
            </View>
          ) : (
            <IssueLane issues={optimizeIssues} />
          )}
        </ScrollView>
      )}

      <LinearGradient
        colors={['rgba(255,255,255,0)', '#FFFFFF']}
        style={styles.fade}
        pointerEvents="none"
      />
      {attention === 0 ? (
        <BottomActionBar
          primaryLabel={`Publish ${polishedCount} ready`}
          primaryIcon={<MaterialCommunityIcons name="check" size={20} color="#fff" />}
          onPrimary={() => navigation.goBack()}
        />
      ) : (
        <BottomActionBar
          primaryLabel={optimizeIssues[0]?.ctaLabel || `${attention} need attention`}
          primaryIcon={<MaterialCommunityIcons name="wrench" size={20} color="#fff" />}
          primaryButtonStyle={{ backgroundColor: RC.orange }}
          onPrimary={() => firstBucket && enterBucket(firstBucket)}
          secondaryLabel={polishedCount > 0 ? `Publish ${polishedCount} ready now` : undefined}
          secondaryIcon={<MaterialCommunityIcons name="cloud-upload-outline" size={20} color="#71717A" />}
          onSecondary={polishedCount > 0 ? () => navigation.goBack() : undefined}
        />
      )}
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
});
