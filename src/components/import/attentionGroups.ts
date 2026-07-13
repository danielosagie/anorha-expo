// attentionGroups — pure, unit-testable helpers that turn the resolver's flat
// `needsAttention: SyncItem[]` into the Avec-style "grouped issues" list the
// SyncInbox shows before the swipe deck. No React, no side effects: given a
// SyncItem[] it returns ordered groups keyed by AttentionReason (items with no
// reason fall under 'other'). Keep this dependency-light so it stays testable
// with plain node:test.

import type { SyncItem, AttentionReason } from '../../types/syncItem';

// The list view groups by AttentionReason, plus one catch-all bucket for items
// the resolver flagged without a specific reason.
export type GroupKey = AttentionReason | 'other';

// Human labels the owner approved (Avec "Review the rest" copy). Bold group
// label on the left of each soft-card row.
export const REASON_LABELS: Record<GroupKey, string> = {
  multiple_candidates: 'Could match something you have',
  weak_match: 'Loose matches — double-check',
  look_alike_group: 'Look-alikes',
  duplicate_target: 'Possible duplicates',
  field_conflict: 'Details disagree',
  bundle: 'Bundles / multi-packs',
  stale_link: 'Links to re-confirm',
  other: 'Other',
};

export interface AttentionGroup {
  key: GroupKey;
  label: string;
  items: SyncItem[];
}

// The reason bucket an item belongs to. Undefined reason → 'other'.
export function reasonKeyOf(item: SyncItem): GroupKey {
  return item.attention ?? 'other';
}

// Deterministic tiebreak when two groups have equal counts, so the list doesn't
// reshuffle between renders. Derived from REASON_LABELS' declaration order (a
// hand-kept parallel array could silently drift from GroupKey, and a missing key
// → indexOf -1 would corrupt the order) — so REASON_LABELS is the single source
// of order. Its declaration keeps 'other' last, which keeps that bucket sinking.
const TIE_ORDER: GroupKey[] = Object.keys(REASON_LABELS) as GroupKey[];

// Group items by reason, largest bucket first (stable tiebreak by TIE_ORDER).
// Empty buckets are never emitted, so callers can render one row per group.
export function groupItems(items: SyncItem[]): AttentionGroup[] {
  const buckets = new Map<GroupKey, SyncItem[]>();
  for (const it of items) {
    const key = reasonKeyOf(it);
    const arr = buckets.get(key);
    if (arr) arr.push(it);
    else buckets.set(key, [it]);
  }
  const groups: AttentionGroup[] = [];
  for (const [key, arr] of buckets) {
    groups.push({ key, label: REASON_LABELS[key], items: arr });
  }
  groups.sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return TIE_ORDER.indexOf(a.key) - TIE_ORDER.indexOf(b.key);
  });
  return groups;
}

// The items belonging to one group key — used to feed the deck a single group.
export function itemsForGroup(items: SyncItem[], key: GroupKey): SyncItem[] {
  return items.filter((it) => reasonKeyOf(it) === key);
}
