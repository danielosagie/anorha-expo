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

export interface ClassifyResult {
  cases: MatchCase[];
  /** platformProduct ids whose match is identical on every field — nothing to
   *  ask a human, so they auto-link instead of becoming a card. */
  autoResolved: string[];
}

export function classifyMatch(suggestions: DraftItem[], platformName?: string): ClassifyResult {
  // alreadyMapped = same link as last import (idempotent re-import) and a
  // persisted IGNORE (hash-checked server-side) both stay out of the deck.
  const open = suggestions.filter(
    (s) => s.action !== 'IGNORE' && !s.resolved && !s.alreadyMapped && s.priorResolution !== 'IGNORE',
  );
  const used = new Set<string>();
  const cases: MatchCase[] = [];
  const autoResolved: string[] = [];

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

  // 3 · PER-ITEM — route what's left, one card each (orphans and high-
  // confidence fuzzy matches batch up below instead of becoming solo cards).
  const orphanItems: DraftItem[] = [];
  const fuzzyItems: DraftItem[] = [];
  for (const s of open) {
    if (used.has(s.platformProduct.id)) continue;
    used.add(s.platformProduct.id);
    const p = s.platformProduct;
    const canon = s.suggestedCanonicalProduct;
    const conf = typeof s.confidence === 'number' ? `${Math.round(s.confidence * 100)}%` : 'match';

    // Explicit backend signal: same key matched multiple canonical products.
    if (s.candidateVariants && s.candidateVariants.length) {
      cases.push(collisionCase(s, platformName));
      continue;
    }

    // Explicit backend signal: matched, but specific fields disagree.
    // High-confidence + only soft conflicts (a price drift) still belongs in
    // the batch screen — its row shows the mismatch in orange. Critical
    // conflicts or shaky confidence get the full compare card.
    if (s.fieldConflicts && s.fieldConflicts.length && canon?.id) {
      const critical = s.fieldConflicts.some((fc) => fc.severity === 'critical');
      if (!critical && typeof s.confidence === 'number' && s.confidence >= 0.9) {
        fuzzyItems.push(s);
        continue;
      }
      cases.push(compareCase(s, 'compare', platformName));
      continue;
    }

    // Stale link whose partner moved / vanished — checked BEFORE orphan because
    // vanished-link suggestions arrive as anorha_to_platform with isStaleLink set.
    if (s.reviewReason === 'stale_match' || s.isStaleLink === true) {
      const v = s.anorhaVariant;
      cases.push({
        id: `stale-${p.id}`,
        kind: 'stale',
        title: 'Match broke',
        note:
          s.staleReason === 'missing_from_import'
            ? 'The linked listing vanished from this sync'
            : 'The linked listing changed under it',
        itemIds: [p.id],
        itemTitle: v?.title || p.title || 'Item',
        itemSub: v?.sku || p.sku || 'in catalog',
        itemImage: v?.imageUrl || p.imageUrl,
        platform: undefined,
        // Pre-pick the backend's relink candidate — one tap fixes the link.
        candidates: canon?.id ? [{ ...candidate(canon, conf), on: true }] : [],
      });
      continue;
    }

    // In catalog, not returned by this import → collect; emitted below as ONE
    // batched "keep these listed?" card (per-item cards only when there's one).
    if (s.direction === 'anorha_to_platform') {
      orphanItems.push(s);
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
      cases.push(compareCase(s, 'collision', platformName));
      continue;
    }

    // HIGH-CONFIDENCE fuzzy match (≥90%, 1:1, no critical conflicts) →
    // collect for the single "Confirm these matches?" batch screen instead
    // of dealing a solo card. Anything unchecked there re-enters the deck.
    if (
      canon?.id &&
      typeof s.confidence === 'number' &&
      s.confidence >= 0.9 &&
      !(s.fieldConflicts || []).some((fc) => fc.severity === 'critical')
    ) {
      fuzzyItems.push(s);
      continue;
    }

    // Matched on a key → compare & merge, but ONLY when the data actually
    // differs. A card whose every field already agrees is a question with no
    // answer to give — those auto-link instead of wasting a human's tap.
    if (s.reviewReason === 'duplicate' || (canon?.id && (s.matchType === 'SKU' || s.matchType === 'BARCODE'))) {
      const cc = compareCase(s, 'compare', platformName);
      if ((cc.rows || []).length > 0 && (cc.rows || []).every((r) => r.same)) {
        autoResolved.push(p.id);
      } else {
        cases.push(cc);
      }
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

  // 4 · CONFIRM FUZZY — one screen for every ≥90% match. A single one rides
  // the normal compare path (which also auto-links identical data).
  if (fuzzyItems.length === 1) {
    const cc = compareCase(fuzzyItems[0], 'compare', platformName);
    if ((cc.rows || []).length > 0 && (cc.rows || []).every((r) => r.same)) {
      autoResolved.push(fuzzyItems[0].platformProduct.id);
    } else {
      cases.push(cc);
    }
  } else if (fuzzyItems.length > 1) {
    cases.push({
      id: 'fuzzy-batch',
      kind: 'fuzzy',
      title: 'Same item?',
      note: 'Yes links them · No takes a closer look later',
      aLabel: 'My catalog',
      bLabel: platformName ? `From ${platformName}` : 'Incoming',
      itemIds: fuzzyItems.map((s) => s.platformProduct.id),
      candidates: fuzzyItems
        .slice()
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .map((s) => {
          const p = s.platformProduct;
          const canon = s.suggestedCanonicalProduct!;
          // Differing fields ride along so the tinder card can show the same
          // tappable cells as the compare card (catalog = a, incoming = b).
          const rows: CompareRow[] = [];
          if (norm(p.title) !== norm(canon.title)) {
            rows.push({ f: 'title', a: canon.title || '—', b: p.title || '—', pick: pickSide(canon.title || '—', p.title || '—') });
          }
          if ((canon.sku || p.sku) && norm(p.sku) !== norm(canon.sku)) {
            rows.push({ f: 'sku', a: canon.sku || '—', b: p.sku || '—', pick: pickSide(canon.sku || '—', p.sku || '—') });
          }
          const cPrice = money(canon.price);
          const pPrice = money(p.price);
          if (cPrice !== pPrice) {
            rows.push({ f: 'price', a: cPrice, b: pPrice, pick: pickSide(cPrice, pPrice) });
          }
          return {
            id: p.id,
            title: p.title || canon.title || 'Item',
            // SKU only when both sides agree — a differing SKU shows up as a
            // field row instead, so it's never printed twice.
            sub: norm(p.sku) === norm(canon.sku) ? p.sku || undefined : undefined,
            uri: p.imageUrl,
            uri2: canon.imageUrl,
            rows: rows.length ? rows : undefined,
          };
        }),
    });
  }

  // 5 · ORPHANS — one batched card for everything the import didn't return.
  // 287 per-item "keep or remove?" cards is busywork; one checkbox list where
  // everything defaults to "keep listed" is one tap. A single orphan keeps the
  // focused per-item card.
  if (orphanItems.length === 1) {
    const s = orphanItems[0];
    const p = s.platformProduct;
    const v = s.anorhaVariant;
    cases.push({
      id: `orph-${p.id}`,
      kind: 'orphan',
      title: 'Still selling this?',
      note: `In your catalog · ${platformName || 'this import'} didn’t send it back`,
      itemIds: [p.id],
      itemTitle: v?.title || p.title || 'Item',
      itemSub: `${v?.sku || p.sku || 'no sku'}`,
      itemImage: v?.imageUrl || p.imageUrl,
      platform: platformName || 'this sync',
    });
  } else if (orphanItems.length > 1) {
    cases.push({
      id: 'orphans-batch',
      kind: 'orphans',
      title: 'Keep selling these?',
      note: 'Tap what’s gone — the rest stay listed',
      itemIds: orphanItems.map((s) => s.platformProduct.id),
      candidates: orphanItems.map((s) => {
        const p = s.platformProduct;
        const v = s.anorhaVariant;
        const price = money(v?.price ?? p.price);
        return {
          id: p.id,
          title: v?.title || p.title || 'Item',
          sub: [v?.sku || p.sku || 'no sku', price !== '—' ? price : null].filter(Boolean).join(' · '),
          uri: v?.imageUrl || p.imageUrl,
        };
      }),
    });
  }

  return { cases, autoResolved };
}

// ── case builders ──────────────────────────────────────────────────────────
// Default pick prefers the side that actually HAS data — never default to an
// empty value over a real one (e.g. "—" beating "$50.00").
function pickSide(a: string, b: string): 'a' | 'b' {
  const aEmpty = !a || a === '—';
  const bEmpty = !b || b === '—';
  return aEmpty && !bEmpty ? 'b' : 'a';
}

function compareCase(s: DraftItem, kind: 'compare' | 'collision', platformName?: string): MatchCase {
  const p = s.platformProduct;
  const canon = s.suggestedCanonicalProduct!;
  let rows: CompareRow[];
  if (kind === 'compare' && s.fieldConflicts && s.fieldConflicts.length) {
    // Use the backend's exact field conflicts (title/price/stock/photos…).
    // A "conflict" whose two displays read the same (null vs undefined, equal
    // strings) is not a question — mark it same so the card hides it.
    rows = s.fieldConflicts.map((fc) => {
      const a = fc.canonicalValue == null ? '—' : String(fc.canonicalValue);
      const b = fc.platformValue == null ? '—' : String(fc.platformValue);
      const same = a === b;
      return {
        f: fc.field,
        a,
        b,
        same,
        clash: !same && fc.severity === 'critical',
        pick: same || fc.severity === 'critical' ? undefined : pickSide(a, b),
      };
    });
  } else {
    rows = [];
    const titleSame = norm(p.title) === norm(canon.title);
    rows.push({ f: 'title', a: canon.title || '—', b: p.title || '—', same: titleSame, pick: titleSame ? undefined : pickSide(canon.title || '—', p.title || '—') });
    const skuSame = norm(p.sku) === norm(canon.sku);
    if (canon.sku || p.sku) rows.push({ f: 'sku', a: canon.sku || '—', b: p.sku || '—', same: skuSame, clash: kind === 'collision' && skuSame, pick: kind === 'collision' ? undefined : pickSide(canon.sku || '—', p.sku || '—') });
    // Compare what the user would SEE — "$5.00" vs "$5.00", "—" vs "—".
    // (Raw null vs undefined used to flag equal-empty prices as different.)
    const priceSame = money(canon.price) === money(p.price);
    rows.push({ f: 'price', a: money(canon.price), b: money(p.price), same: priceSame, pick: priceSame ? undefined : pickSide(money(canon.price), money(p.price)) });
  }

  return {
    id: `${kind}-${p.id}`,
    kind,
    title: kind === 'collision' ? 'Same item?' : 'Same item, different info',
    note: kind === 'collision' ? 'Same SKU, different look' : 'Tap the one to keep',
    itemIds: [p.id],
    aLabel: 'My catalog',
    bLabel: platformName ? `From ${platformName}` : 'Incoming',
    aChip: kind === 'collision' ? undefined : 'live',
    bChip: kind === 'collision' ? undefined : 'new',
    aTone: kind === 'collision' ? 'danger' : 'ok',
    bTone: kind === 'collision' ? 'danger' : 'warn',
    aImage: canon.imageUrl,
    bImage: p.imageUrl,
    rows,
    conf: typeof s.confidence === 'number' ? s.confidence : undefined,
    why: matchWhy(s),
  };
}

// One plain-English line of evidence for "why matched?" — shown on demand.
function matchWhy(s: DraftItem): string | undefined {
  const canon = s.suggestedCanonicalProduct;
  switch (s.matchType) {
    case 'BARCODE':
      return 'same barcode';
    case 'SKU':
      return canon?.sku ? `same SKU · ${canon.sku}` : 'same SKU';
    case 'TITLE':
      return 'titles look alike';
    case 'AI_SEMANTIC':
      return 'AI thinks they’re the same product';
    default:
      return canon?.id ? 'similar listing' : undefined;
  }
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
    sku: canon.sku || null,
    price: typeof canon.price === 'number' ? canon.price : null,
  };
}

function variantsCase(pid: string, group: DraftItem[]): MatchCase {
  const parentTitle = group[0].platformProduct.parentTitle || group[0].platformProduct.title || 'Product';
  return {
    id: `var-${pid}`,
    kind: 'variants',
    title: 'Group these together?',
    note: 'Tap any that don’t belong',
    parentTitle,
    itemIds: group.map((g) => g.platformProduct.id),
    candidates: group.map((g) => {
      const p = g.platformProduct;
      // One human line per row: the variant's own title when it has one,
      // otherwise its SKU — and the sub never repeats what the title shows.
      const title = (p.title && p.title !== parentTitle ? p.title : '') || p.sku || 'Variant';
      const price = money(p.price);
      const sub =
        title === p.sku
          ? price !== '—' ? price : undefined
          : [p.sku, price !== '—' ? price : null].filter(Boolean).join(' · ') || undefined;
      return {
        id: p.id,
        title,
        sub,
        uri: p.imageUrl,
        hint: g.suggestedCanonicalProduct?.id ? `→ ${trim(g.suggestedCanonicalProduct.title, 12)}` : undefined,
      };
    }),
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

function collisionCase(s: DraftItem, platformName?: string): MatchCase {
  const p = s.platformProduct;
  const cands = s.candidateVariants || [];
  const top = cands[0];
  return {
    id: `coll-${p.id}`,
    kind: 'collision',
    title: 'Same item?',
    note: `“${p.sku || p.title}” matches ${cands.length} product${cands.length === 1 ? '' : 's'}`,
    itemIds: [p.id],
    aLabel: 'My catalog',
    bLabel: platformName ? `From ${platformName}` : 'Incoming',
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
    // Seed the piece list from the backend's parsed multi-SKU cell; the
    // resolver lets the user edit/add/remove pieces either way.
    parts: (s.bundleParts || []).map((part, i) => ({
      name: part.title || part.sku || `Part ${i + 1}`,
      sku: part.sku || '—',
      qty: String(part.quantity ?? 1),
      price: '—',
    })),
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
    // The component singles come from the backend (canonicals sharing the base SKU).
    candidates: (s.kitComponents || []).map((c) => ({
      id: c.id,
      title: c.title || c.sku || 'Piece',
      sub: `${c.sku || 'no sku'} · ${money(typeof c.price === 'number' ? c.price : null)}`,
      uri: c.imageUrl,
    })),
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

  // Every kind must commit a concrete action in BOTH branches — a card that
  // resolves without setting one leaves the item ambiguous at commit time.
  if (decision === 'alt') {
    switch (kind) {
      case 'orphan':
      case 'orphans':
        return set('LINK_EXISTING'); // "decide later" → keep it listed, revisit next sync
      case 'collision':
        return set('LINK_EXISTING'); // "actually the same → merge"
      case 'stale':
        return set('IGNORE'); // unlink the broken link (also via meta.unlink upstream)
      case 'compare':
      case 'consolidate':
      case 'find':
      case 'variants':
      case 'split':
      case 'kit':
      case 'onesided':
      case 'align':
      case 'fuzzy':
      default:
        return set('CREATE_NEW'); // keep apart / keep as one / keep separate / add as new
    }
  }

  // primary
  switch (kind) {
    case 'collision':
      return set('CREATE_NEW'); // keep as 2 distinct items
    case 'find':
      return set(s.suggestedCanonicalProduct?.id ? 'LINK_EXISTING' : 'CREATE_NEW');
    case 'split':
      return set('CREATE_NEW'); // create the pieces as new products
    case 'orphan':
    case 'orphans':
      return set('LINK_EXISTING'); // keep listed
    case 'compare':
    case 'consolidate':
    case 'variants':
    case 'onesided':
    case 'align':
    case 'stale':
    case 'kit':
    case 'fuzzy':
    default:
      return set('LINK_EXISTING'); // link / merge / sync
  }
}
