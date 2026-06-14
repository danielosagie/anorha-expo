// Pure decision logic for the import flow.
//
// The whole import is three questions, asked in order:
//   group → "is this one product, or several?"
//   same  → "is this the same as something you already have?"
//   keep  → "bring it in, or skip?"
//
// This module turns the server's already-computed signals (carried through on
// MappingSuggestion) into (a) the question each row raises, (b) client-side
// COMBINE clusters for rows that match nothing yet but look like one product,
// and (c) the ordered queue of decision "units" the UI walks. It holds no React
// state — every answer is expressed as a patch over the suggestion list, which
// is what makes the flow reversible (re-open a unit, flip it).
//
// See anorha-bknd/docs/import/MINIMAL_DECISIONS.md.

import { ImportDecisionQuestion, MappingSuggestion } from '../../types/importSession';

// ── 1. Which question does a row raise? (undefined = auto-resolved / done) ────

export function isResolved(s: MappingSuggestion): boolean {
  if (s.resolved === true) return true;
  if (s.alreadyMapped) return true;
  // High-confidence key match that the user never needs to see.
  if (
    s.action === 'LINK_EXISTING' &&
    (s.matchType === 'BARCODE' || s.matchType === 'SKU') &&
    (s.confidence ?? 0) >= 0.9 &&
    !s.isStaleLink &&
    !(s.fieldConflicts && s.fieldConflicts.length > 0)
  ) {
    return true;
  }
  return false;
}

export function deriveQuestion(s: MappingSuggestion): ImportDecisionQuestion | undefined {
  if (s.action === 'IGNORE') return undefined;
  if (isResolved(s)) return undefined;
  if (s.direction === 'anorha_to_platform') return undefined; // push side, handled elsewhere
  // A broken existing link (the listing vanished from the platform) is a
  // reconciliation concern, not an import decision — keep it as-is, out of the
  // queue. (A link that merely re-pointed still has a candidate → SAME below.)
  if (s.isStaleLink && !s.suggestedCanonicalProduct?.id) return undefined;

  // GROUP — structure first: it decides what the units are.
  // Only three things are genuinely structural: a proposed combine cluster,
  // many rows pointing at one canonical, or a bundle that splits into several.
  // (kit folds into KEEP; family-attach folds into SAME.)
  if (s.groupId || s.isDuplicateSuggestedCanonical || s.compositionType === 'bundle') {
    return 'group';
  }

  // SAME — identity: there's a canonical to confirm or pick.
  const hasCandidate = !!s.suggestedCanonicalProduct?.id;
  if (hasCandidate || (s.candidateVariants && s.candidateVariants.length > 0)) {
    return 'same';
  }

  // KEEP — nothing matched: bring it in or skip.
  return 'keep';
}

// ── 2. COMBINE clustering — the hero case ────────────────────────────────────
// Rows that match nothing yet but are obviously one product in several variants
// (e.g. "Handmade Soap - Lavender / - Oatmeal / - Charcoal"). Conservative on
// purpose: a false group is more annoying than a missed one.

function skuStem(sku?: string | null): string | null {
  if (!sku) return null;
  const first = sku.trim().toLowerCase().split(/[\s\-_/]+/)[0];
  return first && first.length >= 3 && /^[a-z0-9]+$/.test(first) ? first : null;
}

