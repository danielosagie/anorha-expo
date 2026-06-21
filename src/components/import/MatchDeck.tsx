// MatchDeck — the Match review. One card at a time, with full undo/redo and a
// single searchable "All items" view (no tabs, no bottom sheets).
//
// Snapshots the live mapping suggestions into a deck via classifyMatch(), renders
// one MatchResolver card at a time (Create · Split/Merge · Verify · Match · Ignore),
// and writes every decision back onto the suggestions (persisted by the session
// hook's /draft-mappings). You can undo/redo back and forth through every decision,
// or pop into the All-items view to search, filter, jump, or undo any one.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList, Image, TextInput, Dimensions, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { MappingSuggestion } from '../../types/importSession';
import { classifyMatch, applyMatchDecision } from '../resolve/classifyMatch';
import {
  MatchResolver,
  MatchCase,
  CandidateItem,
  Decision,
  ResolveMeta,
  cardBadgeFor,
} from '../resolve/matchResolvers';
import { RC, ResolveActions, DeckChrome } from '../resolve/ResolveKit';
import ResolveComposer, { ComposerMode, ComposerResult, ComposerField } from './ResolveComposer';
import AppMenu from '../ui/AppMenu';
import InventoryListCard from '../InventoryListCard';
import { usePlatformConnections } from '../../context/PlatformConnectionsContext';
import { getPlatform } from '../../config/platforms';

const SCREEN_W = Dimensions.get('window').width;

interface MatchDeckProps {
  theme: any;
  insets: { top: number; bottom: number; left: number; right: number };
  suggestions: MappingSuggestion[];
  platformName?: string;
  setSuggestions: React.Dispatch<React.SetStateAction<MappingSuggestion[] | null>>;
  onClose: () => void;
  onCommit: () => void;
}

const money = (n?: number | string | null): string => {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  return typeof v === 'number' && !Number.isNaN(v) && v > 0 ? `$${v.toFixed(2)}` : '—';
};

// Apply one resolver's decision to a single suggestion it owns.
function resolveSuggestion(
  s: MappingSuggestion,
  cur: MatchCase,
  decision: Decision,
  meta?: ResolveMeta,
): MappingSuggestion {
  const id = s.platformProduct.id;
  if (meta?.linkTo) {
    return {
      ...s,
      action: 'LINK_EXISTING',
      isSelected: true,
      resolved: true,
      suggestedCanonicalProduct: {
        id: meta.linkTo.id,
        sku: meta.linkTo.sku || '',
        title: meta.linkTo.title,
        price: typeof meta.linkTo.price === 'number' ? meta.linkTo.price : undefined,
        imageUrl: meta.linkTo.uri ?? null,
      },
    };
  }
  if (meta?.ignore) return { ...s, action: 'IGNORE', isSelected: false, resolved: true };
  if (meta?.selectedIds) {
    const inSel = meta.selectedIds.includes(id);
    switch (cur.kind) {
      case 'orphans':
        return inSel
          ? { ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true }
          : { ...s, action: 'IGNORE', isSelected: false, resolved: true };
      case 'consolidate':
      case 'variants':
        return inSel
          ? { ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true }
          : { ...s, action: 'CREATE_NEW', isSelected: true, resolved: true };
      case 'align':
        return inSel ? { ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true } : { ...s, resolved: true };
      case 'fuzzy':
        return inSel ? { ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true } : s;
      default:
        return applyMatchDecision(s, cur.kind, inSel ? 'primary' : 'alt');
    }
  }
  if (meta?.unlink) return { ...s, action: 'IGNORE', isSelected: false, resolved: true };
  return applyMatchDecision(s, cur.kind, decision);
}

