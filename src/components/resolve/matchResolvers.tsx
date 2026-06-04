// matchResolvers — the 11 Match·Resolve v2 screens (one interaction per problem).
// Faithful hi-fi translations of wireframes-match-resolve.jsx, fed by the real
// mapping draft (MappingSuggestion). Each resolver owns its local decision state
// and commits via the ResolveShell footer (one primary + a quiet alt).

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
  RC,
  ResolveShell,
  Row,
  Check,
  Radio,
  Thumb,
  PlatTag,
  Chip,
  ResultRow,
  OptionRow,
  Banner,
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
}

export type Decision = 'primary' | 'alt';

interface RProps {
  c: MatchCase;
  idx: number;
  total: number;
  topInset: number;
  onBack: () => void;
  onResolve: (d: Decision) => void;
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
}: Pick<MatchCase, 'aLabel' | 'bLabel' | 'aChip' | 'bChip' | 'aTone' | 'bTone' | 'aImage' | 'bImage' | 'rows'>) {
  const [picks, setPicks] = useState<Record<number, 'a' | 'b'>>(() => {
    const init: Record<number, 'a' | 'b'> = {};
    (rows || []).forEach((r, i) => {
      if (r.pick === 'a') init[i] = 'a';
      else if (r.pick === 'b' || r.pick === 'both' || r.pick === 'sum') init[i] = 'b';
    });
    return init;
  });

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          { l: aLabel, c: aChip, t: aTone, img: aImage },
          { l: bLabel, c: bChip, t: bTone, img: bImage },
        ].map((side, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <CompareSlot uri={side.img} label={side.l || ''} />
            {!!side.c && <Chip label={side.c} tone={side.t} size={10} />}
          </View>
        ))}
      </View>

      <View style={{ marginTop: 4 }}>
        {(rows || []).map((row, i) => {
          const pick = picks[i];
          const Cell = ({ side, val }: { side: 'a' | 'b'; val: string }) => {
            const picked = pick === side;
            const clash = row.clash;
            const same = row.same;
            return (
              <TouchableOpacity
                activeOpacity={same || clash ? 1 : 0.7}
                disabled={same || clash}
                onPress={() => setPicks((p) => ({ ...p, [i]: side }))}
                style={[
                  mr.cell,
                  {
                    backgroundColor: clash ? RC.dangerSoft : picked ? RC.greenSoft : same ? RC.surface : '#fff',
                    borderColor: clash ? RC.danger : picked ? RC.green : same ? RC.line : RC.faint,
                  },
                ]}
              >
                {picked && !clash && <MaterialCommunityIcons name="check" size={11} color={RC.greenDark} />}
                <Text
                  style={[mr.cellText, { color: clash ? RC.dangerInk : picked ? RC.greenDark : RC.ink, fontWeight: picked || clash ? '700' : '500' }]}
                  numberOfLines={1}
                >
                  {row.pick === 'sum' && side === 'b' ? `= ${row.b}` : row.pick === 'both' && side === 'b' ? `${row.a}+${row.b}` : val}
                </Text>
              </TouchableOpacity>
            );
          };
          return (
            <View key={i} style={mr.cmpRow}>
              <Text style={mr.cmpField}>{row.f.toUpperCase()}</Text>
              <Cell side="a" val={row.a} />
              <Cell side="b" val={row.b} />
            </View>
          );
        })}
      </View>
    </>
  );
}

