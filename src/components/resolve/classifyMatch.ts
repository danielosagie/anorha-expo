// classifyMatch — turn a backend mapping draft into the right resolver case.
//
// This is the heart of "render what the backend said into the right pieces":
// each unresolved MappingSuggestion (optionally annotated with a reviewReason)
// is routed to one of the 11 Match·Resolve v2 cases. Grouping passes run first
// (many→1 consolidate, variant families), then the remaining items are routed
// one-by-one.

import { MappingSuggestion } from '../../types/importSession';
import { MatchCase, CompareRow, CandidateItem } from './matchResolvers';

type ReviewReason = 'no_match_found' | 'low_confidence' | 'duplicate' | 'variant_mismatch' | 'stale_match';
export type DraftItem = MappingSuggestion & { reviewReason?: ReviewReason };

const money = (n?: number | null) => (typeof n === 'number' && n > 0 ? `$${n.toFixed(2)}` : '—');
const norm = (s?: string | null) => (s || '').trim().toLowerCase();
const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function push<K, V>(map: Map<K, V[]>, key: K, val: V) {
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}

export function classifyMatch(suggestions: DraftItem[]): MatchCase[] {
  const open = suggestions.filter((s) => s.action !== 'IGNORE' && !s.resolved);
  const used = new Set<string>();
  const cases: MatchCase[] = [];

  // 1 · CONSOLIDATE — many incoming rows pointing at the same canonical.
  const byCanon = new Map<string, DraftItem[]>();
  for (const s of open) {
    const cid = s.suggestedCanonicalProduct?.id;
    if (cid && s.direction !== 'anorha_to_platform') push(byCanon, cid, s);
  }
  for (const [cid, group] of byCanon) {
    if (group.length < 2) continue;
    group.forEach((g) => used.add(g.platformProduct.id));
    const canon = group[0].suggestedCanonicalProduct!;
    cases.push({
      id: `cons-${cid}`,
      kind: 'consolidate',
      title: 'Combine',
      note: `${group.length} rows look like ${trim(canon.title || 'one product', 20)}`,
      itemIds: group.map((g) => g.platformProduct.id),
      candidates: group.map((g, i) => ({
        id: g.platformProduct.id,
        title: g.platformProduct.title || g.platformProduct.sku,
        sub: g.platformProduct.sku,
        plat: g.matchType && g.matchType !== 'NONE' ? g.matchType : 'row',
        on: true,
        master: i === 0,
      })),
    });
  }

  // 2 · VARIANT FAMILIES — grouped by parent, routed by the backend's signal:
  //   conflicting_variant_family → Align (verb per pair) · else → Stray variants.
  const byParent = new Map<string, DraftItem[]>();
  for (const s of open) {
    if (used.has(s.platformProduct.id)) continue;
    const variantish =
      s.reviewReason === 'variant_mismatch' ||
      s.requiresFamilyDecision === true ||
      s.productShape === 'variant_family' ||
      s.productShape === 'unmatched_variant' ||
      (!!s.platformProduct.parentId && !s.suggestedCanonicalProduct?.id);
    if (variantish && s.platformProduct.parentId) push(byParent, s.platformProduct.parentId, s);
  }
  for (const [pid, group] of byParent) {
    if (group.length < 2) continue;
    group.forEach((g) => used.add(g.platformProduct.id));
    const reasons = new Set(group.map((g) => g.familyDecisionReason).filter(Boolean));
    if (reasons.has('conflicting_variant_family')) {
      cases.push(alignCase(pid, group)); // both sides have sets, values differ
    } else if (reasons.has('incomplete_variant_family')) {
      cases.push(onesidedCase(pid, group)); // one side has variants, the other is flat
    } else {
      cases.push(variantsCase(pid, group)); // stray / new family — place each leftover
    }
  }

  // 3 · PER-ITEM — route what's left, one card each.
  for (const s of open) {
    if (used.has(s.platformProduct.id)) continue;
    used.add(s.platformProduct.id);
    const p = s.platformProduct;
    const canon = s.suggestedCanonicalProduct;
    const conf = typeof s.confidence === 'number' ? `${Math.round(s.confidence * 100)}%` : 'match';

    // Explicit backend signal: same key matched multiple canonical products.
    if (s.candidateVariants && s.candidateVariants.length) {
      cases.push(collisionCase(s));
      continue;
    }

    // Explicit backend signal: matched, but specific fields disagree.
    if (s.fieldConflicts && s.fieldConflicts.length && canon?.id) {
      cases.push(compareCase(s, 'compare'));
      continue;
    }

    // In catalog, not returned by this import → keep / delist / ignore.
    if (s.direction === 'anorha_to_platform') {
      const v = s.anorhaVariant;
      cases.push({
        id: `orph-${p.id}`,
        kind: 'orphan',
        title: 'Not in import',
        itemIds: [p.id],
        itemTitle: v?.title || p.title || 'Item',
        itemSub: `${v?.sku || p.sku || 'no sku'}`,
        itemImage: v?.imageUrl || p.imageUrl,
        platform: 'this sync',
      });
      continue;
    }

    // Stale link whose partner moved / vanished.
    if (s.reviewReason === 'stale_match') {
      cases.push({
        id: `stale-${p.id}`,
        kind: 'stale',
        title: 'Match broke',
        note: 'The linked listing changed under it',
        itemIds: [p.id],
        itemTitle: p.title || 'Item',
        itemSub: p.sku || 'in catalog',
        itemImage: p.imageUrl,
        platform: undefined,
        candidates: canon?.id ? [candidate(canon, conf)] : [],
      });
      continue;
    }

    // Bundle (1 row = several SKUs) or kit↔singles — composition mismatch.
    const comp = compositionKind(s);
    if (comp === 'bundle') {
      cases.push(splitCase(s));
      continue;
    }
    if (comp === 'kit') {
      cases.push(kitCase(s));
      continue;
    }

    // SKU collision — same key string, clearly different goods.
    if (
      s.reviewReason !== 'duplicate' &&
      canon?.id &&
      (s.matchType === 'SKU' || s.matchType === 'BARCODE') &&
      norm(canon.title) !== norm(p.title) &&
      titleDistance(canon.title, p.title) > 0.6
    ) {
      cases.push(compareCase(s, 'collision'));
      continue;
    }

    // Matched on a key but the data differs → compare & merge.
    if (s.reviewReason === 'duplicate' || (canon?.id && (s.matchType === 'SKU' || s.matchType === 'BARCODE'))) {
      cases.push(compareCase(s, 'compare'));
      continue;
    }

    // Has a fuzzy candidate → find/confirm with it pre-listed.
    if (canon?.id) {
      cases.push(findCase(p, [candidate(canon, conf)]));
      continue;
    }

    // No candidate at all → search & link / add new.
    cases.push(findCase(p, []));
  }

  return cases;
}

