// matchResolvers — the 11 Match·Resolve v2 screens (one interaction per problem).
// Faithful hi-fi translations of wireframes-match-resolve.jsx, fed by the real
// mapping draft (MappingSuggestion). Each resolver owns its local decision state
// and commits via the ResolveShell footer (one primary + a quiet alt).

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
  RC,
  // The match deck renders the Paper J/H "deck card" chrome. Swapping the shell
  // here re-skins all 13 resolvers; the optimize side keeps ResolveShell.
  TinderShell as ResolveShell,
  ResolveBadge,
  Row,
  Thumb,
  PlatTag,
  Chip,
  ResultRow,
  OptionRow,
  Tone,
} from './ResolveKit';

// ── Normalized case the classifier emits from the draft ────────────────────
export type MatchKind =
  | 'compare'
  | 'collision'
  | 'consolidate'
  | 'split'
  | 'find'
  | 'onesided'
  | 'align'
  | 'variants'
  | 'stale'
  | 'orphan'
  | 'orphans'
  | 'fuzzy'
  | 'kit';

export interface CompareRow {
  f: string;
  a: string;
  b: string;
  same?: boolean;
  clash?: boolean;
  pick?: 'a' | 'b' | 'both' | 'sum';
}
export interface CandidateItem {
  id: string;
  title: string;
  sub?: string;
  hint?: string;
  uri?: string | null;
  on?: boolean;
  master?: boolean;
  plat?: string;
  /** Raw fields so a picked search result can become the linked product. */
  sku?: string | null;
  price?: number | null;
  /** Fuzzy batch rows: the catalog side's image + the price column. */
  uri2?: string | null;
  priceLabel?: string;
  warn?: boolean;
  /** Differing fields for the tinder card — same cells as the compare card. */
  rows?: CompareRow[];
}
export interface MatchCase {
  id: string;
  kind: MatchKind;
  title: string;
  note?: string;
  /** platformProduct ids this case resolves — used to write decisions back. */
  itemIds?: string[];
  // identity
  itemTitle?: string;
  itemSub?: string;
  itemImage?: string | null;
  platform?: string;
  // compare/collision
  aLabel?: string;
  bLabel?: string;
  aChip?: string;
  bChip?: string;
  aTone?: Tone;
  bTone?: Tone;
  aImage?: string | null;
  bImage?: string | null;
  rows?: CompareRow[];
  // lists
  candidates?: CandidateItem[];
  parts?: { name: string; sku: string; qty: string; price: string }[];
  // variants
  parentTitle?: string;
  // compare/collision context — the evidence, on demand
  conf?: number;
  why?: string;
}

export type Decision = 'primary' | 'alt';

/** Extra payload a resolver reports up with its decision. */
export interface ResolveMeta {
  /** Rows the user kept ticked — unticked rows get the alt treatment. */
  selectedIds?: string[];
  /** Stale links: break the link instead of relinking. */
  unlink?: boolean;
  /** The exact catalog item the user picked (find/relink) — the write-back
   *  must link to THIS, not whatever the backend originally suggested. */
  linkTo?: CandidateItem;
  /** Don't import this item at all — lands in the Ignored tab. */
  ignore?: boolean;
}

interface RProps {
  c: MatchCase;
  idx: number;
  total: number;
  topInset: number;
  onBack: () => void;
  onResolve: (d: Decision, meta?: ResolveMeta) => void;
  /** Live catalog search for the find/relink screens. */
  onSearch?: (q: string) => CandidateItem[];
}

