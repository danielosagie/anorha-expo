import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { OptimizerBatchGenerateView } from '../components/optimizer/OptimizerBatchGenerateView';
import { OptimizerPhotoModeView } from '../components/optimizer/OptimizerPhotoModeView';
import { useOptimizerQueues, ClassifiedProduct } from '../hooks/useOptimizerQueues';
import { RC, MiniProgress } from '../components/resolve/ResolveKit';
import { OptimizeResolver, OptimizeCase, Decision } from '../components/resolve/optimizeResolvers';

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

const BUCKETS: Record<
  Bucket,
  { icon: any; tone: 'urgent' | 'warn'; title: string; reason: string; action: string }
> = {
  photo: { icon: 'camera', tone: 'urgent', title: 'need photos', reason: '0–1 image · won’t list on most', action: 'Shoot' },
  data: { icon: 'text-box-outline', tone: 'warn', title: 'need details', reason: 'weak title or description', action: 'Generate' },
  manual: { icon: 'pencil-box-outline', tone: 'warn', title: 'need a fix', reason: 'missing SKU, price or stock', action: 'Fill' },
};
const BUCKET_ORDER: Bucket[] = ['photo', 'data', 'manual'];

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

  // ── Lobby ─────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={HIT} style={{ marginLeft: -6 }}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={RC.muted} />
        </TouchableOpacity>
        <Text style={styles.headTitle}>Optimize</Text>
        <Text style={styles.headTag}>AFTER MATCH</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={RC.green} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <MiniProgress
            pct={readyPct}
            left={`${polishedCount} of ${counts.total} listing-ready`}
            right={`${readyPct}%`}
          />

          <Text style={styles.attn}>
            {attention > 0 ? `${attention} NEED ATTENTION` : 'ALL CLEAR'}
          </Text>

          {BUCKET_ORDER.map((b) => {
            const n = remainingFor(b);
            if (n === 0) return null;
            const meta = BUCKETS[b];
            return <BucketCard key={b} meta={meta} count={n} onPress={() => enterBucket(b)} />;
          })}

          {attention === 0 && (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="check-decagram" size={40} color={RC.green} />
              <Text style={styles.emptyTitle}>Inbox zero</Text>
              <Text style={styles.emptySub}>Every listing has photos, details & data.</Text>
            </View>
          )}
        </ScrollView>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.footDivider} />
        <TouchableOpacity
          activeOpacity={firstBucket ? 0.88 : 1}
          disabled={!firstBucket}
          onPress={() => firstBucket && enterBucket(firstBucket)}
          style={[styles.primaryBtn, !firstBucket && { backgroundColor: RC.surface2 }]}
        >
          <MaterialCommunityIcons
            name={firstBucket ? BUCKETS[firstBucket].icon : 'check'}
            size={18}
            color={firstBucket ? '#fff' : RC.faint}
          />
          <Text style={[styles.primaryText, !firstBucket && { color: RC.faint }]}>
            {firstBucket ? `Start — ${BUCKETS[firstBucket].action.toLowerCase()} ${remainingFor(firstBucket)}` : 'All polished'}
          </Text>
        </TouchableOpacity>
        {polishedCount > 0 && (
          <TouchableOpacity hitSlop={HIT} style={styles.altHit} onPress={() => navigation.goBack()}>
            <Text style={styles.altText}>Publish {polishedCount} ready now</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function BucketCard({
  meta,
  count,
  onPress,
}: {
  meta: { icon: any; tone: 'urgent' | 'warn'; title: string; reason: string; action: string };
  count: number;
  onPress: () => void;
}) {
  const c = meta.tone === 'urgent' ? RC.danger : RC.warnInk;
  const bg = meta.tone === 'urgent' ? RC.dangerSoft : RC.warnSoft;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.bucket}>
      <View style={[styles.bucketIcon, { backgroundColor: bg }]}>
        <MaterialCommunityIcons name={meta.icon} size={20} color={c} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.bucketTitle} numberOfLines={1}>
          <Text style={styles.bucketCount}>{count} </Text>
          {meta.title}
        </Text>
        <Text style={styles.bucketReason} numberOfLines={1}>{meta.reason}</Text>
      </View>
      <View style={styles.bucketAction}>
        <Text style={[styles.bucketActionText, { color: c }]}>{meta.action}</Text>
        <MaterialCommunityIcons name="chevron-right" size={16} color={c} />
      </View>
    </TouchableOpacity>
  );
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RC.bg, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  headTitle: { fontSize: 24, fontWeight: '700', color: RC.ink, letterSpacing: -0.5 },
  headTag: { marginLeft: 'auto', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: RC.faint },

  scroll: { paddingTop: 2, paddingBottom: 24, gap: 9 },
  attn: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: RC.faint, marginTop: 14, marginBottom: 2 },

  bucket: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff' },
  bucketIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bucketTitle: { fontSize: 14, fontWeight: '600', color: RC.ink },
  bucketCount: { fontSize: 16, fontWeight: '800', color: RC.ink },
  bucketReason: { fontSize: 11.5, fontWeight: '500', color: RC.muted, marginTop: 1 },
  bucketAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bucketActionText: { fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 50, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: RC.ink, marginTop: 12 },
  emptySub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 6, textAlign: 'center', lineHeight: 18 },

  footer: { paddingTop: 10 },
  footDivider: { height: 1, backgroundColor: RC.line, marginBottom: 12 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: RC.green, borderRadius: 12, paddingVertical: 15 },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  altHit: { paddingVertical: 12, alignItems: 'center' },
  altText: { fontSize: 13, fontWeight: '700', color: RC.muted, textDecorationLine: 'underline' },

  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, gap: 4 },
  doneBadge: { width: 84, height: 84, borderRadius: 42, backgroundColor: RC.green, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  doneCount: { fontSize: 52, fontWeight: '800', color: RC.ink, letterSpacing: -1.5 },
  doneLabel: { fontSize: 15, fontWeight: '600', color: RC.muted },
  doneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: RC.green, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 28 },
  doneBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
