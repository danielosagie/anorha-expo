// MatchReviewDeck — the revived Match deck, driven by the async resolver.
//
// Same chrome the old deck had (TinderShell: header · swipe stack · undo ·
// secondary · primary · redo · drag-down-to-ignore) — the ONLY thing that
// changed is what rides inside each card: a DecisionCard over one `SyncItem`.
// The three outcomes the async inbox exposes map straight onto the bar:
//   primary   → link (to the picked candidate)  ·  or "Add as new" when nothing matches
//   secondary → New (create)                    ·  hidden when there's nothing to link to
//   ignore    → drag the card down              ·  resolve('ignore')
// Decisions commit per-card via resolve(); undo steps back so you can re-decide
// (a re-decision overwrites server-side). Redo is intentionally inert for now.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import type { SyncItem, ResolveChoice } from '../../types/syncItem';
import { TinderShell, DeckChrome, RC } from '../resolve/ResolveKit';
import DecisionCard from './DecisionCard';

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
  // Optional session tally so the caller can show a real ending ("X linked ·
  // Y added · Z ignored"). Called with no arg when the user backs out mid-deck.
  onDone?: (sessionCounts?: { linked: number; created: number; ignored: number }) => void;
  topInset?: number;
}) {
  // Snapshot the queue ONCE so the resolver optimistically removing items
  // doesn't reshuffle the stack under the user's thumb. New scans remount.
  const [deck] = useState<SyncItem[]>(() => items);
  const total = deck.length;
  const [pos, setPos] = useState(0);
  // Picked candidate per item — pre-seeded to the resolver's recommendation so
  // the primary button is always ready without an extra tap.
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of deck) {
      const rec = it.resolution.kind === 'link' ? it.resolution.canonical.id : null;
      const first = it.candidates?.[0]?.id;
      const seed = rec ?? first;
      if (seed) m[it.platformId] = seed;
    }
    return m;
  });
  type Decision = { choice: ResolveChoice; canonicalId?: string };
  type Outcome = { attempt: number; status: 'pending' | 'success' | 'failed' };

  // Latest decision and outcome per item. Attempt tokens keep a slow, older
  // re-decision from overwriting the result of the choice the user saw last.
  const decisionsRef = useRef<Record<string, Decision>>({});
  const outcomesRef = useRef<Record<string, Outcome>>({});
  const pendingRef = useRef<Record<string, Promise<void>>>({});
  const [ending, setEnding] = useState<{ kind: 'waiting' | 'done' | 'failed'; count?: number }>({ kind: 'waiting' });

  const cur = deck[pos];

  const launchResolve = useCallback((platformId: string, decision: Decision) => {
    const attempt = (outcomesRef.current[platformId]?.attempt ?? 0) + 1;
    decisionsRef.current[platformId] = decision;
    outcomesRef.current[platformId] = { attempt, status: 'pending' };

    let tracked: Promise<void>;
    tracked = Promise.resolve()
      .then(() => resolve(platformId, decision.choice, decision.canonicalId))
      .then(() => {
        if (outcomesRef.current[platformId]?.attempt === attempt) {
          outcomesRef.current[platformId] = { attempt, status: 'success' };
        }
      })
      .catch(() => {
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

  const commit = useCallback((choice: ResolveChoice, canonicalId?: string) => {
    if (!cur) return;
    void launchResolve(cur.platformId, { choice, canonicalId });
    setPos((p) => p + 1);
  }, [cur, launchResolve]);

  const tallyCounts = useCallback(() => {
    const c = { linked: 0, created: 0, ignored: 0 };
    for (const [platformId, decision] of Object.entries(decisionsRef.current)) {
      if (outcomesRef.current[platformId]?.status !== 'success') continue;
      if (decision.choice === 'link') c.linked += 1;
      else if (decision.choice === 'create') c.created += 1;
      else if (decision.choice === 'ignore') c.ignored += 1;
    }
    return c;
  }, []);

  const settleEnding = useCallback(async () => {
    setEnding({ kind: 'waiting' });
    const pending = Object.values(pendingRef.current);
    if (pending.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([
        Promise.all(pending).then(() => true),
        new Promise<boolean>((done) => { timer = setTimeout(() => done(false), 10000); }),
      ]);
      if (timer) clearTimeout(timer);
      if (!settled) {
        for (const outcome of Object.values(outcomesRef.current)) {
          if (outcome.status === 'pending') outcome.status = 'failed';
        }
      }
    }

    const failed = Object.values(outcomesRef.current).filter((outcome) => outcome.status !== 'success').length;
    setEnding(failed > 0 ? { kind: 'failed', count: failed } : { kind: 'done' });
  }, []);

  useEffect(() => {
    if (pos >= total) void settleEnding();
  }, [pos, total, settleEnding]);

  const retryFailed = useCallback(async () => {
    const failedIds = Object.keys(decisionsRef.current).filter(
      (platformId) => outcomesRef.current[platformId]?.status !== 'success',
    );
    setEnding({ kind: 'waiting' });
    for (const platformId of failedIds) {
      void launchResolve(platformId, decisionsRef.current[platformId]);
    }
    await settleEnding();
  }, [launchResolve, settleEnding]);

  const undo = useCallback(() => setPos((p) => Math.max(0, p - 1)), []);

  const chrome = useMemo(
    () => ({
      onUndo: undo,
      canUndo: pos > 0,
      onRedo: undefined,
      canRedo: false,
      onIgnore: () => commit('ignore'),
    }),
    [undo, pos, commit],
  );

  // Deck exhausted: hold the ending until every optimistic swipe is confirmed.
  if (!cur) {
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

    return (
      <View style={[styles.done, { paddingTop: topInset + 40 }]}>
        <Text style={styles.doneTitle}>All caught up</Text>
        <Text style={styles.doneSub}>Every flagged item is sorted. Everything else matched on its own.</Text>
        <TouchableOpacity style={styles.doneBtn} activeOpacity={0.9} onPress={() => onDone?.(tallyCounts())}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const candidates = cur.candidates ?? [];
  const hasCandidates = candidates.length > 0;
  const picked = picks[cur.platformId] ?? null;

  // Bar labels/actions, adapted from the item's shape.
  const primaryLabel = hasCandidates ? (candidates.length > 1 ? 'Link this one' : 'Link') : 'Add as new';
  const onPrimary = () => (hasCandidates && picked ? commit('link', picked) : commit('create'));
  const altLabel = hasCandidates ? 'New' : undefined;
  const onAlt = hasCandidates ? () => commit('create') : undefined;

  return (
    <DeckChrome.Provider value={chrome}>
      <TinderShell
        idx={pos + 1}
        total={total}
        title={cur.title}
        onBack={() => onDone?.()}
        primary={primaryLabel}
        primaryReady={resolving !== cur.platformId}
        alt={altLabel}
        onPrimary={onPrimary}
        onAlt={onAlt}
        onIgnore={() => commit('ignore')}
        topInset={topInset}
        scroll
      >
        <DecisionCard
          item={cur}
          platformName={platformName}
          selectedId={picked}
          onSelect={(id) => setPicks((m) => ({ ...m, [cur.platformId]: id }))}
        />
      </TinderShell>
    </DeckChrome.Provider>
  );
}

const styles = StyleSheet.create({
  done: { flex: 1, alignItems: 'center', paddingHorizontal: 32, gap: 8 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: RC.ink },
  doneSub: { fontSize: 14, lineHeight: 20, color: RC.muted, textAlign: 'center' },
  doneBtn: {
    marginTop: 16, height: 50, borderRadius: 999, backgroundColor: RC.green,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40,
  },
  doneBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
