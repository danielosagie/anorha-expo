// DecisionCard — the body that rides inside a TinderShell swipe card.
//
// The deck chrome (header, swipe stack, undo · secondary · primary · redo bar,
// swipe-up-to-ignore) is TinderShell's. This is ONLY the content: the item's
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
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Image } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SyncItem, CanonicalRef } from '../../types/syncItem';
import { RC } from '../resolve/ResolveKit';
import CompareSheet from './CompareSheet';
import {
  fetchImportCandidateDetails,
  incomingItemDetailsFromPayload,
} from '../../lib/importCandidateDetails';
import { getPlatform } from '../../config/platforms';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';
import { createLogger } from '../../utils/logger';

const HIT = { top: 12, bottom: 12, left: 12, right: 12 };
const log = createLogger('DecisionCard');
const EMPTY_CANDIDATES: CanonicalRef[] = [];

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
  sourceLabel,
  draftId,
  groupedItems = [],
  showHints = false,
  selectedId,
  onSelect,
  onLink,
  onCreate,
  onSkip,
  onIgnore,
  disabled = false,
}: {
  item: SyncItem;
  platformName?: string;
  sourceLabel: string;
  draftId?: string | null;
  groupedItems?: SyncItem[];
  showHints?: boolean;
  /** Currently-picked candidate id (deck-owned so it survives re-render). */
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLink: () => void;
  onCreate: () => void;
  onSkip: () => void;
  onIgnore: () => void;
  disabled?: boolean;
}) {
  const thinCandidates = item.candidates ?? EMPTY_CANDIDATES;
  const [candidateDetails, setCandidateDetails] = useState<Record<string, CanonicalRef>>({});

  // Resolution candidates are intentionally thin. A product created moments ago
  // by another import can arrive with only its canonical id, so hydrate display
  // fields and its source mapping before drawing the candidate card.
  useEffect(() => {
    let alive = true;
    const ids = thinCandidates.map((candidate) => candidate.id).filter(Boolean);
    if (ids.length === 0) {
      setCandidateDetails({});
      return;
    }

    void (async () => {
      try {
        const next = await fetchImportCandidateDetails(ids, platformName);
        if (alive) setCandidateDetails(next);
      } catch (error) {
        log.warn('candidate hydration failed', error);
      }
    })();

    return () => {
      alive = false;
    };
  }, [item.platformId, platformName, thinCandidates]);

  const candidates = useMemo(
    () => thinCandidates.map((candidate) => ({ ...candidate, ...candidateDetails[candidate.id] })),
    [thinCandidates, candidateDetails],
  );

  const meta = [item.sku && !/^DRAFT(?:\s*[-_]|\s)/i.test(item.sku) ? item.sku : null, money(item.price)]
    .filter(Boolean)
    .join(' · ');
  const hasCandidates = candidates.length > 0;
  const canLink = hasCandidates && !!selectedId && !disabled;
  const inspectableGroup = groupedItems.length > 1 ? groupedItems : [];

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
      {showHints ? (
        <Animated.View exiting={FadeOut.duration(160)} style={styles.hints} pointerEvents="none">
          <Text style={styles.hintText}>← Skip</Text>
          <Text style={styles.hintText}>↑ Ignore</Text>
          <Text style={styles.hintText}>{hasCandidates ? 'Link →' : 'Add →'}</Text>
        </Animated.View>
      ) : null}

      <View style={styles.actionGrid}>
        {hasCandidates ? (
          <Pressable
            accessibilityRole="button"
            disabled={!canLink}
            onPress={onLink}
            style={({ pressed }) => [styles.action, styles.actionPrimary, (!canLink || pressed) && styles.actionDim]}
          >
            <Text style={styles.actionPrimaryText}>Link</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onCreate}
            style={({ pressed }) => [styles.action, styles.actionPrimary, (disabled || pressed) && styles.actionDim]}
          >
            <Text style={styles.actionPrimaryText}>Add as new</Text>
          </Pressable>
        )}
        {hasCandidates ? (
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onCreate}
            style={({ pressed }) => [styles.action, (disabled || pressed) && styles.actionDim]}
          >
            <Text style={styles.actionText}>New</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={onSkip}
          style={({ pressed }) => [styles.action, (disabled || pressed) && styles.actionDim]}
        >
          <Text style={styles.actionText}>Skip</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={onIgnore}
          style={({ pressed }) => [styles.action, styles.actionIgnore, (disabled || pressed) && styles.actionDim]}
        >
          <Text style={styles.actionIgnoreText}>Ignore</Text>
        </Pressable>
      </View>

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
        <Text style={styles.from} numberOfLines={1}>From {sourceLabel}</Text>
        {!!draftId && <Text style={styles.draftId} numberOfLines={1}>{draftId}</Text>}
        {!!meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
      </TouchableOpacity>

      {inspectableGroup.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>{inspectableGroup.length} grouped rows</Text>
          {inspectableGroup.map((row) => {
            const details = incomingItemDetailsFromPayload(row, platformName);
            const rowMeta = [row.sku && !/^DRAFT(?:\s*[-_]|\s)/i.test(row.sku) ? row.sku : null, money(row.price)]
              .filter(Boolean)
              .join(' · ');
            return (
              <View key={row.platformId} style={styles.groupRow}>
                <ProductImage uri={details.imageUrl} imgStyle={styles.groupImage} emptyStyle={styles.imgEmpty} iconSize={15} />
                <View style={styles.groupCopy}>
                  <Text style={styles.groupTitle} numberOfLines={1}>{details.title}</Text>
                  {!!rowMeta && <Text style={styles.groupMeta} numberOfLines={1}>{rowMeta}</Text>}
                </View>
              </View>
            );
          })}
        </View>
      ) : item.attention !== 'look_alike_group' && item.reason ? (
        <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text>
      ) : null}

      {candidates.length > 0 ? (
        <View style={styles.zone}>
          <Text style={styles.zoneLabel}>LINK TO ONE OF YOURS</Text>
          <View style={styles.grid}>
            {candidates.map((c) => {
              const on = selectedId === c.id;
              const title = c.title || c.sku || c.id;
              const detail = [c.sku || (!c.title ? c.id : null), money(c.price ?? null)].filter(Boolean).join(' · ');
              const source = c.sourcePlatform
                ? getPlatform(c.sourcePlatform)?.label ?? c.sourcePlatform
                : 'your catalog';
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
                    {title}
                  </Text>
                  <Text style={styles.candSource} numberOfLines={1}>From {source}</Text>
                  {!!detail && <Text style={styles.candSku} numberOfLines={1}>{detail}</Text>}
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
        platformName={sourceLabel}
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
  hints: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, opacity: 0.72 },
  hintText: { fontSize: 11.5, fontWeight: '600', color: RC.faint },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    minHeight: 38, minWidth: 72, flexGrow: 1, borderRadius: 19, borderWidth: 1,
    borderColor: RC.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionPrimary: { backgroundColor: RC.green, borderColor: RC.green },
  actionPrimaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  actionText: { fontSize: 13, fontWeight: '700', color: RC.muted },
  actionIgnore: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  actionIgnoreText: { fontSize: 13, fontWeight: '700', color: '#991B1B' },
  actionDim: { opacity: 0.5 },

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
  draftId: { fontSize: 11.5, color: RC.faint, marginTop: 2 },
  meta: { fontSize: 13, color: RC.muted, marginTop: 2 },

  // Why we're being asked
  reason: { fontSize: 12.5, lineHeight: 17, color: RC.muted, marginTop: -2 },
  group: { gap: 7, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: RC.line, backgroundColor: RC.surface },
  groupLabel: { fontSize: 11.5, fontWeight: '700', color: RC.faint, letterSpacing: 0.4, textTransform: 'uppercase' },
  groupRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 9 },
  groupImage: { width: 36, height: 36, borderRadius: 8, backgroundColor: RC.surface2 },
  groupCopy: { flex: 1, minWidth: 0 },
  groupTitle: { fontSize: 12.5, fontWeight: '600', color: RC.ink },
  groupMeta: { fontSize: 11.5, color: RC.muted, marginTop: 1 },

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
  candTitle: { fontSize: 13.5, fontFamily: CHAT_FONT.bold, color: CHAT_COLORS.ink, lineHeight: 18 },
  candSource: { fontSize: 12, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.dim, marginTop: -3 },
  candSku: { fontSize: 12, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.dim, marginTop: -4 },

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