type Status = { key: 'review' | 'linked' | 'new' | 'ignored' | 'catalog'; label: string; tone: 'review' | 'ok' | 'ignored' | 'catalog' };
function statusOf(s: MappingSuggestion): Status {
  // Catalog items the import didn't return aren't a "decision" — they sit in
  // their own bucket so they never inflate the review queue or pop up as a card.
  if (s.direction === 'anorha_to_platform' && !s.resolved) return { key: 'catalog', label: 'Incoming catalog', tone: 'catalog' };
  if (!s.resolved) return { key: 'review', label: 'Needs review', tone: 'review' };
  if (s.action === 'IGNORE') return { key: 'ignored', label: 'Ignored', tone: 'ignored' };
  if (s.action === 'CREATE_NEW') return { key: 'new', label: 'Added new', tone: 'ok' };
  return { key: 'linked', label: 'Linked', tone: 'ok' };
}
const STATUS_COLOR: Record<Status['tone'], string> = { review: '#B45309', ok: '#4A7C00', ignored: '#6B7280', catalog: '#0E7490' };

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'review', label: 'Needs review' },
  { key: 'linked', label: 'Linked' },
  { key: 'new', label: 'New' },
  { key: 'catalog', label: 'Incoming catalog' },
  { key: 'ignored', label: 'Ignored' },
];

// The deck is the real match decisions — never the bulk "313 catalog items not in
// this import" card (orphans). Those live only in the All-items view ("In catalog").
const buildDeck = (sugs: MappingSuggestion[], platform?: string): MatchCase[] => {
  // The swipe deck is ONLY for items that genuinely need a human decision. Already-
  // linked items and "incoming catalog" (the seller's existing inventory, pulled in
  // just so the matcher has something to match against) are not review work — they
  // live in the All-items view. So keep a case only if it still contains an item that
  // needs review; otherwise the deck balloons with hundreds of auto-handled items.
  const reviewIds = new Set(
    sugs.filter((s) => statusOf(s).key === 'review').map((s) => s.platformProduct.id),
  );
  return classifyMatch(sugs as any, platform).cases.filter(
    (c) =>
      c.kind !== 'orphan' &&
      c.kind !== 'orphans' &&
      (c.itemIds || []).some((id) => reviewIds.has(id)),
  );
};