// ═══ COMPARE — field-by-field A/B, tap a side to keep ══════════════════════
export function CompareBody({
  aLabel,
  bLabel,
  aChip,
  bChip,
  aTone,
  bTone,
  aImage,
  bImage,
  rows,
  conf,
  why,
}: Pick<MatchCase, 'aLabel' | 'bLabel' | 'aChip' | 'bChip' | 'aTone' | 'bTone' | 'aImage' | 'bImage' | 'rows' | 'conf' | 'why'>) {
  const [showWhy, setShowWhy] = useState(false);

  return (
    <>
      {/* Column headers stay visible even when both sides have photos — a
          newbie must always know which column is theirs. No chips, no score
          badges: the photos are the evidence, "why matched?" is on demand. */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          { l: aLabel, img: aImage },
          { l: bLabel, img: bImage },
        ].map((side, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
            <Text style={mr.colHead} numberOfLines={1}>{(side.l || (i === 0 ? 'A' : 'B')).toUpperCase()}</Text>
            <CompareSlot uri={side.img} />
          </View>
        ))}
      </View>
      {!!why && (
        <View style={{ alignItems: 'center', marginTop: 2 }}>
          {showWhy ? (
            <View style={mr.whyChip}>
              <Text style={mr.whyChipText} numberOfLines={1}>{why}</Text>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setShowWhy(true)} hitSlop={{ top: 6, bottom: 6, left: 12, right: 12 }}>
              <Text style={mr.whyLink}>why matched?</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Only the fields that actually DIFFER become choices. */}
      <FieldRows rows={rows} />
    </>
  );
}

// ── FieldRows — the tappable field cells (compare card + tinder card) ──────
// Renders only the rows that differ; tap a side to keep that value.
export function FieldRows({ rows, style }: { rows?: CompareRow[]; style?: any }) {
  const [picks, setPicks] = useState<Record<number, 'a' | 'b'>>(() => {
    const init: Record<number, 'a' | 'b'> = {};
    (rows || []).forEach((r, i) => {
      if (r.pick === 'a') init[i] = 'a';
      else if (r.pick === 'b' || r.pick === 'both' || r.pick === 'sum') init[i] = 'b';
    });
    return init;
  });
  const valFor = (row: CompareRow, side: 'a' | 'b') => {
    if (side === 'b' && row.pick === 'sum') return `= ${row.b}`;
    if (side === 'b' && row.pick === 'both') return `${row.a}+${row.b}`;
    return side === 'a' ? row.a : row.b;
  };
  if (!rows || rows.every((r) => r.same)) return null;
  return (
    <View style={[{ marginTop: 12, gap: 14 }, style]}>
      {rows.map((row, i) => {
        if (row.same) return null;
        const pick = picks[i];
        const stateOf = (side: 'a' | 'b'): CmpState =>
          row.clash ? 'clash' : pick === side ? 'on' : 'off';
        return (
          <View key={i}>
            <Text style={mr.cmpFieldLabel}>{row.f.toUpperCase()}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <CmpCell
                value={valFor(row, 'a')}
                state={stateOf('a')}
                onPress={row.clash ? undefined : () => setPicks((p) => ({ ...p, [i]: 'a' }))}
              />
              <CmpCell
                value={valFor(row, 'b')}
                state={stateOf('b')}
                onPress={row.clash ? undefined : () => setPicks((p) => ({ ...p, [i]: 'b' }))}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

type CmpState = 'on' | 'off' | 'match' | 'clash';

// One form-sized compare cell — flex half, minHeight 48, tap to keep.
function CmpCell({ value, state, onPress }: { value: string; state: CmpState; onPress?: () => void }) {
  const on = state === 'on';
  const clash = state === 'clash';
  const match = state === 'match';
  const border = clash ? RC.danger : on ? RC.green : RC.line;
  const bg = clash ? RC.dangerSoft : on ? RC.greenSoft : match ? RC.surface : '#fff';
  const color = clash ? RC.dangerInk : on ? RC.greenInk : match ? RC.muted : RC.ink;
  const Comp: any = onPress ? TouchableOpacity : View;
  return (
    <Comp activeOpacity={0.8} onPress={onPress} style={[mr.cmpCell, { borderColor: border, backgroundColor: bg }]}>
      {on && <MaterialCommunityIcons name="check" size={16} color={RC.greenDark} />}
      {/* Wrap up to 3 lines — a choice you can't read isn't a choice. */}
      <Text style={[mr.cmpCellText, { color }]} numberOfLines={3}>{value}</Text>
    </Comp>
  );
}

function CompareSlot({ uri }: { uri?: string | null }) {
  return (
    <View style={mr.cmpSlot}>
      {uri ? (
        <Thumb uri={uri} size={108} radius={12} />
      ) : (
        <MaterialCommunityIcons name="image-off-outline" size={28} color={RC.faint} />
      )}
    </View>
  );
}

function MR_Compare({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind={c.kind === 'collision' ? 'check' : 'duplicate'}
      title={c.title}
      note={c.note}
      topInset={topInset}
      onBack={onBack}
      primary={c.kind === 'collision' ? 'Keep as 2' : 'Merge'}
      primaryIcon={c.kind === 'collision' ? 'check' : 'merge'}
      alt={c.kind === 'collision' ? 'Merge them' : 'Keep both'}
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
      onIgnore={() => onResolve('alt', { ignore: true })}
    >
      <CompareBody {...c} />
    </ResolveShell>
  );
}

// ═══ CONSOLIDATE many→1 — select rows, ★ a master ═════════════════════════
function MR_Consolidate({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const items = c.candidates || [];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="combine"
      title="Same product?"
      note={c.note || `${items.length} listings look like one`}
      topInset={topInset}
      onBack={onBack}
      primary="Combine"
      primaryIcon="merge"
      alt="Keep apart"
      onPrimary={() => onResolve('primary', { selectedIds: items.map((x) => x.id) })}
      onAlt={() => onResolve('alt')}
    >
      <Accordion flat label="SEPARATE NOW" title={`${items.length} listings`} count={items.length} defaultOpen>
        {items.map((x) => (
          <SeparateCard key={x.id} title={x.title} sub={x.sub} uri={x.uri} />
        ))}
      </Accordion>
      <FlowArrow />
      <Text style={mr.ioLabel}>BECOMES ONE PRODUCT</Text>
      <ProductCard
        title={items[0]?.title || 'Combined product'}
        image={items.find((x) => x.uri)?.uri}
        variants={items.map((x) => ({ label: variantOption(x.title), sub: x.sub, uri: x.uri }))}
      />
    </ResolveShell>
  );
}

// ═══ FIND — live catalog search + candidate results ═══════════════════════
// One decision: link to a catalog item (pre-picked when the backend has a
// confident candidate) or add as new. The search box is REAL — typing filters
// the user's catalog so "find the right product" never means leaving the card.
function MR_Find({ c, idx, total, topInset, onBack, onResolve, onSearch }: RProps) {
  const initial = c.candidates || [];
  const [picked, setPicked] = useState<string | null>(initial.find((x) => x.on)?.id || null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CandidateItem[]>(initial);

  useEffect(() => {
    const q = query.trim();
    if (!q || !onSearch) {
      setResults(initial);
      return;
    }
    const t = setTimeout(() => setResults(onSearch(q)), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, onSearch]);

  const pickedItem = [...initial, ...results].find((x) => x.id === picked);

  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="find"
      title={c.title || 'Find its match'}
      note={c.note || 'No SKU matched'}
      topInset={topInset}
      onBack={onBack}
      primary={pickedItem ? `Link to ${trim(pickedItem.title, 9)}` : 'Add as new'}
      primaryIcon={pickedItem ? 'link-variant' : 'plus'}
      alt={pickedItem ? 'Add as new' : undefined}
      onPrimary={() => onResolve('primary', pickedItem ? { linkTo: pickedItem } : undefined)}
      onAlt={() => onResolve('alt')}
      onIgnore={() => onResolve('alt', { ignore: true })}
    >
      <Row>
        <Thumb uri={c.itemImage} size={32} radius={7} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={mr.title} numberOfLines={1}>{c.itemTitle}</Text>
          <Text style={[mr.meta, { color: RC.danger }]} numberOfLines={1}>{c.itemSub || 'no SKU'}</Text>
        </View>
      </Row>

      {!!onSearch && (
        <View style={mr.searchBox}>
          <MaterialCommunityIcons name="magnify" size={18} color={RC.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your catalog…"
            placeholderTextColor={RC.faint}
            style={mr.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="close-circle" size={18} color={RC.faint} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {results.map((x) => (
        <ResultRow
          key={x.id}
          on={picked === x.id}
          title={x.title}
          sub={x.sub}
          hint={x.hint}
          uri={x.uri}
          onPress={() => setPicked((p) => (p === x.id ? null : x.id))}
        />
      ))}
      {results.length === 0 && (
        <Text style={mr.legend}>
          {query.trim() ? 'Nothing in your catalog matches — use “Add as new product”.' : 'Type to search your catalog, or add it as a new product.'}
        </Text>
      )}
    </ResolveShell>
  );
}

// ═══ SPLIT 1→many — bundle into pieces ════════════════════════════════════
function MR_Split({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const parts = c.parts || [];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="split"
      title={c.title || 'Split bundle'}
      note={c.note || 'One row holds several SKUs'}
      topInset={topInset}
      onBack={onBack}
      primary={parts.length ? `Split into ${parts.length}` : 'Split'}
      primaryIcon="call-split"
      alt="Keep as one"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
      onIgnore={() => onResolve('alt', { ignore: true })}
    >
      <InStatic label="ONE LISTING" title={c.itemTitle} sub={c.itemSub} uri={c.itemImage} />
      <FlowArrow />
      <Accordion label="SPLITS INTO" title={`${parts.length} products`} count={parts.length} defaultOpen>
        {parts.map((p, i) => (
          <View key={i}>
            {i > 0 ? <View style={mr.varDivider} /> : null}
            <View style={mr.varRow}>
              <Thumb size={38} radius={9} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={mr.varTitle} numberOfLines={1}>{p.name}</Text>
                <Text style={mr.varSub} numberOfLines={1}>{p.sku} · qty {p.qty}</Text>
              </View>
              {p.price !== '—' && <Text style={mr.price}>{p.price}</Text>}
            </View>
          </View>
        ))}
      </Accordion>
    </ResolveShell>
  );
}

// ═══ STRAY VARIANTS — calm default, tap the odd one out ════════════════════
// The classifier already grouped these rows under the parent, so the default
// answer IS the answer: rows sit quiet and one tap confirms the lot. Tapping
// a row EXCLUDES it — exceptions get the loud treatment, not the happy path.
function MR_Variants({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const items = c.candidates || [];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="variants"
      title={c.parentTitle || 'One product, many listings?'}
      note={`${items.length} listings look like one product`}
      topInset={topInset}
      onBack={onBack}
      primary="Group all"
      alt="Keep split"
      onPrimary={() => onResolve('primary', { selectedIds: items.map((x) => x.id) })}
      onAlt={() => onResolve('alt')}
    >
      <Accordion flat label="SEPARATE NOW" title={`${items.length} listings`} count={items.length} defaultOpen>
        {items.map((x) => (
          <SeparateCard key={x.id} title={x.title} sub={x.sub} uri={x.uri} />
        ))}
      </Accordion>
      <FlowArrow />
      <Text style={mr.ioLabel}>BECOMES ONE PRODUCT</Text>
      <ProductCard
        title={c.parentTitle || 'One product'}
        image={items.find((x) => x.uri)?.uri}
        variants={items.map((x) => ({ label: variantOption(x.title), sub: x.sub, uri: x.uri }))}
      />
    </ResolveShell>
  );
}

// ═══ ONE SIDE FLAT — build / flatten / keep separate ══════════════════════
function MR_OneSided({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const [strat, setStrat] = useState(0);
  // Recommended first + preselected — one tap takes the sensible default.
  const opts = [
    { title: 'Use the variants everywhere', sub: 'recommended — the flat side gets the sizes too' },
    { title: 'Flatten to one listing', sub: 'drop the variants on both sides' },
    { title: 'Keep them separate', sub: 'don’t link these two listings' },
  ];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="variants"
      title={c.title || 'One side flat'}
      note={c.note || 'One platform has sizes, the other is a single listing'}
      topInset={topInset}
      onBack={onBack}
      primary={strat === 0 ? 'Use variants' : strat === 1 ? 'Flatten' : 'Keep separate'}
      primaryIcon={strat === 0 ? 'plus' : strat === 1 ? 'arrow-collapse' : 'check'}
      alt="Decide later"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SideMini plat={c.aLabel || 'A'} txt={c.aChip || 'flat · 1'} tone={c.aTone || 'warn'} />
        <SideMini plat={c.bLabel || 'B'} txt={c.bChip || 'variants'} tone={c.bTone || 'ok'} />
      </View>
      {opts.map((o, i) => (
        <OptionRow key={i} on={strat === i} title={o.title} sub={o.sub} onPress={() => setStrat(i)} />
      ))}
    </ResolveShell>
  );
}

// ═══ ALIGN VARIANTS — everything syncs by default, tap a row to skip it ════
// The old 4-state verb cycle (Merge / +A / +B / Ignore) made the user pick
// machinery the backend already knows: a pair with both sides merges, a pair
// with a missing side gets created there. The only human call is "skip this
// one" — so each row is a simple include/exclude toggle, defaulted to ON.
function MR_Align({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const pairs = c.candidates || [];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="variants"
      title="Match these sizes?"
      note={`Both sides have ${pairs.length} variants`}
      topInset={topInset}
      onBack={onBack}
      primary="Sync all"
      primaryIcon="check"
      alt="Skip"
      onPrimary={() => onResolve('primary', { selectedIds: pairs.map((p) => p.id) })}
      onAlt={() => onResolve('alt')}
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SideMini plat={c.aLabel || 'Incoming'} txt={c.aChip || `${pairs.length} variants`} tone="ok" />
        <SideMini plat={c.bLabel || 'In catalog'} txt={c.bChip || `${pairs.length} variants`} tone="ok" />
      </View>
      <MergeSummary count={pairs.length} outcome="variants synced both ways" />
    </ResolveShell>
  );
}

// ═══ STALE — a link whose partner moved or vanished ═══════════════════════
// Opens with the backend's best relink candidate pre-picked (one tap fixes
// it). The search box is live — "Search again" used to be a button that
// silently resolved the card; now searching never costs a decision.
function MR_Stale({ c, idx, total, topInset, onBack, onResolve, onSearch }: RProps) {
  const initial = c.candidates || [];
  const [picked, setPicked] = useState<string | null>(initial.find((x) => x.on)?.id || null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CandidateItem[]>(initial);

  useEffect(() => {
    const q = query.trim();
    if (!q || !onSearch) {
      setResults(initial);
      return;
    }
    const t = setTimeout(() => setResults(onSearch(q)), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, onSearch]);

  const pickedItem = [...initial, ...results].find((x) => x.id === picked);

  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="relink"
      title={c.title || 'Match broke'}
      note={c.note || 'The linked listing changed under it'}
      topInset={topInset}
      onBack={onBack}
      primary={pickedItem ? 'Relink' : 'Unlink'}
      primaryIcon={pickedItem ? 'link-variant' : 'link-variant-off'}
      alt={pickedItem ? 'Unlink' : undefined}
      onPrimary={() => onResolve('primary', pickedItem ? { linkTo: pickedItem } : { unlink: true })}
      onAlt={() => onResolve('alt', { unlink: true })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 6 }}>
        <View style={mr.linkSide}>
          <Thumb size={28} radius={5} />
          <View style={{ minWidth: 0 }}>
            <Text style={mr.title} numberOfLines={1}>{c.itemTitle}</Text>
            <Text style={mr.meta} numberOfLines={1}>{c.itemSub || 'in catalog'}</Text>
          </View>
        </View>
        <View style={mr.linkX}>
          <MaterialCommunityIcons name="link-variant-off" size={15} color={RC.danger} />
        </View>
        <View style={[mr.linkSide, { borderStyle: 'dashed', borderColor: RC.danger, backgroundColor: RC.dangerSoft }]}>
          <View style={{ minWidth: 0 }}>
            <Text style={[mr.title, { color: RC.dangerInk, textDecorationLine: 'line-through' }]} numberOfLines={1}>{c.itemTitle}</Text>
            <Text style={[mr.meta, { color: RC.dangerInk }]} numberOfLines={1}>{c.platform ? `gone from ${c.platform}` : 'gone'}</Text>
          </View>
        </View>
      </View>
      <Text style={mr.sectionMono}>{c.platform ? `FOUND AGAIN ON ${c.platform.toUpperCase()}` : 'RELINK TO'}</Text>
      {!!onSearch && (
        <View style={mr.searchBox}>
          <MaterialCommunityIcons name="magnify" size={18} color={RC.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your catalog…"
            placeholderTextColor={RC.faint}
            style={mr.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="close-circle" size={18} color={RC.faint} />
            </TouchableOpacity>
          )}
        </View>
      )}
      {results.map((x) => (
        <ResultRow key={x.id} on={picked === x.id} title={x.title} sub={x.sub} hint={x.hint} uri={x.uri} onPress={() => setPicked((p) => (p === x.id ? null : x.id))} />
      ))}
      {results.length === 0 && (
        <Text style={mr.legend}>
          {query.trim() ? 'No catalog match — unlinking keeps your catalog item as-is.' : 'Pick a result to relink, or unlink to keep your catalog item.'}
        </Text>
      )}
    </ResolveShell>
  );
}

// ═══ ORPHAN — in catalog, absent from this import ═════════════════════════
function MR_Orphan({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const [strat, setStrat] = useState(0);
  // Two real choices — the old third option ("Ignore this gap") was just
  // "Decide later" wearing a costume, so it lives in the grey button only.
  const opts = [
    { title: 'Keep it listed', sub: 'it still sells elsewhere — leave it live' },
    { title: 'Mark sold · delist', sub: 'take it down on every platform' },
  ];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="missing"
      title={c.title || 'Still selling this?'}
      note={c.note || (c.platform ? `In your catalog · ${c.platform} didn’t send it back` : 'In your catalog · not in this import')}
      topInset={topInset}
      onBack={onBack}
      primary={strat === 0 ? 'Keep listed' : 'Delist'}
      primaryIcon={strat === 0 ? 'check' : 'cancel'}
      alt="Decide later"
      onPrimary={() => onResolve('primary', strat === 1 ? { unlink: true } : undefined)}
      onAlt={() => onResolve('alt')}
    >
      <Row>
        <Thumb uri={c.itemImage} size={30} radius={6} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={mr.title} numberOfLines={1}>{c.itemTitle}</Text>
          <Text style={mr.meta} numberOfLines={1}>{c.itemSub}</Text>
        </View>
        {!!c.platform && <PlatTag name={c.platform} />}
      </Row>
      {opts.map((o, i) => (
        <OptionRow key={i} on={strat === i} title={o.title} sub={o.sub} onPress={() => setStrat(i)} />
      ))}
    </ResolveShell>
  );
}

// ═══ CONFIRM FUZZY — Tinder deck, one match at a time ══════════════════════
// Dead simple: a tiny blurb up top, the two photos in the middle, two
// buttons at the bottom. Yes links them · No sends it to the deck for a
// closer look. No percentages, no list, no clutter.
function MR_FuzzyBatch({ c, topInset, onBack, onResolve }: RProps) {
  const items = c.candidates || [];
  const [i, setI] = useState(0);
  const [linked, setLinked] = useState<string[]>([]);
  const [flash, setFlash] = useState<null | 'yes' | 'no'>(null);
  const cur = items[Math.min(i, items.length - 1)];

  const decide = (yes: boolean) => {
    if (!cur || flash) return;
    setFlash(yes ? 'yes' : 'no');
    setTimeout(() => {
      setFlash(null);
      const nextLinked = yes ? [...linked, cur.id] : linked;
      if (yes) setLinked(nextLinked);
      if (i + 1 < items.length) setI(i + 1);
      else onResolve('primary', { selectedIds: nextLinked });
    }, 240);
  };

  if (!cur) return <></>;
  return (
    <ResolveShell
      idx={i + 1}
      total={items.length}
      title="Same item?"
      note="Yes links them · No takes a closer look later"
      topInset={topInset}
      onBack={onBack}
      scroll={false}
      primary="Same"
      primaryIcon="check"
      alt="Different"
      onPrimary={() => decide(true)}
      onAlt={() => decide(false)}
    >
      <View key={cur.id} style={mr.tinderWrap}>
        {/* Left = my catalog (the field cells' left side too) · right = incoming. */}
        <View style={[mr.tinderPair, flash && { transform: [{ scale: 0.97 }] }]}>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={mr.colHead} numberOfLines={1}>{(c.aLabel || 'My catalog').toUpperCase()}</Text>
            <View style={mr.tinderSlot}>
              {cur.uri2 ? (
                <Image source={{ uri: cur.uri2 }} style={{ width: '100%', height: '100%' }} />
              ) : (
                <MaterialCommunityIcons name="image-off-outline" size={30} color={RC.faint} />
              )}
            </View>
          </View>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={mr.colHead} numberOfLines={1}>{(c.bLabel || 'Incoming').toUpperCase()}</Text>
            <View style={mr.tinderSlot}>
              {cur.uri ? (
                <Image source={{ uri: cur.uri }} style={{ width: '100%', height: '100%' }} />
              ) : (
                <MaterialCommunityIcons name="image-off-outline" size={30} color={RC.faint} />
              )}
            </View>
          </View>
          {!!flash && (
            <View style={[mr.tinderFlash, { backgroundColor: flash === 'yes' ? RC.green : RC.ink }]}>
              <MaterialCommunityIcons name={flash === 'yes' ? 'check' : 'close'} size={26} color="#fff" />
            </View>
          )}
        </View>
        <Text style={mr.tinderTitle} numberOfLines={2}>{cur.title}</Text>
        {!!cur.sub && <Text style={mr.tinderMeta} numberOfLines={1}>{cur.sub}</Text>}
        <FieldRows rows={cur.rows} style={{ alignSelf: 'stretch', marginTop: 16 }} />
      </View>
    </ResolveShell>
  );
}

// ═══ ORPHANS (batch) — everything missing from the import, ONE card ════════
// 287 catalog items the platform didn't send back used to mean 287 separate
// cards. Nobody does that. Rows sit calm (kept by default); tapping one marks
// it GONE — red, unmistakable. One green button answers the whole card.
function MR_OrphanBatch({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const items = c.candidates || [];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="missing"
      title="Still selling these?"
      note={`${items.length} weren’t in this import`}
      topInset={topInset}
      onBack={onBack}
      primary="Keep all"
      primaryIcon="check"
      alt="Decide later"
      onPrimary={() => onResolve('primary', { selectedIds: items.map((x) => x.id) })}
      onAlt={() => onResolve('alt')}
    >
      {items.map((x) => (
        <View key={x.id} style={mr.roRow}>
          <Thumb uri={x.uri} size={36} radius={9} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={mr.roTitle} numberOfLines={1}>{x.title}</Text>
            {!!x.sub && <Text style={mr.roSub} numberOfLines={1}>{x.sub}</Text>}
          </View>
        </View>
      ))}
    </ResolveShell>
  );
}

// ═══ KIT ↔ SINGLES — set on one platform, pieces on another ═══════════════
function MR_Kit({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const parts = c.candidates || [];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="kit"
      title={c.title || 'Kit ↔ singles'}
      note={c.note || 'One platform sells the set, another the pieces'}
      topInset={topInset}
      onBack={onBack}
      primary={parts.length ? `Link ${parts.length} pieces` : 'Link pieces'}
      primaryIcon="merge"
      alt="Keep apart"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
      onIgnore={() => onResolve('alt', { ignore: true })}
    >
      <InStatic label="THE SET" title={c.itemTitle} sub={c.itemSub} uri={c.itemImage} />
      <FlowArrow />
      <Accordion label="SAME STOCK AS" title={`${parts.length} pieces`} count={parts.length} defaultOpen>
        <ItemRows items={parts} />
      </Accordion>
    </ResolveShell>
  );
}

// ── small shared bits ──────────────────────────────────────────────────────
function SideMini({ plat, txt, tone }: { plat: string; txt: string; tone: Tone }) {
  const c = tone === 'warn' ? RC.warn : RC.greenDark;
  return (
    <View style={mr.sideMini}>
      <PlatTag name={plat} />
      <Text style={[mr.sideMiniTxt, { color: c }]} numberOfLines={1}>{txt}</Text>
    </View>
  );
}
function VBox({ val, missing }: { val: string; missing?: boolean }) {
  return (
    <View style={[mr.vbox, { borderColor: missing ? RC.line : RC.muted, backgroundColor: missing ? RC.surface : '#fff' }]}>
      <Text style={[mr.vboxText, { color: missing ? RC.faint : RC.ink }]} numberOfLines={1}>{val}</Text>
    </View>
  );
}

// ── In → Out flow — what you have vs what it becomes ───────────────────────
// One collapsed accordion for the many-side (the listings/pieces), a static
// block for the one-side (the product). Tap to expand and see the actuals.
function Accordion({ label, title, count, defaultOpen, flat, children }: {
  label?: string;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  flat?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <View>
      {!!label && <Text style={mr.ioLabel}>{label}</Text>}
      <TouchableOpacity activeOpacity={0.7} onPress={() => setOpen((o) => !o)} style={mr.accHead}>
        <Text style={mr.accTitle} numberOfLines={1}>{title}</Text>
        {count != null && (
          <View style={mr.accCount}><Text style={mr.accCountText}>{count}</Text></View>
        )}
        <View style={{ flex: 1 }} />
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={RC.muted} />
      </TouchableOpacity>
      {open ? <View style={flat ? mr.accBodyFlat : mr.accBody}>{children}</View> : null}
    </View>
  );
}

// readable variant option from a noisy title ("THIA17-Weight:Md" → "Weight: Md")
function variantOption(title: string): string {
  if (title.includes(':')) {
    const [k, v] = title.split(':');
    const key = (k.split('-').pop() || k).trim();
    return v ? `${key}: ${v.trim()}` : title;
  }
  return title;
}

// A standalone "separate listing" card — how an item looks on its own (before).
function SeparateCard({ title, sub, uri }: { title: string; sub?: string; uri?: string | null }) {
  return (
    <View style={mr.sepCard}>
      <Thumb uri={uri} size={40} radius={10} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={mr.sepTitle} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={mr.sepSub} numberOfLines={1}>{sub}</Text>}
      </View>
    </View>
  );
}

// The end product, inventory-list style: a product header with its variants
// stacked underneath (indented rows, with images).
function ProductCard({ title, image, variants }: {
  title: string;
  image?: string | null;
  variants: { label: string; sub?: string; uri?: string | null }[];
}) {
  return (
    <View style={mr.prodCard}>
      <View style={mr.prodHead}>
        <Thumb uri={image} size={50} radius={11} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={mr.prodTitle} numberOfLines={2}>{title}</Text>
          <Text style={mr.prodMeta}>{variants.length} variant{variants.length === 1 ? '' : 's'}</Text>
        </View>
      </View>
      <View style={mr.prodVarsWrap}>
        {variants.map((v, i) => (
          <View key={i} style={mr.prodVarRow}>
            <Thumb uri={v.uri} size={30} radius={7} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={mr.prodVarLabel} numberOfLines={1}>{v.label}</Text>
              {!!v.sub && <Text style={mr.prodVarSub} numberOfLines={1}>{v.sub}</Text>}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function FlowArrow() {
  return (
    <View style={mr.flowArrow}>
      <MaterialCommunityIcons name="arrow-down" size={20} color={RC.faint} />
    </View>
  );
}

function OutBlock({ label, title, sub }: { label: string; title: string; sub?: string }) {
  return (
    <View>
      <Text style={mr.ioLabel}>{label}</Text>
      <View style={mr.outBlock}>
        <View style={mr.outIcon}>
          <MaterialCommunityIcons name="package-variant-closed" size={20} color={RC.greenDark} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={mr.outTitle} numberOfLines={1}>{title}</Text>
          {!!sub && <Text style={mr.outSub} numberOfLines={1}>{sub}</Text>}
        </View>
      </View>
    </View>
  );
}

function InStatic({ label, title, sub, uri }: { label: string; title?: string; sub?: string; uri?: string | null }) {
  return (
    <View>
      <Text style={mr.ioLabel}>{label}</Text>
      <View style={mr.inStatic}>
        <Thumb uri={uri} size={38} radius={9} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={mr.roTitle} numberOfLines={1}>{title || 'Item'}</Text>
          {!!sub && <Text style={mr.roSub} numberOfLines={1}>{sub}</Text>}
        </View>
      </View>
    </View>
  );
}

// The accordion's open content: ONE card, the items as rows divided by hairlines
// (the Paper "Variants" card) — not flat separate boxes. accBody is the card.
function ItemRows({ items }: { items: CandidateItem[] }) {
  return (
    <>
      {items.map((x, i) => (
        <View key={x.id}>
          {i > 0 ? <View style={mr.varDivider} /> : null}
          <View style={mr.varRow}>
            <Thumb uri={x.uri} size={38} radius={9} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={mr.varTitle} numberOfLines={1}>{x.title}</Text>
              {!!x.sub && <Text style={mr.varSub} numberOfLines={1}>{x.sub}</Text>}
            </View>
            {!!x.plat && <PlatTag name={x.plat} />}
          </View>
        </View>
      ))}
    </>
  );
}
function trim(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// A read-only "N → 1" summary — what grouping/merging will do, no per-row taps.
function MergeSummary({ count, outcome }: { count: number; outcome: string }) {
  return (
    <View style={mr.mergeWrap}>
      <View style={mr.mergeBadge}>
        <MaterialCommunityIcons name="layers-triple-outline" size={26} color={RC.greenDark} />
        <Text style={mr.mergeCount}>{count}</Text>
        <Text style={mr.mergeCountLabel}>listings</Text>
      </View>
      <MaterialCommunityIcons name="arrow-down" size={22} color={RC.faint} style={{ marginVertical: 10 }} />
      <View style={mr.mergeResult}>
        <MaterialCommunityIcons name="check-circle" size={18} color={RC.green} />
        <Text style={mr.mergeResultText}>{outcome}</Text>
      </View>
    </View>
  );
}


// ── Dispatcher ─────────────────────────────────────────────────────────────
const REGISTRY: Record<MatchKind, (p: RProps) => React.ReactElement> = {
  compare: MR_Compare,
  collision: MR_Compare,
  consolidate: MR_Consolidate,
  find: MR_Find,
  split: MR_Split,
  variants: MR_Variants,
  onesided: MR_OneSided,
  align: MR_Align,
  stale: MR_Stale,
  orphan: MR_Orphan,
  orphans: MR_OrphanBatch,
  fuzzy: MR_FuzzyBatch,
  kit: MR_Kit,
};

// ── Five-card mental model ─────────────────────────────────────────────────
// The 13 classifier kinds collapse into the five cards the seller reasons about.
// Find splits by whether there's a catalog candidate: with one it's a Match
// (link by hand), with none it's a Create (add as new).
const CARD = {
  create: { label: 'Create', color: '#16A34A' },
  merge: { label: 'Split / Merge', color: '#7C3AED' },
  verify: { label: 'Verify', color: '#2563EB' },
  match: { label: 'Match', color: '#0891B2' },
  ignore: { label: 'Ignore', color: '#6B7280' },
} as const;

export function cardBadgeFor(c: MatchCase): { label: string; color: string } {
  switch (c.kind) {
    case 'compare':
    case 'collision':
    case 'fuzzy':
    case 'stale':
      return CARD.verify;
    case 'consolidate':
    case 'split':
    case 'kit':
    case 'variants':
    case 'onesided':
    case 'align':
      return CARD.merge;
    case 'orphan':
    case 'orphans':
      return CARD.ignore;
    case 'find':
      return c.candidates && c.candidates.length ? CARD.match : CARD.create;
    default:
      return CARD.match;
  }
}

export function MatchResolver(props: RProps) {
  const Comp = REGISTRY[props.c.kind] || MR_Find;
  return (
    <ResolveBadge.Provider value={cardBadgeFor(props.c)}>
      <Comp {...props} />
    </ResolveBadge.Provider>
  );
}

const mr = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '600', color: RC.ink },
  meta: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 2 },
  mono: { fontSize: 15, fontWeight: '600', color: RC.ink },
  price: { fontSize: 15, fontWeight: '700', color: RC.greenDark },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },

  // clean tap-to-exclude row (replaces the double-checkbox motif)
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58, borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff' },
  pickRowOff: { backgroundColor: RC.surface, opacity: 0.7 },
  pickTitle: { fontSize: 16, fontWeight: '600', color: RC.ink },
  pickStruck: { color: RC.faint, textDecorationLine: 'line-through' },
  pickSub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 2 },
  removedChip: { backgroundColor: RC.surface2, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  removedChipText: { fontSize: 12.5, fontWeight: '700', color: RC.muted },

  // read-only row (no tap) — shows what's being decided
  roRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: '#fff' },
  roTitle: { fontSize: 15.5, fontWeight: '700', color: RC.ink },
  roSub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 2 },

  // in → out accordion flow
  ioLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: RC.faint, marginBottom: 6, marginTop: 2 },
  accHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: RC.surface },
  accTitle: { fontSize: 16, fontWeight: '700', color: RC.ink },
  accCount: { backgroundColor: RC.greenSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  accCountText: { fontSize: 12.5, fontWeight: '800', color: RC.greenDark },
  accBody: { marginTop: 8, borderWidth: 1, borderColor: RC.line, borderRadius: 14, backgroundColor: '#fff', overflow: 'hidden' },
  varRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  varDivider: { height: 1, backgroundColor: '#F2F4F6' },
  varTitle: { fontSize: 15.5, fontWeight: '700', color: RC.ink },
  varSub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 2 },
  flowArrow: { alignItems: 'center', paddingVertical: 8 },
  outBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderWidth: 1.5, borderColor: RC.greenLine, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: RC.greenSoft },
  outIcon: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: RC.greenLine },
  outTitle: { fontSize: 16, fontWeight: '800', color: RC.greenInk },
  outSub: { fontSize: 13, fontWeight: '600', color: RC.greenDark, marginTop: 2 },
  inStatic: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff' },
  accBodyFlat: { marginTop: 8, gap: 8 },

  // separate "before" cards
  sepCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff' },
  sepTitle: { fontSize: 15, fontWeight: '700', color: RC.ink },
  sepSub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 2 },

  // product "after" card — inventory style, variants stacked underneath
  prodCard: { borderWidth: 1.5, borderColor: RC.greenLine, borderRadius: 16, backgroundColor: '#fff', overflow: 'hidden' },
  prodHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: RC.greenSoft },
  prodTitle: { fontSize: 16, fontWeight: '800', color: RC.greenInk, letterSpacing: -0.2 },
  prodMeta: { fontSize: 13, fontWeight: '600', color: RC.greenDark, marginTop: 2 },
  prodVarsWrap: { paddingLeft: 18, paddingRight: 12 },
  prodVarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F2F4F6' },
  prodVarLabel: { fontSize: 14.5, fontWeight: '600', color: RC.ink },
  prodVarSub: { fontSize: 12.5, fontWeight: '500', color: RC.muted, marginTop: 1 },

  // merge summary (N → 1)
  mergeWrap: { alignItems: 'center', paddingVertical: 24 },
  mergeBadge: { alignItems: 'center', justifyContent: 'center', width: 156, paddingVertical: 22, borderRadius: 20, borderWidth: 1, borderColor: RC.greenLine, backgroundColor: RC.greenSoft },
  mergeCount: { fontSize: 36, fontWeight: '800', color: RC.greenInk, letterSpacing: -1, marginTop: 6 },
  mergeCountLabel: { fontSize: 13, fontWeight: '600', color: RC.greenDark },
  mergeResult: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: RC.line, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: '#fff' },
  mergeResultText: { fontSize: 15, fontWeight: '700', color: RC.ink },

  // merge outcome footer (under a list)
  outcomeRow: { alignItems: 'center', gap: 6, marginTop: 6 },
  outcomePill: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: RC.greenLine, backgroundColor: RC.greenSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  outcomeText: { fontSize: 14, fontWeight: '700', color: RC.greenDark },

  // compare — taller image row + side-by-side form-sized cells (ListingEditorForm scale)
  colHead: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: RC.muted },
  cmpSlot: { width: '100%', height: 120, borderRadius: 14, borderWidth: 1, borderColor: RC.line, backgroundColor: RC.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  whyLink: { fontSize: 13, fontWeight: '700', color: RC.muted, textDecorationLine: 'underline' },
  whyChip: { backgroundColor: RC.greenSoft, borderWidth: 1, borderColor: RC.greenLine, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  whyChipText: { fontSize: 12.5, fontWeight: '600', color: RC.greenDark },
  cmpFieldLabel: { fontSize: 12, fontWeight: '600', color: '#374151', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  cmpCell: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 48, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  cmpCellText: { fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'center' },

  // consolidate
  masterTag: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1.4, borderColor: RC.green, backgroundColor: RC.greenSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  masterText: { fontSize: 10, fontWeight: '700', color: RC.greenDark },

  // find / stale — real catalog search (ListingEditorForm input scale)
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderWidth: 1.5, borderColor: RC.ink, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500', color: RC.ink, paddingVertical: 12 },

  // split / kit
  bundleHead: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10 },
  bundleTitle: { fontSize: 15, fontWeight: '700', color: RC.ink },
  divLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  divLine: { flex: 1, height: 1, backgroundColor: RC.line },
  divLabelText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: RC.faint },

  // variants
  parentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  parentTitle: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: RC.ink },
  parentBadge: { backgroundColor: RC.greenSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  parentBadgeText: { fontSize: 11, fontWeight: '700', color: RC.greenDark },
  placeTag: { fontSize: 12, fontWeight: '700', maxWidth: 110, textAlign: 'right' },
  goneTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fff', borderWidth: 1.4, borderColor: RC.dangerLine, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  goneTagText: { fontSize: 12, fontWeight: '700', color: RC.dangerInk },

  // fuzzy — tinder card
  priceWarn: { color: RC.orangeDark, fontWeight: '700' },
  tinderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 24 },
  tinderPair: { flexDirection: 'row', gap: 12, position: 'relative' },
  tinderSlot: { width: 150, height: 150, borderRadius: 20, borderWidth: 1, borderColor: RC.line, backgroundColor: RC.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tinderFlash: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -26, left: '50%', marginLeft: -26, width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 6 },
  tinderTitle: { fontSize: 17, fontWeight: '700', color: RC.ink, textAlign: 'center', marginTop: 18, paddingHorizontal: 24, letterSpacing: -0.2 },
  tinderMeta: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 6 },

  // onesided / align — even (flex 1), form-sized side panels
  sideMini: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 52, borderWidth: 1, borderColor: RC.line, borderRadius: 12, backgroundColor: RC.surface, paddingHorizontal: 12, paddingVertical: 10 },
  sideMiniTxt: { marginLeft: 'auto', fontSize: 14, fontWeight: '700' },
  vbox: { width: 56, alignItems: 'center', borderWidth: 1.2, borderRadius: 8, paddingVertical: 8 },
  vboxText: { fontSize: 14, fontWeight: '700' },
  verb: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  verbText: { fontSize: 13, fontWeight: '700' },
  legend: { fontSize: 13, fontWeight: '500', color: RC.faint, marginTop: 2, lineHeight: 18 },

  // stale
  linkSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60, borderWidth: 1, borderColor: RC.line, borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 10 },
  linkX: { width: 20, alignItems: 'center', justifyContent: 'center' },
  sectionMono: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: RC.faint, marginTop: 2 },
});
