// MatchDeck — the Match review, one card at a time.
//
// This is the mounted surface for the 11 Match·Resolve v2 cases: it snapshots
// the live mapping suggestions into an ordered deck via classifyMatch(), then
// renders one MatchResolver card at a time (Create · Split/Merge · Verify ·
// Match · Ignore — the five-card model badged in the shell). Every decision is
// written straight back onto the suggestions, which the session hook persists
// to /draft-mappings automatically. When the deck drains, we commit.
//
// Mirrors BackfillOptimizerScreen's optimize deck — same shape, match side.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Pressable, Image, Dimensions } from 'react-native';
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
import PillTabs from '../ui/PillTabs';

const SCREEN_W = Dimensions.get('window').width;

interface MatchDeckProps {
  theme: any;
  insets: { top: number; bottom: number; left: number; right: number };
  /** Live mapping suggestions — the deck is built from these and decisions
   *  write back onto them (persisted via the session hook's draft-mappings). */
  suggestions: MappingSuggestion[];
  platformName?: string;
  setSuggestions: React.Dispatch<React.SetStateAction<MappingSuggestion[] | null>>;
  /** Leave the deck (back out of the queue). */
  onClose: () => void;
  /** Deck drained — every card answered, ready to commit. */
  onCommit: () => void;
}

const money = (n?: number | string | null): string => {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  return typeof v === 'number' && !Number.isNaN(v) && v > 0 ? `$${v.toFixed(2)}` : '—';
};

// Apply one resolver's decision to a single suggestion it owns. The kit reports
// the choice (primary/alt) plus meta (the exact item to link, a subset to keep,
// or an outright ignore); we translate that to action + resolved + isSelected.
function resolveSuggestion(
  s: MappingSuggestion,
  cur: MatchCase,
  decision: Decision,
  meta?: ResolveMeta,
): MappingSuggestion {
  const id = s.platformProduct.id;

  // Explicit "link to THIS" wins over everything — the user hand-picked it.
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

  // Batch cards: a per-row subset decision (kept rows vs the rest).
  if (meta?.selectedIds) {
    const inSel = meta.selectedIds.includes(id);
    switch (cur.kind) {
      case 'orphans':
        // selected = kept listed · the rest are gone → delist.
        return inSel
          ? { ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true }
          : { ...s, action: 'IGNORE', isSelected: false, resolved: true };
      case 'consolidate':
      case 'variants':
        // selected = grouped/merged · the rest become their own product.
        return inSel
          ? { ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true }
          : { ...s, action: 'CREATE_NEW', isSelected: true, resolved: true };
      case 'align':
        // selected = synced · skipped rows are left exactly as they are.
        return inSel ? { ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true } : { ...s, resolved: true };
      case 'fuzzy':
        // "Yes" links them; "No" leaves the item open for a closer look later.
        return inSel ? { ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true } : s;
      default:
        return applyMatchDecision(s, cur.kind, inSel ? 'primary' : 'alt');
    }
  }

  // Unlink / delist (stale unlink · orphan "mark sold").
  if (meta?.unlink) return { ...s, action: 'IGNORE', isSelected: false, resolved: true };

  // Single-item cards: the classifier's own write-back rules.
  return applyMatchDecision(s, cur.kind, decision);
}