// ── case builders ──────────────────────────────────────────────────────────
function compareCase(s: DraftItem, kind: 'compare' | 'collision'): MatchCase {
  const p = s.platformProduct;
  const canon = s.suggestedCanonicalProduct!;
  let rows: CompareRow[];
  if (kind === 'compare' && s.fieldConflicts && s.fieldConflicts.length) {
    // Use the backend's exact field conflicts (title/price/stock/photos…).
    rows = s.fieldConflicts.map((fc) => ({
      f: fc.field,
      a: fc.canonicalValue == null ? '—' : String(fc.canonicalValue),
      b: fc.platformValue == null ? '—' : String(fc.platformValue),
      clash: fc.severity === 'critical',
      pick: fc.severity === 'critical' ? undefined : 'a',
    }));
  } else {
    rows = [];
    const titleSame = norm(p.title) === norm(canon.title);
    rows.push({ f: 'title', a: canon.title || '—', b: p.title || '—', same: titleSame, pick: titleSame ? undefined : 'a' });
    const skuSame = norm(p.sku) === norm(canon.sku);
    if (canon.sku || p.sku) rows.push({ f: 'sku', a: canon.sku || '—', b: p.sku || '—', same: skuSame, clash: kind === 'collision' && skuSame, pick: kind === 'collision' ? undefined : 'a' });
    rows.push({ f: 'price', a: money(canon.price), b: money(p.price), same: canon.price === p.price, pick: 'a' });
  }

  return {
    id: `${kind}-${p.id}`,
    kind,
    title: kind === 'collision' ? 'Same item?' : 'Compare',
    note: kind === 'collision' ? 'Same key, different goods' : 'Tap a side to keep that field',
    itemIds: [p.id],
    aLabel: kind === 'collision' ? trim(canon.title || 'A', 10) : 'In catalog',
    bLabel: kind === 'collision' ? trim(p.title || 'B', 10) : 'Incoming',
    aChip: kind === 'collision' ? 'existing' : 'live',
    bChip: kind === 'collision' ? 'incoming' : 'new',
    aTone: kind === 'collision' ? 'danger' : 'ok',
    bTone: kind === 'collision' ? 'danger' : 'warn',
    aImage: canon.imageUrl,
    bImage: p.imageUrl,
    rows,
  };
}