function CompareSlot({ uri, label }: { uri?: string | null; label: string }) {
  return (
    <View style={mr.cmpSlot}>
      {uri ? (
        <Thumb uri={uri} size={56} radius={9} />
      ) : (
        <Text style={mr.cmpSlotLabel} numberOfLines={1}>{label}</Text>
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
      primary={c.kind === 'collision' ? 'Keep as 2 items' : 'Merge into one'}
      primaryIcon={c.kind === 'collision' ? 'check' : 'merge'}
      alt={c.kind === 'collision' ? "They're the same → merge" : 'Not a duplicate — keep both'}
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      <CompareBody {...c} />
    </ResolveShell>
  );
}

// ═══ CONSOLIDATE many→1 — select rows, ★ a master ═════════════════════════
function MR_Consolidate({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const initial = c.candidates || [];
  const [sel, setSel] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initial.map((x) => [x.id, x.on !== false])),
  );
  const [master, setMaster] = useState<string>(() => initial.find((x) => x.master)?.id || initial[0]?.id || '');
  const count = Object.values(sel).filter(Boolean).length;

  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="combine"
      title={c.title}
      note={c.note || 'Tick the same product · ★ the master'}
      topInset={topInset}
      onBack={onBack}
      primary={`Combine ${count} into 1`}
      primaryIcon="merge"
      primaryReady={count >= 2}
      primaryGate="Pick at least 2"
      alt="All different — keep apart"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      {initial.map((x) => {
        const on = !!sel[x.id];
        return (
          <Row key={x.id} active={on} onPress={() => setSel((p) => ({ ...p, [x.id]: !p[x.id] }))}>
            <Check on={on} size={18} />
            <Thumb uri={x.uri} size={26} radius={6} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={mr.title} numberOfLines={1}>{x.title}</Text>
              <View style={mr.metaRow}>
                {!!x.plat && <PlatTag name={x.plat} />}
                {!!x.sub && <Text style={mr.meta} numberOfLines={1}>{x.sub}</Text>}
              </View>
            </View>
            {on && (
              <TouchableOpacity onPress={() => setMaster(x.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {master === x.id ? (
                  <View style={mr.masterTag}>
                    <MaterialCommunityIcons name="star" size={11} color={RC.greenDark} />
                    <Text style={mr.masterText}>MASTER</Text>
                  </View>
                ) : (
                  <MaterialCommunityIcons name="star-outline" size={18} color={RC.faint} />
                )}
              </TouchableOpacity>
            )}
          </Row>
        );
      })}
    </ResolveShell>
  );
}

// ═══ FIND — search box + candidate results ════════════════════════════════
function MR_Find({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const initial = c.candidates || [];
  const [picked, setPicked] = useState<string | null>(initial.find((x) => x.on)?.id || null);
  const pickedItem = initial.find((x) => x.id === picked);

  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="find"
      title={c.title || 'Find its match'}
      note={c.note || 'No SKU matched'}
      topInset={topInset}
      onBack={onBack}
      primary={pickedItem ? `Link to ${trim(pickedItem.title, 16)}` : 'Add as new product'}
      primaryIcon={pickedItem ? 'link-variant' : 'plus'}
      alt={pickedItem ? 'None of these — add as new' : 'Search the catalog'}
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      <Row>
        <Thumb uri={c.itemImage} size={32} radius={7} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={mr.title} numberOfLines={1}>{c.itemTitle}</Text>
          <Text style={[mr.meta, { color: RC.danger }]} numberOfLines={1}>{c.itemSub || 'no SKU'}</Text>
        </View>
        <PlatTag name="incoming" />
      </Row>

      <View style={mr.searchBox}>
        <MaterialCommunityIcons name="magnify" size={16} color={RC.muted} />
        <Text style={mr.searchText}>{c.itemTitle?.toLowerCase() || 'search the catalog'}</Text>
      </View>

      {initial.map((x) => (
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
      primary={parts.length ? `Split into ${parts.length} items` : 'Split into pieces'}
      primaryIcon="call-split"
      alt="Keep as one kit"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      <View style={[mr.bundleHead, { borderColor: RC.green, backgroundColor: RC.greenSoft }]}>
        <MaterialCommunityIcons name="package-variant-closed" size={20} color={RC.greenDark} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={mr.bundleTitle} numberOfLines={1}>{c.itemTitle}</Text>
          <Text style={[mr.meta, { color: RC.greenDark }]} numberOfLines={1}>{c.itemSub}</Text>
        </View>
        <MaterialCommunityIcons name="arrow-down" size={18} color={RC.greenDark} />
      </View>
      {parts.map((p, i) => (
        <Row key={i}>
          <Thumb size={24} radius={5} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={mr.title} numberOfLines={1}>{p.name}</Text>
            <Text style={mr.meta} numberOfLines={1}>{p.sku} · qty {p.qty}</Text>
          </View>
          <Text style={mr.price}>{p.price}</Text>
          <MaterialCommunityIcons name="close" size={15} color={RC.faint} />
        </Row>
      ))}
      <TouchableOpacity activeOpacity={0.7} style={mr.addPiece}>
        <MaterialCommunityIcons name="plus" size={14} color={RC.muted} />
        <Text style={mr.addPieceText}>add a piece</Text>
      </TouchableOpacity>
    </ResolveShell>
  );
}

// ═══ STRAY VARIANTS — place each leftover under a parent ═══════════════════
function MR_Variants({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const initial = c.candidates || [];
  const [decided, setDecided] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.filter((x) => x.hint).map((x) => [x.id, x.hint as string])),
  );
  const doneCount = Object.keys(decided).length;

  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="variants"
      title={c.title || 'Stray variants'}
      note={c.note || (c.parentTitle ? `Loose rows that belong under ${c.parentTitle}` : 'Place each loose variant')}
      topInset={topInset}
      onBack={onBack}
      primary={`Confirm ${initial.length} variants`}
      primaryIcon="check"
      primaryReady={doneCount === initial.length && initial.length > 0}
      primaryGate={`${initial.length - doneCount} still unplaced`}
      alt="Skip — keep separate"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      {!!c.parentTitle && (
        <View style={mr.parentRow}>
          <Text style={mr.parentTitle}>{c.parentTitle}</Text>
          <View style={mr.parentBadge}>
            <Text style={mr.parentBadgeText}>{doneCount} placed</Text>
          </View>
          {initial.length - doneCount > 0 && (
            <Text style={mr.parentEmpty}>{initial.length - doneCount} empty</Text>
          )}
        </View>
      )}
      {initial.map((x) => {
        const placed = !!decided[x.id];
        return (
          <Row key={x.id} active={placed} onPress={() => setDecided((p) => (p[x.id] ? omit(p, x.id) : { ...p, [x.id]: x.sub || '→ slot' }))}>
            <Thumb size={26} radius={5} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={mr.mono} numberOfLines={1}>{x.title}</Text>
              {!!x.sub && <Text style={mr.meta} numberOfLines={1}>{x.sub}</Text>}
            </View>
            <View style={[mr.decision, placed ? mr.decisionDone : mr.decisionOpen]}>
              {placed && <MaterialCommunityIcons name="check" size={10} color={RC.greenDark} />}
              <Text style={[mr.decisionText, { color: placed ? RC.greenDark : RC.muted }]} numberOfLines={1}>
                {placed ? decided[x.id] : 'choose…'}
              </Text>
            </View>
          </Row>
        );
      })}
    </ResolveShell>
  );
}

// ═══ ONE SIDE FLAT — build / flatten / keep separate ══════════════════════
function MR_OneSided({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const [strat, setStrat] = useState(0);
  const opts = [
    { title: 'Build variants on the flat side', sub: 'mirror the other listing’s set' },
    { title: 'Flatten to one listing', sub: 'drop the variants' },
    { title: 'Keep separate', sub: 'don’t link the two' },
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
      primary={strat === 0 ? 'Build the variants' : strat === 1 ? 'Flatten to one' : 'Keep separate'}
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

// ═══ ALIGN VARIANTS — one verb per pair ═══════════════════════════════════
const VERBS: { key: string; label: string; icon: any; tone: Tone }[] = [
  { key: 'merge', label: 'Merge', icon: 'check', tone: 'ok' },
  { key: 'addA', label: '+ A', icon: 'plus', tone: 'muted' },
  { key: 'addB', label: '+ B', icon: 'plus', tone: 'muted' },
  { key: 'ignore', label: 'Ignore', icon: 'close', tone: 'muted' },
];
function MR_Align({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const pairs = c.candidates || [];
  const [verbs, setVerbs] = useState<Record<string, number>>(() =>
    Object.fromEntries(pairs.map((p, i) => [p.id, p.hint ? VERBS.findIndex((v) => v.key === p.hint) : 0])),
  );
  const cycle = (id: string) => setVerbs((p) => ({ ...p, [id]: ((p[id] ?? 0) + 1) % VERBS.length }));

  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="variants"
      title={c.title || 'Align variants'}
      note={c.note || 'Both have sizes — set one verb each'}
      topInset={topInset}
      onBack={onBack}
      primary={`Apply ${pairs.length} decisions`}
      primaryIcon="check"
      alt="Decide later"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SideMini plat={c.aLabel || 'A'} txt={c.aChip || 'set A'} tone="ok" />
        <SideMini plat={c.bLabel || 'B'} txt={c.bChip || 'set B'} tone="ok" />
      </View>
      {pairs.map((p) => {
        const v = VERBS[verbs[p.id] ?? 0];
        const [a, b] = (p.title || '— · —').split('·').map((x) => x.trim());
        return (
          <Row key={p.id}>
            <VBox val={a} missing={a === '—'} />
            <MaterialCommunityIcons name="swap-horizontal" size={14} color={RC.faint} />
            <VBox val={b} missing={b === '—'} />
            <TouchableOpacity onPress={() => cycle(p.id)} style={[mr.verb, { borderColor: v.tone === 'ok' ? RC.green : RC.line, backgroundColor: v.tone === 'ok' ? RC.greenSoft : '#fff' }]}>
              <MaterialCommunityIcons name={v.icon} size={11} color={v.tone === 'ok' ? RC.greenDark : RC.muted} />
              <Text style={[mr.verbText, { color: v.tone === 'ok' ? RC.greenDark : RC.muted }]}>{v.label}</Text>
            </TouchableOpacity>
          </Row>
        );
      })}
      <Text style={mr.legend}>Merge = same · + = create there · Ignore = leave off</Text>
    </ResolveShell>
  );
}

// ═══ STALE — a link whose partner moved or vanished ═══════════════════════
function MR_Stale({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const initial = c.candidates || [];
  const [picked, setPicked] = useState<string | null>(initial.find((x) => x.on)?.id || null);
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="relink"
      title={c.title || 'Match broke'}
      note={c.note || 'The linked listing changed under it'}
      topInset={topInset}
      onBack={onBack}
      primary={picked ? 'Relink to this' : 'Unlink'}
      primaryIcon={picked ? 'link-variant' : 'link-variant-off'}
      alt={picked ? 'Unlink — keep this side only' : 'Search again'}
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
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
      <Text style={mr.sectionMono}>{c.platform ? `FOUND AGAIN ON ${c.platform.toUpperCase()}` : 'CANDIDATES'}</Text>
      {initial.map((x) => (
        <ResultRow key={x.id} on={picked === x.id} title={x.title} sub={x.sub} hint={x.hint} uri={x.uri} onPress={() => setPicked((p) => (p === x.id ? null : x.id))} />
      ))}
    </ResolveShell>
  );
}

// ═══ ORPHAN — in catalog, absent from this import ═════════════════════════
function MR_Orphan({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const [strat, setStrat] = useState(0);
  const opts = [
    { title: 'Keep it listed', sub: 'exclusive / sold elsewhere' },
    { title: 'Mark sold · delist', sub: 'take down on every platform' },
    { title: 'Ignore this gap', sub: 'ask again next sync' },
  ];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="missing"
      title={c.title || 'Not in import'}
      note={c.note || (c.platform ? `In catalog · ${c.platform} didn’t return it` : 'In catalog · not in this import')}
      topInset={topInset}
      onBack={onBack}
      primary={strat === 0 ? 'Keep listed' : strat === 1 ? 'Mark sold · delist' : 'Ignore for now'}
      primaryIcon={strat === 0 ? 'check' : strat === 1 ? 'cancel' : 'bell-sleep'}
      alt="Decide later"
      onPrimary={() => onResolve('primary')}
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
      <Banner text="Sold, delisted, or just removed?" tone="warn" />
      {opts.map((o, i) => (
        <OptionRow key={i} on={strat === i} title={o.title} sub={o.sub} onPress={() => setStrat(i)} />
      ))}
      <Text style={mr.legend}>Anorha never deletes on its own — you choose.</Text>
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
      primary={parts.length ? `Link kit to ${parts.length} pieces` : 'Link kit to pieces'}
      primaryIcon="merge"
      alt="Keep set & pieces apart"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      <View style={[mr.bundleHead, { borderColor: RC.green, backgroundColor: RC.greenSoft }]}>
        <MaterialCommunityIcons name="package-variant-closed" size={18} color={RC.greenDark} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={mr.bundleTitle} numberOfLines={1}>{c.itemTitle}</Text>
          <Text style={[mr.meta, { color: RC.greenDark }]} numberOfLines={1}>{c.itemSub}</Text>
        </View>
        {!!c.platform && <PlatTag name={c.platform} />}
      </View>
      <View style={mr.divLabel}>
        <View style={mr.divLine} />
        <Text style={mr.divLabelText}>SAME STOCK AS</Text>
        <View style={mr.divLine} />
      </View>
      {parts.map((p) => (
        <Row key={p.id}>
          <Thumb size={22} radius={5} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={mr.title} numberOfLines={1}>{p.title}</Text>
            <Text style={mr.meta} numberOfLines={1}>{p.sub}</Text>
          </View>
          {!!p.plat && <PlatTag name={p.plat} />}
        </Row>
      ))}
      <Text style={mr.legend}>Selling the kit draws down the pieces’ stock.</Text>
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
function trim(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function omit<T extends object>(obj: T, key: string): T {
  const next = { ...obj } as any;
  delete next[key];
  return next;
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
  kit: MR_Kit,
};

export function MatchResolver(props: RProps) {
  const Comp = REGISTRY[props.c.kind] || MR_Find;
  return <Comp {...props} />;
}

const mr = StyleSheet.create({
  title: { fontSize: 13.5, fontWeight: '700', color: RC.ink },
  meta: { fontSize: 11, fontWeight: '500', color: RC.muted, marginTop: 1 },
  mono: { fontSize: 12, fontWeight: '600', color: RC.ink },
  price: { fontSize: 12, fontWeight: '700', color: RC.greenDark },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },

  // compare
  cmpSlot: { width: '100%', height: 56, borderRadius: 9, borderWidth: 1, borderColor: RC.line, backgroundColor: RC.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cmpSlotLabel: { fontSize: 11, fontWeight: '600', color: RC.muted },
  cmpRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: RC.line },
  cmpField: { width: 44, fontSize: 9, fontWeight: '700', letterSpacing: 0.3, color: RC.faint },
  cell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6 },
  cellText: { fontSize: 12, flexShrink: 1 },

  // consolidate
  masterTag: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1.4, borderColor: RC.green, backgroundColor: RC.greenSoft, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  masterText: { fontSize: 8, fontWeight: '700', color: RC.greenDark },

  // find
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1.5, borderColor: RC.ink, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 11 },
  searchText: { fontSize: 13, fontWeight: '500', color: RC.ink },

  // split / kit
  bundleHead: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10 },
  bundleTitle: { fontSize: 15, fontWeight: '700', color: RC.ink },
  addPiece: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1.5, borderStyle: 'dashed', borderColor: RC.line, borderRadius: 10, paddingVertical: 10 },
  addPieceText: { fontSize: 12.5, fontWeight: '700', color: RC.muted },
  divLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  divLine: { flex: 1, height: 1, backgroundColor: RC.line },
  divLabelText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5, color: RC.faint },

  // variants
  parentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  parentTitle: { fontSize: 15, fontWeight: '700', color: RC.ink },
  parentBadge: { backgroundColor: RC.greenSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  parentBadgeText: { fontSize: 9, fontWeight: '700', color: RC.greenDark },
  parentEmpty: { marginLeft: 'auto', fontSize: 9, fontWeight: '700', color: RC.danger },
  decision: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1.4 },
  decisionDone: { borderColor: RC.green, backgroundColor: RC.greenSoft },
  decisionOpen: { borderColor: RC.line, borderStyle: 'dashed', backgroundColor: '#fff' },
  decisionText: { fontSize: 10, fontWeight: '700' },

  // onesided / align
  sideMini: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: RC.line, borderRadius: 10, backgroundColor: RC.surface, paddingHorizontal: 9, paddingVertical: 8 },
  sideMiniTxt: { marginLeft: 'auto', fontSize: 11, fontWeight: '700' },
  vbox: { width: 44, alignItems: 'center', borderWidth: 1.2, borderRadius: 6, paddingVertical: 5 },
  vboxText: { fontSize: 11, fontWeight: '700' },
  verb: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1.4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  verbText: { fontSize: 10, fontWeight: '700' },
  legend: { fontSize: 11, fontWeight: '500', color: RC.faint, marginTop: 2 },

  // stale
  linkSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: RC.line, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 8 },
  linkX: { width: 20, alignItems: 'center', justifyContent: 'center' },
  sectionMono: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: RC.faint, marginTop: 2 },
});
