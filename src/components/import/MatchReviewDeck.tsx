// MatchReviewDeck renders one resolver item at a time with explicit actions.
//
// Candidates present:
//   right = link, left = skip for later, up = ignore, plus a New button.
// No candidates:
//   right = add as new, left = skip for later, up = ignore.
//
// Decisions stay local until the final Save. The backend resolve endpoint has
// no unresolve operation, so staging is what makes undo and redo truthful for
// every choice, including durable Ignore.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SyncItem, ResolveChoice } from '../../types/syncItem';
import { TinderShell, DeckChrome, RC } from '../resolve/ResolveKit';
import DecisionCard from './DecisionCard';
import { SwipeLabelsContext } from './SwipeCard';
import {
  fetchImportIncomingItemDetails,
  incomingItemDetailsFromPayload,
  type IncomingItemDetails,
} from '../../lib/importCandidateDetails';
import { createLogger } from '../../utils/logger';

const log = createLogger('MatchReviewDeck');

type DeckChoice = ResolveChoice | 'skip';
type Decision = { item: SyncItem; choice: DeckChoice; canonicalId?: string };
type SavedDecision = { item: SyncItem; choice: ResolveChoice; canonicalId?: string };
type Outcome = { attempt: number; status: 'pending' | 'success' | 'failed' };
type Ending = { kind: 'review' | 'waiting' | 'done' | 'failed'; count?: number };

