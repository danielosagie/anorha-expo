import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation, useRoute } from '@react-navigation/native';

import { OptimizerBatchGenerateView } from '../components/optimizer/OptimizerBatchGenerateView';
import { OptimizerPhotoModeView } from '../components/optimizer/OptimizerPhotoModeView';
import { useOptimizerQueues } from '../hooks/useOptimizerQueues';
import {
  QUEST,
  QFONT,
  QuestBar,
  QuestRow,
  QuestDone,
  QuestSegment,
} from '../components/quest/QuestKit';

// Lobby → lesson → done (HO5). The photo + data lessons reuse the existing
// camera / AI-draft views (real picker + generation logic preserved); the
// dashboard tabs / tiered list / FAB / celebration overlay are pruned.

type QuestId = 'photo' | 'data';
type ScreenView =
  | { kind: 'lobby' }
  | { kind: 'lesson'; q: QuestId }
  | { kind: 'done'; q: QuestId; n: number };

const QUEST_ORDER: QuestId[] = ['photo', 'data'];
const QUEST_META: Record<
  QuestId,
  { title: string; sub: string; unit: string; accent: string; accentDark: string; short: string; doneLabel: string; icon: 'camera' | 'auto-fix' }
> = {
  photo: {
    title: 'Photo run',
    sub: 'snap or upload a photo · 1-by-1',
    unit: 'items',
    accent: QUEST.orange,
    accentDark: QUEST.orangeD,
    short: 'photo',
    doneLabel: 'photos added',
    icon: 'camera',
  },
  data: {
    title: 'Draft missing data',
    sub: 'AI fills it in · you accept or tweak',
    unit: 'items',
    accent: QUEST.yellow,
    accentDark: QUEST.yellowD,
    short: 'data',
    doneLabel: 'listings drafted',
    icon: 'auto-fix',
  },
};

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

  const { loading, products, counts, photoNeededItems, dataNeededItems, manualQueueItems, refresh } =
    useOptimizerQueues({ limit: 100 });

  const prioritize = useCallback(
    (list: any[]) => {
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
  const dataQueue = useMemo(
    () => prioritize([...dataNeededItems, ...manualQueueItems]),
    [prioritize, dataNeededItems, manualQueueItems],
  );

  const remainingFor = useCallback(
    (q: QuestId) => (q === 'photo' ? photoQueue.length : dataQueue.length),
    [photoQueue.length, dataQueue.length],
  );

  const polishedCount = Math.max(
    counts.total - counts.photoNeeded - counts.dataNeeded - counts.manualQueue,
    0,
  );

  const activeQuest = useMemo<QuestId | null>(
    () => QUEST_ORDER.find((q) => remainingFor(q) > 0) || null,
    [remainingFor],
  );
  const questState = useCallback(
    (q: QuestId): 'done' | 'active' | 'locked' => {
      if (remainingFor(q) === 0) return 'done';
      if (q === activeQuest) return 'active';
      return 'locked';
    },
    [remainingFor, activeQuest],
  );

  const segments = useCallback(
    (current: QuestId | null): QuestSegment[] => {
      const segs: QuestSegment[] = [
        { n: Math.max(polishedCount, 1), done: true, short: 'ready' },
      ];
      QUEST_ORDER.forEach((q) => {
        const r = remainingFor(q);
        const meta = QUEST_META[q];
        segs.push({
          n: Math.max(r, 1),
          done: r === 0,
          color: meta.accent,
          short: meta.short,
          label: current === q ? meta.short : undefined,
        });
      });
      return segs;
    },
    [polishedCount, remainingFor],
  );
  const segIdx = useCallback(
    (q: QuestId | null) => (q ? QUEST_ORDER.indexOf(q) + 1 : QUEST_ORDER.length),
    [],
  );

  const handleComplete = useCallback(
    (q: QuestId) => (ids: string[]) => {
      setCompletedIds((prev) => new Set([...prev, ...ids]));
      refresh();
      setView({ kind: 'done', q, n: ids.length });
    },
    [refresh],
  );

  const goNext = useCallback(() => {
    const next = activeQuest;
    if (next) setView({ kind: 'lesson', q: next });
    else setView({ kind: 'lobby' });
  }, [activeQuest]);

  // If a lesson's queue empties out from under us, fall back to the lobby.
  useEffect(() => {
    if (view.kind === 'lesson' && remainingFor(view.q) === 0) setView({ kind: 'lobby' });
  }, [view, remainingFor]);

  if (view.kind === 'lesson') {
    if (view.q === 'photo') {
      return (
        <OptimizerPhotoModeView
          onBack={() => setView({ kind: 'lobby' })}
          onComplete={handleComplete('photo')}
          queueProducts={photoQueue}
        />
      );
    }
    return (
      <OptimizerBatchGenerateView
        onBack={() => setView({ kind: 'lobby' })}
        onComplete={handleComplete('data')}
        queueProducts={dataQueue}
      />
    );
  }

  if (view.kind === 'done') {
    const meta = QUEST_META[view.q];
    const next = activeQuest;
    const nextMeta = next ? QUEST_META[next] : null;
    return (
      <QuestDone
        segments={segments(view.q)}
        activeIdx={segIdx(view.q)}
        topInset={insets.top}
        onClose={() => setView({ kind: 'lobby' })}
        icon={meta.icon}
        count={view.n}
        label={meta.doneLabel}
        next={
          nextMeta && next
            ? {
                count: remainingFor(next),
                unit: nextMeta.unit,
                title: nextMeta.title,
                sub: nextMeta.sub,
                accent: nextMeta.accent,
                tag: 'up next',
              }
            : {
                count: polishedCount,
                unit: 'ready',
                title: 'All polished',
                sub: 'every listing has photos & data',
                accent: QUEST.green,
                tag: 'done',
              }
        }
        onContinue={goNext}
      />
    );
  }

  // Lobby
  const questsDone = QUEST_ORDER.filter((q) => remainingFor(q) === 0).length;
  const itemsLeft = photoQueue.length + dataQueue.length;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <QuestBar
        segments={segments(activeQuest)}
        activeIdx={segIdx(activeQuest)}
        close="back"
        onClose={() => navigation.goBack()}
      />

      <View style={styles.head}>
        <Text style={styles.title}>Polish listings</Text>
        <Text style={styles.sub}>
          {questsDone} of {QUEST_ORDER.length} quests done
          {itemsLeft > 0 ? ` · ${itemsLeft} items need attention` : ' · all clear'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={QUEST.green} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <QuestRow
            state="done"
            accent={QUEST.green}
            accentDark={QUEST.greenD}
            count={polishedCount}
            unit="ready"
            title="Already polished"
            sub="have photos & complete data"
          />
          {QUEST_ORDER.map((q) => {
            const meta = QUEST_META[q];
            const st = questState(q);
            return (
              <QuestRow
                key={q}
                state={st}
                accent={meta.accent}
                accentDark={meta.accentDark}
                count={remainingFor(q)}
                unit={meta.unit}
                title={meta.title}
                sub={meta.sub}
                onPress={st === 'active' ? () => setView({ kind: 'lesson', q }) : undefined}
              />
            );
          })}

          {products.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Inbox zero</Text>
              <Text style={styles.emptySub}>Every product is optimized and ready to sell.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: QUEST.bg },
  head: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 18, fontFamily: QFONT.b, color: QUEST.ink, letterSpacing: -0.4 },
  sub: { fontSize: 12, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 2 },
  scroll: { paddingHorizontal: 16, paddingBottom: 120 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 18, fontFamily: QFONT.b, color: QUEST.ink },
  emptySub: { fontSize: 13, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 6, textAlign: 'center' },
});
