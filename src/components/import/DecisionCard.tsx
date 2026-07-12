// DecisionCard — the body that rides inside a TinderShell swipe card.
//
// The deck chrome (header, swipe stack, undo · secondary · primary · redo bar,
// drag-down-to-ignore) is TinderShell's. This is ONLY the content: the item's
// identity plus the one adaptive decision zone, driven by the SyncItem the
// async resolver already returns. Three shapes, one card:
//   • has candidates  → pick which of yours to link to (candidate rows)
//   • single strong    → the recommended match, pre-picked
//   • nothing matches  → a quiet "add as new" prompt
// The three outcomes (link / create / ignore) are wired by the deck, not here.
//
// Depth-on-demand: the incoming row and every candidate row are tappable to open
// a CompareSheet — the row BODY still selects the pick (radio contract), while a
// trailing info icon (a separate hit target) opens the detail/side-by-side. Taps
// clear SwipeCard's pan thresholds (16px horizontal / 70px down), so neither
// affordance fights the swipe or the select — the same reason the row-body
// select has always worked inside the deck.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SyncItem, CanonicalRef } from '../../types/syncItem';
import { RC, Thumb, PlatTag, Row, Check, resolveStyles } from '../resolve/ResolveKit';
import CompareSheet from './CompareSheet';

const HIT = { top: 12, bottom: 12, left: 12, right: 12 };

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

  // Compare sheet — null candidate = single-column detail of the incoming item.
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareCandidate, setCompareCandidate] = useState<CanonicalRef | null>(null);
  const openIncoming = () => {
    setCompareCandidate(null);
    setCompareOpen(true);
  };
  const openCandidate = (c: CanonicalRef) => {
    setCompareCandidate(c);
    setCompareOpen(true);
  };

  return (
    <View style={styles.wrap}>
      {/* Identity — the incoming item; tap anywhere (or the ⓘ) to see full detail */}
      <TouchableOpacity activeOpacity={0.7} onPress={openIncoming} style={styles.idRow}>
        <Thumb uri={item.imageUrl} size={56} radius={12} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          {!!meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
        </View>
        {!!platformName && <PlatTag name={platformName} />}
        <MaterialCommunityIcons name="information-outline" size={18} color={RC.faint} />
      </TouchableOpacity>

      {/* Why we're being asked (e.g. "Two close matches in your catalog") */}
      {!!item.reason && <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text>}

      {candidates.length > 0 ? (
        <View style={styles.zone}>
          <Text style={styles.zoneLabel}>LINK TO ONE OF YOURS</Text>
          {candidates.map((c) => {
            const on = selectedId === c.id;
            return (
              <Row key={c.id} active={on} onPress={() => onSelect(c.id)}>
                <Check on={on} size={18} />
                <Thumb uri={c.imageUrl} size={30} radius={7} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={resolveStyles.rowTitle} numberOfLines={1}>{c.title ?? c.sku ?? 'Item'}</Text>
                  {!!c.sku && <Text style={resolveStyles.rowMeta} numberOfLines={1}>{c.sku}</Text>}
                </View>
                {c.id === recId && !!recPct && (
                  <Text style={[resolveStyles.hint, { color: on ? RC.greenDark : RC.faint }]}>{recPct}</Text>
                )}
                {/* Separate hit target — opens the side-by-side, does NOT select */}
                <TouchableOpacity
                  onPress={() => openCandidate(c)}
                  hitSlop={HIT}
                  activeOpacity={0.6}
                  style={styles.infoBtn}
                >
                  <MaterialCommunityIcons name="information-outline" size={19} color={RC.faint} />
                </TouchableOpacity>
              </Row>
            );
          })}
          <Text style={styles.tapHint}>Tap a row to pick · tap ⓘ to compare side-by-side</Text>
        </View>
      ) : (
        <View style={styles.newPrompt}>
          <View style={styles.newIcon}>
            <Text style={styles.newPlus}>+</Text>
          </View>
          <Text style={styles.newText}>Nothing in your catalog matches this. Add it as a new product.</Text>
        </View>
      )}

      <CompareSheet
        visible={compareOpen}
        onClose={() => setCompareOpen(false)}
        incoming={item}
        candidate={compareCandidate}
        platformName={platformName}
        onLink={(id) => {
          onSelect(id);
          setCompareOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  title: { fontSize: 16, lineHeight: 20, fontWeight: '700', color: RC.ink },
  meta: { fontSize: 13, color: RC.muted, marginTop: 3 },
  reason: { fontSize: 12.5, lineHeight: 17, color: RC.muted, marginTop: -2 },
  zone: { gap: 8 },
  zoneLabel: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.6, color: RC.faint },
  infoBtn: { paddingLeft: 2, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tapHint: { fontSize: 11, color: RC.faint, marginTop: 1 },
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