export default function MatchReviewDeck({
  items,
  platformName,
  resolve,
  resolving,
  onDone,
  topInset = 0,
}: {
  items: SyncItem[];
  platformName?: string;
  resolve: (platformId: string, choice: ResolveChoice, canonicalId?: string) => Promise<unknown>;
  resolving: string | null;
  onDone?: (sessionCounts?: { linked: number; created: number; ignored: number }) => void;
  topInset?: number;
}) {
  type DeckEntry = { item: SyncItem; key: string };
  const [deck] = useState<DeckEntry[]>(() =>
    items.map((item, index) => ({ item, key: `${item.platformId}:${index}` })),
  );
  const total = deck.length;
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  const committedCardRef = useRef<string | null>(null);
  const [interacted, setInteracted] = useState(false);

  const [picks, setPicks] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {};
    for (const { item } of deck) {
      const recommended = item.resolution.kind === 'link' ? item.resolution.canonical.id : null;
      const first = item.candidates?.[0]?.id;
      if (recommended || first) seeded[item.platformId] = recommended ?? first!;
    }
    return seeded;
  });

  const [detailsByPlatform, setDetailsByPlatform] = useState<Record<string, IncomingItemDetails>>(() => {
    const details: Record<string, IncomingItemDetails> = {};
    for (const { item } of deck) {
      details[item.platformId] = incomingItemDetailsFromPayload(item, platformName);
    }
    return details;
  });

  const [history, setHistory] = useState<Decision[]>([]);
  const historyRef = useRef<Decision[]>([]);
  const decisionsRef = useRef<Record<string, SavedDecision>>({});
  const outcomesRef = useRef<Record<string, Outcome>>({});
  const pendingRef = useRef<Record<string, Promise<void>>>({});
  const [ending, setEnding] = useState<Ending>({ kind: 'review' });

  const curEntry = deck[pos];
  const rawCur = curEntry?.item;
  const groupEntries = useMemo(() => {
    if (!rawCur?.groupId) return rawCur ? [rawCur] : [];
    return deck
      .map((entry) => entry.item)
      .filter((item) => item.groupId === rawCur.groupId);
  }, [deck, rawCur]);
  useEffect(() => {
    if (groupEntries.length === 0) return;
    let alive = true;
    void Promise.all(
      groupEntries.map(async (item) => {
        try {
          return [item.platformId, await fetchImportIncomingItemDetails(item, platformName)] as const;
        } catch (error) {
          log.warn('incoming hydration failed', item.platformId, error);
          return [item.platformId, incomingItemDetailsFromPayload(item, platformName)] as const;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      setDetailsByPlatform((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => {
      alive = false;
    };
  }, [groupEntries, platformName]);

  useEffect(() => {
    committedCardRef.current = null;
  }, [curEntry?.key]);

  const currentDetails = rawCur
    ? detailsByPlatform[rawCur.platformId] ?? incomingItemDetailsFromPayload(rawCur, platformName)
    : null;
  const cur = rawCur && currentDetails
    ? ({
        ...rawCur,
        title: currentDetails.title,
        imageUrl: currentDetails.imageUrl,
        description: currentDetails.description,
      } as SyncItem)
    : rawCur;
  const groupedItems = groupEntries.map((item) => {
    const details = detailsByPlatform[item.platformId] ?? incomingItemDetailsFromPayload(item, platformName);
    return { ...item, title: details.title, imageUrl: details.imageUrl } as SyncItem;
  });

  const commit = useCallback((choice: DeckChoice, canonicalId?: string) => {
    if (!rawCur || !curEntry || committedCardRef.current === curEntry.key) return;
    committedCardRef.current = curEntry.key;
    setInteracted(true);
    const decision: Decision = { item: rawCur, choice, canonicalId };
    setHistory((current) => {
      const next = current.slice(0, posRef.current);
      next[posRef.current] = decision;
      historyRef.current = next;
      return next;
    });
    setPos((current) => {
      const next = current + 1;
      posRef.current = next;
      return next;
    });
  }, [rawCur, curEntry]);

  const undo = useCallback(() => {
    setPos((current) => {
      const next = Math.max(0, current - 1);
      posRef.current = next;
      committedCardRef.current = null;
      return next;
    });
  }, []);

  const redo = useCallback(() => {
    setPos((current) => {
      if (!historyRef.current[current]) return current;
      const next = Math.min(total, current + 1);
      posRef.current = next;
      committedCardRef.current = null;
      return next;
    });
  }, [total]);

  const launchResolve = useCallback((decision: Decision) => {
    if (decision.choice === 'skip') return Promise.resolve();
    const platformId = decision.item.platformId;
    const savedDecision = decision as SavedDecision;
    const attempt = (outcomesRef.current[platformId]?.attempt ?? 0) + 1;
    decisionsRef.current[platformId] = savedDecision;
    outcomesRef.current[platformId] = { attempt, status: 'pending' };

    let tracked: Promise<void>;
    tracked = Promise.resolve()
      .then(() => resolve(platformId, savedDecision.choice, savedDecision.canonicalId))
      .then(() => {
        if (outcomesRef.current[platformId]?.attempt === attempt) {
          outcomesRef.current[platformId] = { attempt, status: 'success' };
        }
      })
      .catch((error) => {
        log.warn('resolve failed', platformId, error);
        if (outcomesRef.current[platformId]?.attempt === attempt) {
          outcomesRef.current[platformId] = { attempt, status: 'failed' };
        }
      })
      .finally(() => {
        if (pendingRef.current[platformId] === tracked) delete pendingRef.current[platformId];
      });
    pendingRef.current[platformId] = tracked;
    return tracked;
  }, [resolve]);

  const settleSaves = useCallback(async (pending: Promise<void>[]) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      Promise.all(pending).then(() => true),
      new Promise<boolean>((done) => {
        timer = setTimeout(() => done(false), 12000);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!settled) {
      for (const outcome of Object.values(outcomesRef.current)) {
        if (outcome.status === 'pending') outcome.status = 'failed';
      }
    }
    const failed = Object.values(outcomesRef.current).filter((outcome) => outcome.status !== 'success').length;
    setEnding(failed > 0 ? { kind: 'failed', count: failed } : { kind: 'done' });
  }, []);

  const saveDecisions = useCallback(() => {
    setEnding({ kind: 'waiting' });
    decisionsRef.current = {};
    outcomesRef.current = {};
    pendingRef.current = {};
    const pending = historyRef.current
      .filter((decision) => decision.choice !== 'skip')
      .map(launchResolve);
    if (pending.length === 0) {
      setEnding({ kind: 'done' });
      return;
    }
    void settleSaves(pending);
  }, [launchResolve, settleSaves]);

  const retryFailed = useCallback(() => {
    setEnding({ kind: 'waiting' });
    const failed = Object.keys(decisionsRef.current)
      .filter((platformId) => outcomesRef.current[platformId]?.status !== 'success')
      .map((platformId) => launchResolve(decisionsRef.current[platformId]));
    void settleSaves(failed);
  }, [launchResolve, settleSaves]);

  const tallyCounts = useCallback(() => {
    const counts = { linked: 0, created: 0, ignored: 0 };
    for (const [platformId, decision] of Object.entries(decisionsRef.current)) {
      if (outcomesRef.current[platformId]?.status !== 'success') continue;
      if (decision.choice === 'link') counts.linked += 1;
      else if (decision.choice === 'create') counts.created += 1;
      else if (decision.choice === 'ignore') counts.ignored += 1;
    }
    return counts;
  }, []);

  const chrome = useMemo(
    () => ({
      onUndo: undo,
      canUndo: pos > 0,
      onRedo: redo,
      canRedo: !!history[pos],
      onIgnore: () => commit('ignore'),
    }),
    [undo, redo, pos, history, commit],
  );

  if (!cur || !currentDetails || !curEntry) {
    if (ending.kind === 'waiting') {
      return (
        <View style={[styles.done, { paddingTop: topInset + 40 }]}>
          <ActivityIndicator color={RC.green} />
          <Text style={styles.doneSub}>Saving</Text>
        </View>
      );
    }
    if (ending.kind === 'failed') {
      return (
        <View style={[styles.done, { paddingTop: topInset + 40 }]}>
          <Text style={styles.doneTitle}>{ending.count} didn’t save</Text>
          <TouchableOpacity style={styles.doneBtn} activeOpacity={0.9} onPress={retryFailed}>
            <Text style={styles.doneBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (ending.kind === 'done') {
      return (
        <View style={[styles.done, { paddingTop: topInset + 40 }]}>
          <Text style={styles.doneTitle}>All caught up</Text>
          <TouchableOpacity style={styles.doneBtn} activeOpacity={0.9} onPress={() => onDone?.(tallyCounts())}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={[styles.review, { paddingTop: topInset + 40 }]}>
        <View style={styles.reviewCopy}>
          <Text style={styles.doneTitle}>Ready to save</Text>
          <Text style={styles.doneSub}>You can undo the last decision before saving.</Text>
        </View>
        <View style={styles.reviewBar}>
          <TouchableOpacity
            onPress={pos > 0 ? undo : undefined}
            disabled={pos === 0}
            style={[styles.circleBtn, pos === 0 && styles.circleBtnDim]}
          >
            <MaterialCommunityIcons name="undo-variant" size={20} color={pos > 0 ? RC.muted : RC.faint} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} activeOpacity={0.88} onPress={saveDecisions}>
            <Text style={styles.doneBtnText}>Save decisions</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled style={[styles.circleBtn, styles.circleBtnDim]}>
            <MaterialCommunityIcons name="redo-variant" size={20} color={RC.faint} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const candidates = cur.candidates ?? [];
  const hasCandidates = candidates.length > 0;
  const picked = picks[cur.platformId] ?? null;
  const primaryLabel = hasCandidates ? 'Link' : 'Add as new';
  const onPrimary = () => {
    if (hasCandidates) {
      if (picked) commit('link', picked);
    } else {
      commit('create');
    }
  };
  const onSkip = () => commit('skip');

  return (
    <DeckChrome.Provider value={chrome}>
      <SwipeLabelsContext.Provider value={{ right: primaryLabel, left: 'Skip', up: 'Ignore' }}>
        <TinderShell
          key={curEntry.key}
          idx={pos + 1}
          total={total}
          title={cur.title}
          onBack={() => onDone?.()}
          primary={primaryLabel}
          primaryReady={resolving !== cur.platformId && (!hasCandidates || !!picked)}
          alt="Skip"
          onPrimary={onPrimary}
          onAlt={onSkip}
          onIgnore={() => commit('ignore')}
          topInset={topInset}
          scroll
        >
          <DecisionCard
            item={cur}
            platformName={platformName}
            sourceLabel={currentDetails.sourceLabel}
            draftId={currentDetails.draftId}
            groupedItems={groupedItems}
            showHints={pos === 0 && !interacted}
            selectedId={picked}
            onSelect={(id) => setPicks((current) => ({ ...current, [cur.platformId]: id }))}
            onLink={onPrimary}
            onCreate={() => commit('create')}
            onSkip={onSkip}
            onIgnore={() => commit('ignore')}
            disabled={resolving === cur.platformId}
          />
        </TinderShell>
      </SwipeLabelsContext.Provider>
    </DeckChrome.Provider>
  );
}

const styles = StyleSheet.create({
  done: { flex: 1, alignItems: 'center', paddingHorizontal: 32, gap: 8 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: RC.ink, textAlign: 'center' },
  doneSub: { fontSize: 14, lineHeight: 20, color: RC.muted, textAlign: 'center' },
  doneBtn: {
    marginTop: 16, height: 50, borderRadius: 999, backgroundColor: RC.green,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40,
  },
  doneBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  review: { flex: 1, paddingHorizontal: 16, justifyContent: 'space-between', paddingBottom: 24 },
  reviewCopy: { alignItems: 'center', gap: 8 },
  reviewBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  circleBtn: {
    width: 54, height: 54, borderRadius: 27, borderWidth: 1.5, borderColor: RC.line,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  circleBtnDim: { opacity: 0.4 },
  saveBtn: {
    flex: 1, height: 54, borderRadius: 27, backgroundColor: RC.green,
    alignItems: 'center', justifyContent: 'center',
  },
});
