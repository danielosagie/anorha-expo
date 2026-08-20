// attentionGroups — pure, unit-testable helpers that turn the resolver's flat
// `needsAttention: SyncItem[]` into the Avec-style "grouped issues" list the
// question queue shows before its review cards. No React, no side effects: given a
// SyncItem[] it returns ordered groups keyed by AttentionReason (items with no
// reason fall under 'other'). Keep this dependency-light so it stays testable
// with plain node:test.

import type { SyncItem, AttentionReason } from '../../types/syncItem';

// The list view groups by AttentionReason, plus one catch-all bucket for items
// the resolver flagged without a specific reason.
export type GroupKey = AttentionReason | 'other';

export interface AttentionGroup {
  key: GroupKey;
  items: SyncItem[];
}

// The reason bucket an item belongs to. Undefined reason → 'other'.
export function reasonKeyOf(item: SyncItem): GroupKey {
  return item.attention ?? 'other';
}

const TIE_ORDER: GroupKey[] = [
  'commit_failed',
  'multiple_candidates',
  'weak_match',
  'look_alike_group',
  'duplicate_target',
  'field_conflict',
  'bundle',
  'stale_link',
  'title_quality',
  'other',
];

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
    groups.push({ key, items: arr });
  }
  groups.sort((a, b) => {
    // Status loud: a failed import outranks every open question, whatever the
    // counts say. Then largest bucket first, stable tiebreak by TIE_ORDER.
    if (a.key === 'commit_failed' !== (b.key === 'commit_failed')) {
      return a.key === 'commit_failed' ? -1 : 1;
    }
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return TIE_ORDER.indexOf(a.key) - TIE_ORDER.indexOf(b.key);
  });
  return groups;
}

// The items belonging to one group key — used to feed the deck a single group.
export function itemsForGroup(items: SyncItem[], key: GroupKey): SyncItem[] {
  return items.filter((it) => reasonKeyOf(it) === key);
}
