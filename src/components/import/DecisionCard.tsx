// DecisionCard — the body that rides inside a TinderShell swipe card.
//
// The deck chrome (header, swipe stack, undo · secondary · primary · redo bar,
// drag-down-to-ignore) is TinderShell's. This is ONLY the content: the item's
// identity plus the one adaptive decision zone, driven by the SyncItem the
// async resolver already returns. Three shapes, one card:
//   • has candidates  → pick which of yours to link to (candidate grid)
//   • single strong    → the recommended match, pre-picked
//   • nothing matches  → a quiet "add as new" prompt
// The three outcomes (link / create / ignore) are wired by the deck, not here.
//
// Vertical presentation: the incoming item leads with a large image on TOP
// (the card's own title already sits above this body in TinderShell, so it is
// NOT repeated here), then a muted 'from {platform}' caption and a SKU · price
// line. Candidates render as a 2-up grid of vertical cards, not horizontal rows.
//
// Depth-on-demand: the incoming block is tappable to open a single-column
// CompareSheet; every candidate card selects on body tap (radio contract) while
// a trailing info icon (a separate hit target) opens that candidate's
// side-by-side. Taps clear SwipeCard's pan thresholds, so neither affordance
// fights the swipe or the select.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SyncItem, CanonicalRef } from '../../types/syncItem';
import { RC } from '../resolve/ResolveKit';
import CompareSheet from './CompareSheet';

const HIT = { top: 12, bottom: 12, left: 12, right: 12 };

function money(v: string | number | null): string {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : '';
}

// Product image — fills the width its container gives it (the incoming block is
// 4:3, a candidate is square), with a graceful hatched placeholder when there's
// no image. `imgStyle` carries the size/aspect/radius; `emptyStyle` adds the
// placeholder border + centering.
function ProductImage({
  uri,
  imgStyle,
  emptyStyle,
  iconSize,
}: {
  uri?: string | null;
  imgStyle: any;
  emptyStyle: any;
  iconSize: number;
}) {
  if (uri) return <Image source={{ uri }} style={imgStyle} resizeMode="cover" />;
  return (
    <View style={[imgStyle, emptyStyle]}>
      <MaterialCommunityIcons name="image-outline" size={iconSize} color={RC.faint} />
    </View>
  );
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
      {/* INCOMING — large image on top; tap the block (or ⓘ) for full detail.
          The big product title lives in the card header above, so it is not
          repeated here; only the source caption + meta ride under the image. */}
      <TouchableOpacity activeOpacity={0.85} onPress={openIncoming} style={styles.incoming}>
        <View style={styles.incomingImgWrap}>
          <ProductImage uri={item.imageUrl} imgStyle={styles.bigImg} emptyStyle={styles.imgEmpty} iconSize={40} />
          <View style={styles.infoChip} pointerEvents="none">
            <MaterialCommunityIcons name="information-outline" size={18} color={RC.muted} />
          </View>
        </View>
        {!!platformName && <Text style={styles.from} numberOfLines={1}>from {platformName}</Text>}
        {!!meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
      </TouchableOpacity>

      {/* Why we're being asked (e.g. "Two close matches in your catalog") */}
      {!!item.reason && <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text>}

      {candidates.length > 0 ? (
        <View style={styles.zone}>
          <Text style={styles.zoneLabel}>LINK TO ONE OF YOURS</Text>
          <View style={styles.grid}>
            {candidates.map((c) => {
              const on = selectedId === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  activeOpacity={0.85}
                  onPress={() => onSelect(c.id)}
                  style={[styles.cand, on && styles.candOn]}
                >
                  <View style={styles.candImgWrap}>
                    <ProductImage uri={c.imageUrl} imgStyle={styles.candImg} emptyStyle={styles.imgEmpty} iconSize={22} />
                    {on && (
                      <View style={styles.candCheck}>
                        <MaterialCommunityIcons name="check" size={14} color="#fff" />
                      </View>
                    )}
                    {/* Separate hit target — opens the side-by-side, does NOT select */}
                    <TouchableOpacity
                      onPress={() => openCandidate(c)}
                      hitSlop={HIT}
                      activeOpacity={0.6}
                      style={styles.candInfo}
                    >
                      <MaterialCommunityIcons name="information-outline" size={17} color={RC.muted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.candTitle, on && { color: RC.greenInk }]} numberOfLines={2}>
                    {c.title ?? c.sku ?? 'Item'}
                  </Text>
                  {!!c.sku && <Text style={styles.candSku} numberOfLines={1}>{c.sku}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
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
  wrap: { gap: 14 },

  // Incoming — image-led, vertical
  incoming: {},
  incomingImgWrap: { position: 'relative', width: '100%' },
  bigImg: { width: '100%', aspectRatio: 4 / 3, borderRadius: 16, backgroundColor: RC.surface2 },
  imgEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: RC.line },
  infoChip: {
    position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: RC.line,
    alignItems: 'center', justifyContent: 'center',
  },
  from: { fontSize: 13, color: RC.muted, marginTop: 10 },
  meta: { fontSize: 13, color: RC.muted, marginTop: 2 },

  // Why we're being asked
  reason: { fontSize: 12.5, lineHeight: 17, color: RC.muted, marginTop: -2 },

  // Candidate grid — 2-up vertical cards (1 → single wider card, >2 → wraps)
  zone: { gap: 10 },
  zoneLabel: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.6, color: RC.faint },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cand: {
    flexBasis: '47%', flexGrow: 1, minWidth: 0,
    borderWidth: 1.5, borderColor: RC.line, borderRadius: 14, backgroundColor: '#fff', padding: 8, gap: 7,
  },
  candOn: { borderColor: RC.green, backgroundColor: RC.greenSoft },
  candImgWrap: { position: 'relative', width: '100%' },
  candImg: { width: '100%', aspectRatio: 1, borderRadius: 9, backgroundColor: RC.surface2 },
  candCheck: {
    position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: RC.green, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  candInfo: {
    position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: RC.line,
    alignItems: 'center', justifyContent: 'center',
  },
  candTitle: { fontSize: 13.5, fontWeight: '700', color: RC.ink, lineHeight: 18 },
  candSku: { fontSize: 12, color: RC.muted, marginTop: -3 },

  // Add-as-new (no candidate) — keeps the same image-led incoming block above
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
