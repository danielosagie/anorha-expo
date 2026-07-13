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
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
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
  // Latest decision per item (keyed by platformId) so re-deciding after an undo
  // OVERWRITES rather than double-counts. Tallied once on done.
  const decisionsRef = useRef<Record<string, ResolveChoice>>({});

  const cur = deck[pos];

  const commit = useCallback(
    (choice: ResolveChoice, canonicalId?: string) => {
      if (!cur) return;
      decisionsRef.current[cur.platformId] = choice;
      void resolve(cur.platformId, choice, canonicalId);
      setPos((p) => p + 1);
    },
    [cur, resolve],
  );

  const tallyCounts = useCallback(() => {
    const c = { linked: 0, created: 0, ignored: 0 };
    for (const v of Object.values(decisionsRef.current)) {
      if (v === 'link') c.linked += 1;
      else if (v === 'create') c.created += 1;
      else if (v === 'ignore') c.ignored += 1;
    }
    return c;
  }, []);

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

  // Deck exhausted → hand back to the parent (its "all set" state).
  if (!cur) {
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