function findCase(p: MappingSuggestion['platformProduct'], candidates: CandidateItem[]): MatchCase {
  return {
    id: `find-${p.id}`,
    kind: 'find',
    title: 'Find its match',
    note: p.sku ? `SKU ${p.sku} didn’t match` : 'No SKU to match on',
    itemIds: [p.id],
    itemTitle: p.title || 'Item',
    itemSub: `${p.sku || 'no SKU'} · ${money(p.price)}`,
    itemImage: p.imageUrl,
    candidates: candidates.map((c, i) => ({ ...c, on: candidates.length === 1 && i === 0 })),
  };
}

function candidate(canon: NonNullable<MappingSuggestion['suggestedCanonicalProduct']>, hint: string): CandidateItem {
  return {
    id: canon.id || `cand-${norm(canon.title)}`,
    title: canon.title || 'Catalog item',
    sub: `${canon.sku || 'no sku'} · ${money(canon.price)}`,
    hint,
    uri: canon.imageUrl,
  };
}

function variantsCase(pid: string, group: DraftItem[]): MatchCase {
  return {
    id: `var-${pid}`,
    kind: 'variants',
    title: 'Stray variants',
    parentTitle: group[0].platformProduct.parentTitle || group[0].platformProduct.title || 'Product',
    itemIds: group.map((g) => g.platformProduct.id),
    candidates: group.map((g) => ({
      id: g.platformProduct.id,
      title: g.platformProduct.sku || g.platformProduct.title,
      sub: variantHint(g),
      hint: g.suggestedCanonicalProduct?.id ? `→ ${trim(g.suggestedCanonicalProduct.title, 12)}` : undefined,
    })),
  };
}

function alignCase(pid: string, group: DraftItem[]): MatchCase {
  return {
    id: `align-${pid}`,
    kind: 'align',
    title: 'Align variants',
    note: 'Both sides have sets — set one verb each',
    parentTitle: group[0].platformProduct.parentTitle || group[0].platformProduct.title || 'Product',
    itemIds: group.map((g) => g.platformProduct.id),
    aLabel: 'Incoming',
    bLabel: 'In catalog',
    aChip: `${group.length} variants`,
    bChip: 'set',
    candidates: group.map((g) => ({
      id: g.platformProduct.id,
      title: `${variantKey(g.platformProduct)} · ${g.suggestedCanonicalProduct?.sku || '—'}`,
      hint: g.suggestedCanonicalProduct?.id ? 'merge' : 'addA',
    })),
  };
}

function collisionCase(s: DraftItem): MatchCase {
  const p = s.platformProduct;
  const cands = s.candidateVariants || [];
  const top = cands[0];
  return {
    id: `coll-${p.id}`,
    kind: 'collision',
    title: 'Same item?',
    note: `“${p.sku || p.title}” matches ${cands.length} product${cands.length === 1 ? '' : 's'}`,
    itemIds: [p.id],
    aLabel: trim(top?.title || 'Existing', 10),
    bLabel: trim(p.title || 'Incoming', 10),
    aChip: 'existing',
    bChip: 'incoming',
    aTone: 'danger',
    bTone: 'danger',
    aImage: top?.imageUrl,
    bImage: p.imageUrl,
    rows: [
      { f: 'sku', a: top?.sku || p.sku || '—', b: p.sku || '—', clash: true },
      { f: 'title', a: top?.title || '—', b: p.title || '—', same: false },
      { f: 'price', a: money(top?.price), b: money(p.price), same: false },
    ],
  };
}

