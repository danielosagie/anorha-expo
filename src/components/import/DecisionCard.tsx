// DecisionCard — the body that rides inside a TinderShell swipe card.
//
// The deck chrome (header, swipe stack, undo · secondary · primary · redo bar,
// drag-down-to-ignore) is TinderShell's. This is ONLY the content: the item's
// identity plus the one adaptive decision zone, driven by the SyncItem the
// async resolver already returns. Three shapes, one card:
//   • has candidates  → pick which of yours to link to (ResultRow radios)
//   • single strong    → the recommended match, pre-picked
//   • nothing matches  → a quiet "add as new" prompt
// The three outcomes (link / create / ignore) are wired by the deck, not here.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { SyncItem } from '../../types/syncItem';
import { RC, Thumb, PlatTag, ResultRow } from '../resolve/ResolveKit';

function money(v: string | number | null): string {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : '';
}

export default function DecisionCard({
  item,
  platformName,
  selectedId,
  onSelect,
}: {
  item: SyncItem;
  platformName?: string;
  /** Currently-picked candidate id (deck-owned so it survives re-render). */
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const candidates = item.candidates ?? [];
  // Confidence lives on the resolution's recommended link, not per-candidate —
  // show it only against the one the resolver actually recommended.
  const recId = item.resolution.kind === 'link' ? item.resolution.canonical.id : null;
  const recPct =
    item.resolution.kind === 'link' ? `${Math.round((item.resolution.confidence ?? 0) * 100)}%` : undefined;

  const meta = [item.sku, money(item.price)].filter(Boolean).join(' · ');

  return (
    <View style={styles.wrap}>
      {/* Identity — the incoming item */}
      <View style={styles.idRow}>
        <Thumb uri={item.imageUrl} size={56} radius={12} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          {!!meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
        </View>
        {!!platformName && <PlatTag name={platformName} />}
      </View>

      {candidates.length > 0 ? (
        <View style={styles.zone}>
          <Text style={styles.zoneLabel}>LINK TO ONE OF YOURS</Text>
          {candidates.map((c) => (
            <ResultRow
              key={c.id}
              on={selectedId === c.id}
              title={c.title ?? c.sku ?? 'Item'}
              sub={c.sku ?? undefined}
              hint={c.id === recId ? recPct : undefined}
              uri={c.imageUrl}
              onPress={() => onSelect(c.id)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.newPrompt}>
          <View style={styles.newIcon}>
            <Text style={styles.newPlus}>+</Text>
          </View>
          <Text style={styles.newText}>Nothing in your catalog matches this. Add it as a new product.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  title: { fontSize: 16, lineHeight: 20, fontWeight: '700', color: RC.ink },
  meta: { fontSize: 13, color: RC.muted, marginTop: 3 },
  zone: { gap: 8 },
  zoneLabel: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.6, color: RC.faint },
  newPrompt: {
    flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12,
    borderRadius: 12, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: RC.line, borderStyle: 'dashed',
  },
  newIcon: {
    width: 34, height: 34, borderRadius: 9, backgroundColor: '#fff',
    borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center',
  },
  newPlus: { fontSize: 20, color: RC.muted, lineHeight: 22 },
  newText: { flex: 1, fontSize: 13, lineHeight: 18, color: RC.muted },
});