const MatchDeck: React.FC<MatchDeckProps> = ({
  theme,
  insets,
  suggestions,
  platformName,
  setSuggestions,
  onClose,
  onCommit,
}) => {
  const [deck, setDeck] = useState<MatchCase[]>(() => buildDeck(suggestions, platformName));
  const [idx, setIdx] = useState(0);
  // Undo/redo: full back-and-forth through every decision.
  const [past, setPast] = useState<MappingSuggestion[][]>([]);
  const [future, setFuture] = useState<MappingSuggestion[][]>([]);
  const total = deck.length;

  // Platforms the user's anorha account currently has connected (canonical keys,
  // e.g. 'ebay','shopify'). A LINKED item is an anorha-managed product, so its
  // card shows the anorha mark + every connected channel — not just the single
  // import source. (Per-product channel membership isn't in the import payload yet.)
  const { connections } = usePlatformConnections();
  const accountPlatformKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections || []) {
      if (c?.IsEnabled === false) continue;
      const def = getPlatform(c?.PlatformType);
      if (def) set.add(def.key);
    }
    return Array.from(set);
  }, [connections]);
  // The single import-source platform (this connection), as a canonical key.
  const sourcePlatformKey = useMemo(() => getPlatform(platformName)?.key ?? null, [platformName]);

  // Live remaining cases — drives counts, the all-items "open", and re-decking.
  const remainingLive = useMemo(
    () => buildDeck(suggestions, platformName),
    [suggestions, platformName],
  );

  // Record a change so it can be undone; clears the redo stack. Caps history so
  // a huge import with thousands of decisions can't grow the stack unbounded.
  const applyChange = useCallback(
    (updated: MappingSuggestion[]) => {
      setPast((p) => [...p, suggestions].slice(-100));
      setFuture([]);
      setSuggestions(updated);
    },
    [suggestions, setSuggestions],
  );

  // Catalog index for find/relink search.
  const catalog = useMemo<CandidateItem[]>(() => {
    const seen = new Set<string>();
    const out: CandidateItem[] = [];
    for (const s of suggestions) {
      const c = s.suggestedCanonicalProduct;
      if (c?.id && !seen.has(c.id)) {
        seen.add(c.id);
        out.push({ id: c.id, title: c.title || 'Item', sub: [c.sku, money(c.price)].filter((x) => x && x !== '—').join(' · ') || undefined, uri: c.imageUrl, sku: c.sku || null, price: typeof c.price === 'number' ? c.price : null });
      }
      const v = s.anorhaVariant;
      if (v?.id && !seen.has(v.id)) {
        seen.add(v.id);
        out.push({ id: v.id, title: v.title || 'Item', sub: [v.sku, money(v.price)].filter((x) => x && x !== '—').join(' · ') || undefined, uri: v.imageUrl, sku: v.sku || null, price: typeof v.price === 'number' ? v.price : null });
      }
    }
    return out;
  }, [suggestions]);

  const searchCatalog = useCallback(
    (q: string): CandidateItem[] => {
      const qq = q.trim().toLowerCase();
      if (!qq) return [];
      return catalog.filter((c) => c.title.toLowerCase().includes(qq) || (c.sub || '').toLowerCase().includes(qq) || (c.sku || '').toLowerCase().includes(qq)).slice(0, 30);
    },
    [catalog],
  );

  const advanceAfter = useCallback(
    (updated: MappingSuggestion[]) => {
      if (idx + 1 < deck.length) {
        setIdx(idx + 1);
        return;
      }
      const next = buildDeck(updated, platformName);
      if (next.length > 0) {
        setDeck(next);
        setIdx(0);
      } else {
        onCommit();
      }
    },
    [idx, deck.length, platformName, onCommit],
  );

  const handleResolve = useCallback(
    (decision: Decision, meta?: ResolveMeta) => {
      const c = deck[idx];
      let updated = suggestions;
      if (c) {
        const ids = new Set(c.itemIds || []);
        if (ids.size > 0) {
          updated = suggestions.map((s) => (ids.has(s.platformProduct.id) ? resolveSuggestion(s, c, decision, meta) : s));
          applyChange(updated);
        }
      }
      advanceAfter(updated);
    },
    [deck, idx, suggestions, applyChange, advanceAfter],
  );

  const handleBack = useCallback(() => {
    if (idx > 0) setIdx(idx - 1);
    else onClose();
  }, [idx, onClose]);

  const handleIgnore = useCallback(() => {
    const c = deck[idx];
    let updated = suggestions;
    if (c) {
      const ids = new Set(c.itemIds || []);
      if (ids.size > 0) {
        updated = suggestions.map((s) => (ids.has(s.platformProduct.id) ? { ...s, action: 'IGNORE' as const, isSelected: false, resolved: true } : s));
        applyChange(updated);
      }
    }
    advanceAfter(updated);
  }, [deck, idx, suggestions, applyChange, advanceAfter]);

  // Undo / redo — read the stacks from the closure (deps keep them fresh) and
  // fire each setState ONCE at top level (no nesting inside an updater, which
  // would double-fire in StrictMode and corrupt the stacks).
  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([suggestions, ...future]);
    setSuggestions(prev);
    setDeck(buildDeck(prev, platformName));
    setIdx(0);
  }, [past, future, suggestions, platformName, setSuggestions]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, suggestions]);
    setSuggestions(next);
    setDeck(buildDeck(next, platformName));
    setIdx(0);
  }, [past, future, suggestions, platformName, setSuggestions]);

  // ── Edit / explain composer ────────────────────────────────────────────────
  const [composer, setComposer] = useState<ComposerMode | null>(null);
  const cur = deck[idx];
  const curSug = useMemo(() => suggestions.find((s) => s.platformProduct.id === cur?.itemIds?.[0]) || null, [suggestions, cur]);
  const editFields = useMemo<ComposerField[]>(() => {
    const p = curSug?.platformProduct;
    if (!p) return [];
    return [
      { key: 'title', label: 'Title', value: p.title || '' },
      { key: 'sku', label: 'SKU', value: p.sku || '' },
      { key: 'price', label: 'Price', value: p.price != null ? String(p.price) : '', keyboardType: 'decimal-pad' },
    ];
  }, [curSug]);

  const submitComposer = useCallback(
    (result: ComposerResult) => {
      const c = deck[idx];
      if (!c) {
        setComposer(null);
        return;
      }
      if (composer === 'explain') {
        const ids = new Set(c.itemIds || []);
        const updated = suggestions.map((s) =>
          ids.has(s.platformProduct.id) ? { ...resolveSuggestion(s, c, 'alt'), reasonNote: result.note, reasonTags: result.tags } : s,
        );
        applyChange(updated);
        setComposer(null);
        advanceAfter(updated);
      } else {
        const f = result.fields || {};
        const id = curSug?.platformProduct.id;
        const parsedPrice = f.price != null && f.price !== '' && !Number.isNaN(parseFloat(f.price)) ? parseFloat(f.price) : null;
        const updated = suggestions.map((s) =>
          s.platformProduct.id === id
            ? { ...s, platformProduct: { ...s.platformProduct, title: f.title ?? s.platformProduct.title, sku: f.sku ?? s.platformProduct.sku, price: parsedPrice != null ? parsedPrice : s.platformProduct.price } }
            : s,
        );
        applyChange(updated);
        const next = buildDeck(updated, platformName);
        setDeck(next);
        setIdx((i) => Math.min(i, Math.max(next.length - 1, 0)));
        setComposer(null);
      }
    },
    [deck, idx, composer, suggestions, curSug, platformName, applyChange],
  );

  // ── All-items view (search · filter · jump · undo) ──────────────────────────
  const [view, setView] = useState<'cards' | 'all'>('cards');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const openAll = useCallback((f: string) => { setMenuOpen(false); setFilter(f); setView('all'); }, []);
  const openDetail = useCallback((id: string) => setDetailId(id), []);
  const detailSug = useMemo(() => (detailId ? suggestions.find((s) => s.platformProduct.id === detailId) || null : null), [detailId, suggestions]);

  // id → its pending case (for the badge + jump target).
  const caseByItem = useMemo(() => {
    const m = new Map<string, { c: MatchCase; i: number }>();
    remainingLive.forEach((c, i) => (c.itemIds || []).forEach((id) => { if (!m.has(id)) m.set(id, { c, i }); }));
    return m;
  }, [remainingLive]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: suggestions.length, review: 0, linked: 0, new: 0, catalog: 0, ignored: 0 };
    for (const s of suggestions) out[statusOf(s).key] += 1;
    return out;
  }, [suggestions]);

  const allItems = useMemo(() => {
    const qq = query.trim().toLowerCase();
    return suggestions.filter((s) => {
      const st = statusOf(s);
      if (filter !== 'all' && st.key !== filter) return false;
      if (!qq) return true;
      const p = s.platformProduct;
      return (p.title || '').toLowerCase().includes(qq) || (p.sku || '').toLowerCase().includes(qq);
    });
  }, [suggestions, query, filter]);

  const undoOne = useCallback(
    (id: string) => {
      const updated = suggestions.map((s) => (s.platformProduct.id === id ? { ...s, resolved: false, action: 'UNMATCHED' as const, isSelected: false } : s));
      applyChange(updated);
      setDeck(buildDeck(updated, platformName));
    },
    [suggestions, platformName, applyChange],
  );

  const openItem = useCallback(
    (id: string) => {
      const i = remainingLive.findIndex((c) => (c.itemIds || []).includes(id));
      if (i < 0) return;
      setDeck(remainingLive);
      setIdx(i);
      setView('cards');
    },
    [remainingLive],
  );

  // ── All-items full-screen view ──────────────────────────────────────────────
  if (view === 'all') {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#F4F5F7' }}>
        <View style={{ flex: 1, paddingTop: insets.top + 10, paddingHorizontal: 16 }}>
          <View style={styles.allHeader}>
            <TouchableOpacity onPress={() => setView('cards')} hitSlop={8} style={styles.iconBtn}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={RC.muted} />
            </TouchableOpacity>
            <Text style={styles.allTitle}>All items</Text>
            <Text style={styles.allCount}>{suggestions.length}</Text>
          </View>

          <View style={styles.searchBox}>
            <MaterialCommunityIcons name="magnify" size={18} color={RC.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name or SKU…"
              placeholderTextColor={RC.faint}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {!!query && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <MaterialCommunityIcons name="close-circle" size={18} color={RC.faint} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} style={{ flexGrow: 0 }}>
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <TouchableOpacity key={f.key} activeOpacity={0.8} onPress={() => setFilter(f.key)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{`${f.label} · ${counts[f.key] ?? 0}`}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Virtualized: the import can carry hundreds of items, so a plain
              ScrollView mounted every card at once and made pill-switching / search
              janky. FlatList renders only what's on screen. */}
          <FlatList
            data={allItems}
            keyExtractor={(s) => s.platformProduct.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 24, gap: 8 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={7}
            removeClippedSubviews
            ListEmptyComponent={<Text style={styles.allEmpty}>Nothing here.</Text>}
            renderItem={({ item: s }) => {
              const st = statusOf(s);
              const pending = st.key === 'review';
              const badge = pending ? caseByItem.get(s.platformProduct.id)?.c : null;
              const p = s.platformProduct;
              // Linked → anorha mark + every connected channel; otherwise just the
              // source platform (and only if it resolves to a known brand — a CSV /
              // free-text source shows no avatar rather than a generic glyph).
              const platformAvatars = st.key === 'linked'
                ? Array.from(new Set(['anorha', ...accountPlatformKeys, ...(sourcePlatformKey ? [sourcePlatformKey] : [])]))
                : (sourcePlatformKey ? [sourcePlatformKey] : []);
              return (
                <InventoryListCard
                  id={p.id}
                  title={p.title || p.sku || 'Item'}
                  price={typeof p.price === 'number' ? p.price : undefined}
                  sku={p.sku || undefined}
                  imageUrl={p.imageUrl || s.suggestedCanonicalProduct?.imageUrl || s.anorhaVariant?.imageUrl || undefined}
                  platformNames={platformAvatars}
                  statusLabel={badge ? `${cardBadgeFor(badge).label} · ${st.label}` : st.label}
                  statusColor={STATUS_COLOR[st.tone]}
                  hideSync
                  onPress={() => openDetail(p.id)}
                />
              );
            }}
          />
        </View>

        {detailSug ? (
          <View style={[StyleSheet.absoluteFill, styles.detailOverlay]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setDetailId(null)} />
            <View style={[styles.detailSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.detailHandle} />
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle} numberOfLines={2}>{detailSug.platformProduct.title || detailSug.platformProduct.sku || 'Item'}</Text>
                <TouchableOpacity onPress={() => setDetailId(null)} hitSlop={8} style={styles.iconBtn}>
                  <MaterialCommunityIcons name="close" size={18} color={RC.muted} />
                </TouchableOpacity>
              </View>

              <View style={styles.detailPair}>
                <View style={styles.detailSide}>
                  <Text style={styles.detailSideLabel}>{(platformName || 'INCOMING').toUpperCase()}</Text>
                  {detailSug.platformProduct.imageUrl ? (
                    <Image source={{ uri: detailSug.platformProduct.imageUrl }} style={styles.detailImg} />
                  ) : (
                    <View style={styles.detailImg}><MaterialCommunityIcons name="package-variant" size={26} color={RC.faint} /></View>
                  )}
                  <Text style={styles.detailName} numberOfLines={2}>{detailSug.platformProduct.title || '—'}</Text>
                  <Text style={styles.detailMeta} numberOfLines={1}>{[detailSug.platformProduct.sku, money(detailSug.platformProduct.price)].filter((x) => x && x !== '—').join(' · ') || '—'}</Text>
                </View>
                {detailSug.suggestedCanonicalProduct?.id ? (
                  <>
                    <View style={styles.detailArrow}><MaterialCommunityIcons name="arrow-right" size={18} color={RC.faint} /></View>
                    <View style={styles.detailSide}>
                      <Text style={styles.detailSideLabel}>YOUR CATALOG</Text>
                      {detailSug.suggestedCanonicalProduct.imageUrl ? (
                        <Image source={{ uri: detailSug.suggestedCanonicalProduct.imageUrl }} style={styles.detailImg} />
                      ) : (
                        <View style={styles.detailImg}><MaterialCommunityIcons name="package-variant" size={26} color={RC.faint} /></View>
                      )}
                      <Text style={styles.detailName} numberOfLines={2}>{detailSug.suggestedCanonicalProduct.title || '—'}</Text>
                      <Text style={styles.detailMeta} numberOfLines={1}>{detailSug.suggestedCanonicalProduct.sku || '—'}</Text>
                    </View>
                  </>
                ) : null}
              </View>

              {(() => {
                const st = statusOf(detailSug);
                const color = STATUS_COLOR[st.tone];
                return (
                  <View style={[styles.detailStatus, { borderColor: `${color}55`, backgroundColor: `${color}14` }]}>
                    <Text style={[styles.detailStatusText, { color }]}>{st.label}</Text>
                  </View>
                );
              })()}

              {statusOf(detailSug).key === 'review' ? (
                <TouchableOpacity style={styles.detailPrimary} activeOpacity={0.88} onPress={() => { const id = detailSug.platformProduct.id; setDetailId(null); openItem(id); }}>
                  <Text style={styles.detailPrimaryText}>Review this</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.detailPrimary} activeOpacity={0.88} onPress={() => { undoOne(detailSug.platformProduct.id); setDetailId(null); }}>
                  <Text style={styles.detailPrimaryText}>Undo decision</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : null}

        <ResolveComposer
          visible={composer != null}
          mode={composer || 'explain'}
          item={{ title: curSug?.platformProduct.title || cur?.itemTitle || cur?.title || '', sub: curSug?.platformProduct.sku ? `SKU ${curSug.platformProduct.sku}` : cur?.itemSub, imageUrl: curSug?.platformProduct.imageUrl || cur?.itemImage }}
          fields={editFields}
          onCancel={() => setComposer(null)}
          onSubmit={submitComposer}
        />
      </GestureHandlerRootView>
    );
  }

  // ── All reviewed ────────────────────────────────────────────────────────────
  if (total === 0 || idx >= total) {
    return (
      <View style={[styles.screen, { backgroundColor: '#F4F5F7', paddingTop: insets.top + 24 }]}>
        <View style={styles.allClear}>
          <MaterialCommunityIcons name="check-circle-outline" size={40} color={RC.green} />
          <Text style={[styles.allClearTitle, { color: theme.colors.text }]}>All caught up</Text>
          <Text style={[styles.allClearSub, { color: theme.colors.textSecondary }]}>Nothing needs your review — everything else matched automatically. Finish to apply, or browse all items.</Text>
          <TouchableOpacity onPress={onCommit} style={styles.doneBtn} activeOpacity={0.88}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setView('all')} style={styles.backLink} hitSlop={8}>
            <Text style={[styles.backLinkText, { color: theme.colors.textSecondary }]}>See all items</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const canExplain = ['compare', 'collision', 'fuzzy', 'stale'].includes(cur.kind);
  const canEdit = !!curSug && curSug.direction !== 'anorha_to_platform';
  // Progress reflects ONLY the genuine-review workload (the filtered deck), not the
  // hundreds of auto-linked / catalog items. `past.length` = decisions made this
  // session; `remainingLive.length` = review cases still pending. (Previously this used
  // every resolved suggestion as the denominator, so the bar sat near 100% from the
  // start and "N left" counted catalog items.)
  const helpRemaining = remainingLive.length;
  const displayTotal = Math.max(past.length + helpRemaining, 1);
  const displayIdx = Math.min(past.length + 1, displayTotal);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#F4F5F7' }}>
      <DeckChrome.Provider
        value={{
          onMenu: () => setMenuOpen(true),
          onIgnore: handleIgnore,
          onUndo: undo,
          canUndo: past.length > 0,
          onRedo: redo,
          canRedo: future.length > 0,
        }}
      >
        <ResolveActions.Provider
          value={{
            onEdit: canEdit ? () => setComposer('edit') : undefined,
            onExplain: canExplain ? () => setComposer('explain') : undefined,
          }}
        >
          <MatchResolver
            key={cur.id}
            c={cur}
            idx={displayIdx}
            total={displayTotal}
            topInset={insets.top}
            onBack={handleBack}
            onResolve={handleResolve}
            onSearch={searchCatalog}
          />
        </ResolveActions.Provider>
      </DeckChrome.Provider>

      <AppMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        width={232}
        anchor={{ top: insets.top + 54, left: SCREEN_W - 248 }}
        sections={[
          [
            { key: 'review', label: 'Review list', icon: 'format-list-bulleted', onPress: () => openAll('review') },
            { key: 'all', label: 'All items', icon: 'view-grid-outline', onPress: () => openAll('all') },
          ],
        ]}
      />

      <ResolveComposer
        visible={composer != null}
        mode={composer || 'explain'}
        item={{
          title: curSug?.platformProduct.title || cur.itemTitle || cur.title,
          sub: curSug?.platformProduct.sku ? `SKU ${curSug.platformProduct.sku}` : cur.itemSub,
          imageUrl: curSug?.platformProduct.imageUrl || cur.itemImage,
        }}
        fields={editFields}
        onCancel={() => setComposer(null)}
        onSubmit={submitComposer}
      />
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  allClear: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  allClearTitle: { fontSize: 22, marginTop: 14, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  allClearSub: { fontSize: 14, marginTop: 6, textAlign: 'center', fontFamily: 'Inter_500Medium', lineHeight: 20 },
  doneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22, paddingHorizontal: 40, height: 52, borderRadius: 26, backgroundColor: RC.green },
  doneBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
  backLink: { marginTop: 16, paddingVertical: 8 },
  backLinkText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  // all-items view
  allHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center' },
  allTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: RC.ink, letterSpacing: -0.3 },
  allCount: { fontSize: 15, fontWeight: '700', color: RC.muted },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, borderWidth: 1.5, borderColor: RC.line, borderRadius: 13, paddingHorizontal: 12, backgroundColor: '#fff', marginTop: 12 },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500', color: RC.ink, paddingVertical: 0 },
  chipsRow: { gap: 8, marginVertical: 12,  paddingRight: 16 },
  chip: { borderWidth: 1, borderColor: RC.line, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: RC.green, backgroundColor: RC.greenSoft },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: RC.muted },
  chipTextOn: { color: RC.greenDark },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11 },
  itemThumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: RC.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  itemTitle: { fontSize: 15, fontWeight: '700', color: RC.ink },
  itemStatus: { fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  platChip: { backgroundColor: RC.surface2, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexShrink: 0 },
  platChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: RC.muted },
  undoChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: RC.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, flexShrink: 0 },
  undoChipText: { fontSize: 12.5, fontWeight: '700', color: RC.muted },
  allEmpty: { fontSize: 14, fontWeight: '500', color: RC.faint, textAlign: 'center', paddingVertical: 40 },

  // item detail (product + incoming platform, preview of the import)
  detailOverlay: { backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  detailSheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 8 },
  detailHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: RC.line, alignSelf: 'center', marginBottom: 12 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  detailTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: RC.ink, letterSpacing: -0.3 },
  detailPair: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  detailSide: { flex: 1, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: RC.line, borderRadius: 14, padding: 12, backgroundColor: '#fff' },
  detailSideLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, color: RC.faint },
  detailImg: { width: 72, height: 72, borderRadius: 14, backgroundColor: RC.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  detailName: { fontSize: 14, fontWeight: '700', color: RC.ink, textAlign: 'center' },
  detailMeta: { fontSize: 12.5, fontWeight: '500', color: RC.muted, textAlign: 'center' },
  detailArrow: { width: 22, alignItems: 'center' },
  detailStatus: { alignSelf: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6, marginBottom: 16 },
  detailStatusText: { fontSize: 13, fontWeight: '800' },
  detailPrimary: { height: 52, borderRadius: 26, backgroundColor: RC.green, alignItems: 'center', justifyContent: 'center' },
  detailPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

export default MatchDeck;