const MatchDeck: React.FC<MatchDeckProps> = ({
  theme,
  insets,
  suggestions,
  platformName,
  setSuggestions,
  onClose,
  onCommit,
}) => {
  // Snapshot the deck so resolving a card never re-clusters the remaining ones
  // mid-pass. When the pass drains we re-classify once (a fuzzy "No" can leave an
  // item open for a closer look) and continue if anything's left.
  const [deck, setDeck] = useState<MatchCase[]>(() => classifyMatch(suggestions as any, platformName).cases);
  const [idx, setIdx] = useState(0);
  // The most recent decision's item ids — drives the footer Undo button.
  const [lastDecided, setLastDecided] = useState<string[] | null>(null);
  const total = deck.length;

  // Catalog index for the find/relink search boxes — built from every canonical
  // and variant the suggestions already carry, so search never leaves the card.
  const catalog = useMemo<CandidateItem[]>(() => {
    const seen = new Set<string>();
    const out: CandidateItem[] = [];
    for (const s of suggestions) {
      const c = s.suggestedCanonicalProduct;
      if (c?.id && !seen.has(c.id)) {
        seen.add(c.id);
        out.push({
          id: c.id,
          title: c.title || 'Item',
          sub: [c.sku, money(c.price)].filter((x) => x && x !== '—').join(' · ') || undefined,
          uri: c.imageUrl,
          sku: c.sku || null,
          price: typeof c.price === 'number' ? c.price : null,
        });
      }
      const v = s.anorhaVariant;
      if (v?.id && !seen.has(v.id)) {
        seen.add(v.id);
        out.push({
          id: v.id,
          title: v.title || 'Item',
          sub: [v.sku, money(v.price)].filter((x) => x && x !== '—').join(' · ') || undefined,
          uri: v.imageUrl,
          sku: v.sku || null,
          price: typeof v.price === 'number' ? v.price : null,
        });
      }
    }
    return out;
  }, [suggestions]);

  const searchCatalog = useCallback(
    (q: string): CandidateItem[] => {
      const qq = q.trim().toLowerCase();
      if (!qq) return [];
      return catalog
        .filter(
          (c) =>
            c.title.toLowerCase().includes(qq) ||
            (c.sub || '').toLowerCase().includes(qq) ||
            (c.sku || '').toLowerCase().includes(qq),
        )
        .slice(0, 30);
    },
    [catalog],
  );

  // Advance after a decision: step to the next card; when the pass drains,
  // re-classify off the fresh suggestions (a fuzzy "No" re-surfaces as its own
  // card) and continue, else every item has a decision so commit.
  const advanceAfter = useCallback(
    (updated: MappingSuggestion[]) => {
      if (idx + 1 < deck.length) {
        setIdx(idx + 1);
        return;
      }
      const next = classifyMatch(updated as any, platformName).cases;
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
      const cur = deck[idx];
      // Compute the updated suggestions synchronously so advanceAfter can
      // re-classify off the fresh state (state updates haven't flushed yet).
      let updated = suggestions;
      if (cur) {
        const ids = new Set(cur.itemIds || []);
        if (ids.size > 0) {
          updated = suggestions.map((s) =>
            ids.has(s.platformProduct.id) ? resolveSuggestion(s, cur, decision, meta) : s,
          );
          setSuggestions(updated);
          setLastDecided(cur.itemIds || []);
        }
      }
      advanceAfter(updated);
    },
    [deck, idx, suggestions, setSuggestions, advanceAfter],
  );

  const handleBack = useCallback(() => {
    if (idx > 0) setIdx(idx - 1);
    else onClose();
  }, [idx, onClose]);

  // ── Edit / explain composer ────────────────────────────────────────────────
  const [composer, setComposer] = useState<ComposerMode | null>(null);
  const cur = deck[idx];
  const curSug = useMemo(
    () => suggestions.find((s) => s.platformProduct.id === cur?.itemIds?.[0]) || null,
    [suggestions, cur],
  );
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
        // Record the reason on the affected items AND resolve "not the same"
        // (keep separate), then advance like any other decision.
        const ids = new Set(c.itemIds || []);
        const updated = suggestions.map((s) =>
          ids.has(s.platformProduct.id)
            ? { ...resolveSuggestion(s, c, 'alt'), reasonNote: result.note, reasonTags: result.tags }
            : s,
        );
        setSuggestions(updated);
        setLastDecided(c.itemIds || []);
        setComposer(null);
        advanceAfter(updated);
      } else {
        // Edit — write the edited fields onto the incoming product and re-snapshot
        // so the card shows them. Routing is stable, so idx stays on the same card.
        const f = result.fields || {};
        const id = curSug?.platformProduct.id;
        const parsedPrice =
          f.price != null && f.price !== '' && !Number.isNaN(parseFloat(f.price)) ? parseFloat(f.price) : null;
        const updated = suggestions.map((s) =>
          s.platformProduct.id === id
            ? {
                ...s,
                platformProduct: {
                  ...s.platformProduct,
                  title: f.title ?? s.platformProduct.title,
                  sku: f.sku ?? s.platformProduct.sku,
                  price: parsedPrice != null ? parsedPrice : s.platformProduct.price,
                },
              }
            : s,
        );
        setSuggestions(updated);
        const next = classifyMatch(updated as any, platformName).cases;
        setDeck(next);
        setIdx((i) => Math.min(i, Math.max(next.length - 1, 0)));
        setComposer(null);
      }
    },
    [deck, idx, composer, suggestions, curSug, platformName, setSuggestions, advanceAfter],
  );

  // ── Ignore (deck-level — trash button + swipe-down) ─────────────────────────
  const handleIgnore = useCallback(() => {
    const c = deck[idx];
    let updated = suggestions;
    if (c) {
      const ids = new Set(c.itemIds || []);
      if (ids.size > 0) {
        updated = suggestions.map((s) =>
          ids.has(s.platformProduct.id) ? { ...s, action: 'IGNORE' as const, isSelected: false, resolved: true } : s,
        );
        setSuggestions(updated);
        setLastDecided(c.itemIds || []);
      }
    }
    advanceAfter(updated);
  }, [deck, idx, suggestions, setSuggestions, advanceAfter]);

  // Undo the most recent decision: clear it and re-deck so it returns first.
  const handleUndo = useCallback(() => {
    if (!lastDecided || lastDecided.length === 0) return;
    const ids = new Set(lastDecided);
    const updated = suggestions.map((s) =>
      ids.has(s.platformProduct.id) ? { ...s, resolved: false, action: 'UNMATCHED' as const, isSelected: false } : s,
    );
    setSuggestions(updated);
    setDeck(classifyMatch(updated as any, platformName).cases);
    setIdx(0);
    setLastDecided(null);
  }, [lastDecided, suggestions, platformName, setSuggestions]);

  // ── Menu · list view · history / ignored ────────────────────────────────────
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [menuOpen, setMenuOpen] = useState(false);
  const [overlay, setOverlay] = useState<null | 'history'>(null);
  const [historyTab, setHistoryTab] = useState<'history' | 'ignored'>('history');

  const ignored = useMemo(() => suggestions.filter((s) => s.resolved && s.action === 'IGNORE'), [suggestions]);
  const history = useMemo(() => suggestions.filter((s) => s.resolved && s.action !== 'IGNORE'), [suggestions]);
  // Live remaining cases — drives the list view and the "jump to card" target.
  const remainingLive = useMemo(
    () => classifyMatch(suggestions as any, platformName).cases,
    [suggestions, platformName],
  );

  const decisionLabel = (s: MappingSuggestion): string =>
    s.action === 'LINK_EXISTING' ? 'Linked' : s.action === 'CREATE_NEW' ? 'Added new' : s.action === 'IGNORE' ? 'Ignored' : 'Resolved';

  // Undo / restore: clear the decision and re-deck so the item returns to review.
  const restore = useCallback(
    (id: string) => {
      const updated = suggestions.map((s) =>
        s.platformProduct.id === id ? { ...s, resolved: false, action: 'UNMATCHED' as const, isSelected: false } : s,
      );
      setSuggestions(updated);
      setDeck(classifyMatch(updated as any, platformName).cases);
      setIdx(0);
      setView('cards');
      setOverlay(null);
    },
    [suggestions, platformName, setSuggestions],
  );

  // Open a specific pending item from the list view (re-snapshot to live order).
  const jumpTo = useCallback(
    (i: number) => {
      setDeck(remainingLive);
      setIdx(i);
      setView('cards');
    },
    [remainingLive],
  );

  if (total === 0 || idx >= total) {
    return (
      <View style={[styles.screen, { backgroundColor: '#F4F5F7', paddingTop: insets.top + 24 }]}>
        <View style={styles.allClear}>
          <MaterialCommunityIcons name="check-circle-outline" size={40} color={RC.green} />
          <Text style={[styles.allClearTitle, { color: theme.colors.text }]}>All reviewed</Text>
          <Text style={[styles.allClearSub, { color: theme.colors.textSecondary }]}>
            Every item has a decision. Finish to apply it everywhere.
          </Text>
          <TouchableOpacity onPress={onCommit} style={styles.doneBtn} activeOpacity={0.88}>
            <MaterialCommunityIcons name="check" size={18} color="#fff" />
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.backLink} hitSlop={8}>
            <Text style={[styles.backLinkText, { color: theme.colors.textSecondary }]}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Explain only fits the "is this the same?" cards; edit fits any incoming item.
  const canExplain = ['compare', 'collision', 'fuzzy', 'stale'].includes(cur.kind);
  const canEdit = !!curSug && curSug.direction !== 'anorha_to_platform';

  // Progress + "N left" reflect ACTUAL remaining (not deck position), so the bar,
  // the count, and the list view always agree — even after going back or undoing.
  const decidedCount = suggestions.filter((s) => s.resolved).length;
  const displayTotal = Math.max(decidedCount + remainingLive.length, 1);
  const displayIdx = Math.min(decidedCount + 1, displayTotal);

  const menuSections = [
    [
      {
        key: 'view',
        label: view === 'cards' ? 'Switch to list' : 'Switch to cards',
        icon: view === 'cards' ? 'format-list-bulleted' : 'cards-outline',
        onPress: () => { setMenuOpen(false); setView(view === 'cards' ? 'list' : 'cards'); },
      },
    ],
    [
      { key: 'history', label: `History${history.length ? ` (${history.length})` : ''}`, icon: 'history', onPress: () => { setMenuOpen(false); setHistoryTab('history'); setOverlay('history'); } },
      { key: 'ignored', label: `Ignored${ignored.length ? ` (${ignored.length})` : ''}`, icon: 'trash-can-outline', onPress: () => { setMenuOpen(false); setHistoryTab('ignored'); setOverlay('history'); } },
    ],
  ];

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#F4F5F7' }}>
      {view === 'list' ? (
        <View style={{ flex: 1, paddingTop: insets.top + 10, paddingHorizontal: 16 }}>
          <View style={styles.listHeader}>
            <TouchableOpacity onPress={() => setView('cards')} hitSlop={8} style={styles.listIconBtn}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={RC.muted} />
            </TouchableOpacity>
            <Text style={styles.listTitle}>{remainingLive.length} to review</Text>
            <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.listIconBtn}>
              <MaterialCommunityIcons name="dots-horizontal" size={20} color={RC.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
            {remainingLive.map((rc, i) => {
              const b = cardBadgeFor(rc);
              return (
                <TouchableOpacity key={rc.id} activeOpacity={0.7} onPress={() => jumpTo(i)} style={styles.listRow}>
                  <View style={[styles.listDot, { backgroundColor: b.color }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.listRowTitle} numberOfLines={1}>{rc.itemTitle || rc.title}</Text>
                    {!!rc.note && <Text style={styles.listRowSub} numberOfLines={1}>{rc.note}</Text>}
                  </View>
                  <View style={[styles.listBadge, { backgroundColor: `${b.color}14` }]}>
                    <Text style={[styles.listBadgeText, { color: b.color }]}>{b.label}</Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={RC.faint} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <DeckChrome.Provider
          value={{
            onMenu: () => setMenuOpen(true),
            onIgnore: handleIgnore,
            onUndo: handleUndo,
            canUndo: !!(lastDecided && lastDecided.length),
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
      )}

      <AppMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={{ top: insets.top + 84, left: SCREEN_W - 312 }}
        sections={menuSections}
      />

      {overlay === 'history' ? (
        <Pressable style={[StyleSheet.absoluteFill, styles.sheetOverlay, { zIndex: 50 }]} onPress={() => setOverlay(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <PillTabs
              tabs={[
                { key: 'history', label: 'History', count: history.length },
                { key: 'ignored', label: 'Ignored', count: ignored.length, tone: 'danger' },
              ]}
              value={historyTab}
              onChange={(k) => setHistoryTab(k as 'history' | 'ignored')}
            />
            <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ padding: 16, gap: 10 }} showsVerticalScrollIndicator={false}>
              {(historyTab === 'history' ? history : ignored).map((s) => (
                <View key={s.platformProduct.id} style={styles.histRow}>
                  {s.platformProduct.imageUrl ? (
                    <Image source={{ uri: s.platformProduct.imageUrl }} style={styles.histThumb} />
                  ) : (
                    <View style={styles.histThumb}><MaterialCommunityIcons name="package-variant" size={16} color={RC.faint} /></View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.histTitle} numberOfLines={1}>{s.platformProduct.title}</Text>
                    <Text style={styles.histSub} numberOfLines={1}>{decisionLabel(s)}</Text>
                  </View>
                  <TouchableOpacity onPress={() => restore(s.platformProduct.id)} hitSlop={8} style={styles.histRestore}>
                    <MaterialCommunityIcons name="undo-variant" size={15} color={RC.muted} />
                    <Text style={styles.histRestoreText}>{historyTab === 'ignored' ? 'Restore' : 'Undo'}</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {(historyTab === 'history' ? history : ignored).length === 0 && (
                <Text style={styles.sheetEmpty}>{historyTab === 'ignored' ? 'Nothing ignored yet.' : 'No decisions yet.'}</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      ) : null}

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
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 22,
    paddingHorizontal: 34,
    height: 52,
    borderRadius: 26,
    backgroundColor: RC.green,
  },
  doneBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
  backLink: { marginTop: 16, paddingVertical: 8 },
  backLinkText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  // list view
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40 },
  listIconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center' },
  listTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: RC.ink, letterSpacing: -0.3 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: RC.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14 },
  listDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  listRowTitle: { fontSize: 15, fontWeight: '700', color: RC.ink },
  listRowSub: { fontSize: 12.5, fontWeight: '500', color: RC.muted, marginTop: 2 },
  listBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  listBadgeText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },

  // history / ignored sheet
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: RC.line, alignSelf: 'center', marginBottom: 6 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11 },
  histThumb: { width: 38, height: 38, borderRadius: 9, backgroundColor: RC.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  histTitle: { fontSize: 14.5, fontWeight: '700', color: RC.ink },
  histSub: { fontSize: 12.5, fontWeight: '600', color: RC.muted, marginTop: 2 },
  histRestore: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: RC.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, flexShrink: 0 },
  histRestoreText: { fontSize: 12.5, fontWeight: '700', color: RC.muted },
  sheetEmpty: { fontSize: 14, fontWeight: '500', color: RC.faint, textAlign: 'center', paddingVertical: 28 },
});

export default MatchDeck;