function titleHead(title?: string | null): string | null {
  if (!title) return null;
  // Everything before a "-", "—", "(", "/" or ":" is usually the product name.
  const head = title.split(/[\-—(/:|]/)[0].trim().toLowerCase();
  return head.length >= 3 ? head : null;
}

function firstToken(title?: string | null): string | null {
  if (!title) return null;
  const t = title.trim().toLowerCase().split(/\s+/)[0];
  return t && t.length >= 3 ? t : null;
}

/**
 * Assigns groupId/groupTitle/groupCover to KEEP-pile rows that cluster into a
 * proposed variant family. Returns a NEW array (immutable). Clusters need ≥2
 * members sharing a SKU stem AND a title head/first-token.
 */
export function buildCombineGroups(suggestions: MappingSuggestion[]): MappingSuggestion[] {
  // Only consider rows that currently match nothing and aren't already grouped
  // or otherwise structured.
  const eligible = suggestions.filter(
    (s) =>
      s.action !== 'IGNORE' &&
      !isResolved(s) &&
      s.direction !== 'anorha_to_platform' &&
      !s.suggestedCanonicalProduct?.id &&
      !s.isDuplicateSuggestedCanonical &&
      !s.compositionType &&
      !s.familyDecisionReason &&
      !s.platformProduct.parentId,
  );

  const buckets = new Map<string, MappingSuggestion[]>();
  for (const s of eligible) {
    const stem = skuStem(s.platformProduct.sku);
    const head = titleHead(s.platformProduct.title) || firstToken(s.platformProduct.title);
    if (!stem || !head) continue;
    const key = `${stem}|${head}`;
    const list = buckets.get(key) || [];
    list.push(s);
    buckets.set(key, list);
  }

  const assignment = new Map<string, { groupId: string; groupTitle: string; coverId: string }>();
  for (const [key, list] of buckets.entries()) {
    if (list.length < 2) continue;
    const groupId = `grp:${key}`;
    // Cover = the row with an image, else the first.
    const cover = list.find((s) => !!s.platformProduct.imageUrl) || list[0];
    const groupTitle = prettyGroupTitle(list);
    for (const s of list) {
      assignment.set(s.platformProduct.id, { groupId, groupTitle, coverId: cover.platformProduct.id });
    }
  }

  if (assignment.size === 0) return suggestions;
  return suggestions.map((s) => {
    const a = assignment.get(s.platformProduct.id);
    if (!a) return s;
    return { ...s, groupId: a.groupId, groupTitle: a.groupTitle, groupCover: s.platformProduct.id === a.coverId };
  });
}

function prettyGroupTitle(list: MappingSuggestion[]): string {
  const head = list[0].platformProduct.title.split(/[\-—(/:|]/)[0].trim();
  return head || list[0].platformProduct.title;
}

// ── 3. The ordered queue of decision units ───────────────────────────────────

export interface SingleUnit {
  kind: 'single';
  id: string;
  question: ImportDecisionQuestion;
  item: MappingSuggestion;
}
export interface GroupUnit {
  kind: 'group';
  id: string;
  question: 'group';
  title: string;
  members: MappingSuggestion[];
}
export type DecisionUnit = SingleUnit | GroupUnit;

const QUESTION_ORDER: Record<ImportDecisionQuestion, number> = { group: 0, same: 1, keep: 2 };

/** Key that folds multiple rows into one GROUP card; undefined → its own card. */
function groupKeyOf(s: MappingSuggestion): string | undefined {
  if (s.groupId) return s.groupId;
  if (s.isDuplicateSuggestedCanonical && s.suggestedCanonicalProduct?.id) {
    return `canon:${s.suggestedCanonicalProduct.id}`;
  }
  if (s.familyDecisionReason && s.platformProduct.parentId) {
    return `fam:${s.platformProduct.parentId}`;
  }
  return undefined; // bundle/kit/etc. are GROUP-question but single-row cards
}

/** The annotated suggestions → ordered units (group → same → keep). */
export function buildUnits(suggestions: MappingSuggestion[]): DecisionUnit[] {
  const withQ = suggestions.map((s) => ({ s, q: deriveQuestion(s) }));
  const pending = withQ.filter((x) => x.q) as { s: MappingSuggestion; q: ImportDecisionQuestion }[];

  const groups = new Map<string, MappingSuggestion[]>();
  const singles: SingleUnit[] = [];

  for (const { s, q } of pending) {
    const gk = q === 'group' ? groupKeyOf(s) : undefined;
    if (gk) {
      const list = groups.get(gk) || [];
      list.push(s);
      groups.set(gk, list);
    } else {
      // Stamp the derived question onto the item so the card copy + the answer
      // patch can branch on it.
      singles.push({ kind: 'single', id: s.platformProduct.id, question: q, item: { ...s, question: q } });
    }
  }

  const groupUnits: GroupUnit[] = [];
  for (const [gk, members] of groups.entries()) {
    if (members.length === 1) {
      // A "group" of one isn't a group — fall back to a single card.
      singles.push({ kind: 'single', id: members[0].platformProduct.id, question: 'group', item: { ...members[0], question: 'group' } });
      continue;
    }
    const cover = members.find((m) => m.groupCover) || members[0];
    const title = cover.groupTitle || cover.platformProduct.parentTitle || prettyGroupTitle(members);
    groupUnits.push({ kind: 'group', id: gk, question: 'group', title, members });
  }

  const units: DecisionUnit[] = [...groupUnits, ...singles];
  units.sort((a, b) => QUESTION_ORDER[a.question] - QUESTION_ORDER[b.question]);
  return units;
}

// ── 4. Answers → patches over the suggestion list ────────────────────────────
// Every answer returns ids + a transform; the hook applies it to state. Nothing
// is committed until "Complete Import", so any of these can be re-opened/flipped.

export type DecisionAnswer = 'primary' | 'secondary' | 'skip';

function patchIds(
  suggestions: MappingSuggestion[],
  ids: Set<string>,
  fn: (s: MappingSuggestion) => MappingSuggestion,
): MappingSuggestion[] {
  return suggestions.map((s) => (ids.has(s.platformProduct.id) ? fn(s) : s));
}

/**
 * Resolve a unit. Returns the next suggestion list. Four core operations:
 * - COMBINE (group):  primary → one variant_family (shared groupId→parentId)
 *                     secondary → keep separate (each its own simple CREATE_NEW)
 * - SPLIT (bundle):   primary → expand the row into one new product per part
 *                     secondary → keep as one product
 * - MATCH (same):     primary → LINK_EXISTING ; secondary → drop the guess (→ KEEP)
 * - NEW/KEEP:         primary → CREATE_NEW (kit lands here too) ; secondary/skip → IGNORE
 */
export function applyAnswer(
  suggestions: MappingSuggestion[],
  unit: DecisionUnit,
  answer: DecisionAnswer,
): MappingSuggestion[] {
  if (unit.kind === 'group') {
    const ids = new Set(unit.members.map((m) => m.platformProduct.id));
    if (answer === 'skip') {
      return patchIds(suggestions, ids, (s) => ({ ...s, prevAction: s.action, action: 'IGNORE', isSelected: false, resolved: false }));
    }
    if (answer === 'secondary') {
      // Keep separate: each becomes its own simple new product.
      return patchIds(suggestions, ids, (s) => ({
        ...s,
        action: 'CREATE_NEW',
        productShape: 'simple',
        groupId: undefined,
        isSelected: true,
        resolved: true,
      }));
    }
    // Combine into one variant family. groupId is the (stable) family key the
    // commit turns into a shared parentId so the backend nests the variants.
    return patchIds(suggestions, ids, (s) => ({
      ...s,
      action: 'CREATE_NEW',
      productShape: 'variant_family',
      groupId: unit.id,
      isSelected: true,
      resolved: true,
    }));
  }

  // Single unit.
  const id = new Set([unit.item.platformProduct.id]);
  const s0 = unit.item;

  if (answer === 'skip') {
    return patchIds(suggestions, id, (s) => ({ ...s, prevAction: s.action, action: 'IGNORE', isSelected: false, resolved: false }));
  }

  // SPLIT — one row that holds several SKUs. primary expands it into one new
  // product per part (the real edge-solver); secondary keeps it as one product.
  if (s0.compositionType === 'bundle' && s0.bundleParts && s0.bundleParts.length > 0) {
    if (answer === 'primary') {
      const children: MappingSuggestion[] = s0.bundleParts.map((p, i) => ({
        ...s0,
        platformProduct: {
          ...s0.platformProduct,
          id: `${s0.platformProduct.id}::part:${i}`,
          sku: p.sku || '',
          title: p.title || p.sku || `${s0.platformProduct.title} (part ${i + 1})`,
          parentId: null,
        },
        action: 'CREATE_NEW',
        productShape: 'simple',
        compositionType: undefined,
        bundleParts: undefined,
        groupId: undefined,
        isSelected: true,
        resolved: true,
      }));
      return suggestions.flatMap((s) => (s.platformProduct.id === s0.platformProduct.id ? children : [s]));
    }
    return patchIds(suggestions, id, (s) => ({
      ...s,
      action: 'CREATE_NEW',
      compositionType: undefined,
      isSelected: true,
      resolved: true,
    }));
  }

  // MATCH — confirm or pick (has a canonical candidate). A field conflict, if
  // any, is shown inline on the card; linking keeps your value by default.
  if (s0.question === 'same' && s0.suggestedCanonicalProduct?.id) {
    if (answer === 'primary') {
      return patchIds(suggestions, id, (s) => ({ ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true }));
    }
    // "No / show others" — drop the guess; it falls to KEEP for new-or-skip
    // (the screen may also open search to pick a different match).
    return patchIds(suggestions, id, (s) => ({
      ...s,
      action: 'UNMATCHED',
      suggestedCanonicalProduct: null,
      candidateVariants: undefined,
      isDuplicateSuggestedCanonical: false,
      resolved: false,
      isSelected: false,
    }));
  }

  // NEW / KEEP — nothing matched (kit lands here too: add the set as a product).
  // primary = bring it in as its own product; secondary = skip.
  if (answer === 'primary') {
    return patchIds(suggestions, id, (s) => ({ ...s, action: 'CREATE_NEW', isSelected: true, resolved: true }));
  }
  return patchIds(suggestions, id, (s) => ({ ...s, prevAction: s.action, action: 'IGNORE', isSelected: false, resolved: false }));
}