function onesidedCase(pid: string, group: DraftItem[]): MatchCase {
  const g0 = group[0];
  return {
    id: `one-${pid}`,
    kind: 'onesided',
    title: 'One side flat',
    note: 'One platform has variants · the other is a single listing',
    parentTitle: g0.platformProduct.parentTitle || g0.platformProduct.title || 'Product',
    itemIds: group.map((g) => g.platformProduct.id),
    aLabel: 'Incoming',
    bLabel: 'In catalog',
    aChip: `${group.length} variants`,
    bChip: 'flat · 1',
    aTone: 'ok',
    bTone: 'warn',
  };
}

function splitCase(s: DraftItem): MatchCase {
  const p = s.platformProduct;
  return {
    id: `split-${p.id}`,
    kind: 'split',
    title: 'Split bundle',
    note: 'One row holds several SKUs',
    itemIds: [p.id],
    itemTitle: p.title || 'Bundle',
    itemSub: `${p.sku || 'no sku'} · ${money(p.price)}`,
    parts: [], // components arrive once the backend parses the bundle
  };
}

function kitCase(s: DraftItem): MatchCase {
  const p = s.platformProduct;
  return {
    id: `kit-${p.id}`,
    kind: 'kit',
    title: 'Kit ↔ singles',
    note: 'Sold as a set here · as pieces elsewhere',
    itemIds: [p.id],
    itemTitle: p.title || 'Kit',
    itemSub: `${p.sku || 'no sku'} · ${money(p.price)}`,
    candidates: [], // the component singles arrive from the backend
  };
}

function compositionKind(s: DraftItem): 'bundle' | 'kit' | null {
  // Routed on the explicit backend signal only — title heuristics produce too
  // many false positives ("Gift Set" is not a bundle). Detection is backend work.
  return s.compositionType === 'bundle' ? 'bundle' : s.compositionType === 'kit' ? 'kit' : null;
}

function variantKey(p: MappingSuggestion['platformProduct']): string {
  const sku = p.sku || '';
  const tail = sku.split(/[-_]/).pop();
  return (tail && tail.length <= 6 ? tail : sku) || p.title || '—';
}

function variantHint(s: DraftItem): string {
  const parts: string[] = [];
  if (s.platformProduct.sku) parts.push(s.platformProduct.sku);
  if (typeof s.platformProduct.price === 'number' && s.platformProduct.price > 0) parts.push(money(s.platformProduct.price));
  return parts.join(' · ') || 'loose variant';
}

// crude title divergence 0..1 (1 = totally different) for collision detection
function titleDistance(a?: string | null, b?: string | null): number {
  const wa = new Set(norm(a).split(/\s+/).filter(Boolean));
  const wb = new Set(norm(b).split(/\s+/).filter(Boolean));
  if (!wa.size || !wb.size) return 1;
  let shared = 0;
  wa.forEach((w) => { if (wb.has(w)) shared++; });
  const overlap = shared / Math.max(wa.size, wb.size);
  return 1 - overlap;
}

// ── decision write-back — mark the draft so the lobby reflects progress ─────
export function applyMatchDecision(
  s: MappingSuggestion,
  kind: MatchCase['kind'],
  decision: 'primary' | 'alt',
): MappingSuggestion {
  const set = (action: MappingSuggestion['action']): MappingSuggestion => ({
    ...s,
    action,
    resolved: true,
    isSelected: action !== 'IGNORE',
  });

  if (decision === 'alt') {
    if (kind === 'orphan') return set('IGNORE'); // delist / ignore
    if (kind === 'collision') return set('LINK_EXISTING'); // "they're the same → merge"
    if (kind === 'compare' || kind === 'consolidate') return set('CREATE_NEW'); // keep both / apart
    if (kind === 'find') return set('CREATE_NEW'); // add as new
    return { ...s, resolved: true };
  }

  // primary
  switch (kind) {
    case 'collision':
      return set('CREATE_NEW'); // keep as 2 items
    case 'find':
      return set(s.suggestedCanonicalProduct?.id ? 'LINK_EXISTING' : 'CREATE_NEW');
    case 'orphan':
      return set('LINK_EXISTING'); // keep listed
    default:
      return set('LINK_EXISTING'); // compare/consolidate/variants/stale/kit/split/onesided/align
  }
}
