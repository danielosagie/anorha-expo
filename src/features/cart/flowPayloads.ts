// Typed navigation payload builders for the capture → generate → finalize flow.
//
// THE point of this module: screens hand each other ITEM IDS and read the rest
// from cart$ — never arrays coupled by index. The legacy index-shaped fields
// (items / jobMap / userImagesByIndex / focusIndex) are still emitted, derived
// from the same store read, so un-migrated consumers keep working; they are
// fallbacks, not the contract.

import { selectAllItems, selectItem } from './cartStore';
import type { CartItem } from './types';

export interface GenerateDetailsLaunchParams {
  jobId: string;
  matchJobId: string;
  status: 'processing';
  /** ID-BASED handoff (canonical): resolve items from cart$ by id. */
  itemIds: string[];
  focusItemId: string;
  /** Legacy index-shaped fallbacks, derived from the same cart read. */
  items: Array<{ index: number; title: string; thumb: string; matchesCount: number; matchJobId?: string }>;
  /** Indexes without a generate job are simply absent (consumers treat missing = no job). */
  jobMap: Record<number, { jobId: string; status?: string }>;
  userImagesByIndex: Record<number, string[]>;
  focusIndex: number;
}

const thumbOf = (it: CartItem): string =>
  it.photos?.find((p) => p.isCover)?.uri || it.photos?.[0]?.uri || '';

/**
 * Build the GenerateDetailsScreen launch payload for a tapped item.
 * The switcher batch = every cart item with a generate job attached; falls back
 * to just the tapped item when it isn't part of the generated batch.
 */
export function buildGenerateDetailsLaunch(focusItemId: string): GenerateDetailsLaunchParams | null {
  const clicked = selectItem(focusItemId);
  if (!clicked) return null;

  const batch = selectAllItems().filter((it) => it.generateJobId || it.generateMatchJobId);
  const list = batch.some((it) => it.id === focusItemId) ? batch : [clicked];
  const focusIndex = Math.max(0, list.findIndex((it) => it.id === focusItemId));

  return {
    jobId: clicked.generateJobId || '',
    matchJobId: clicked.generateMatchJobId || '',
    status: 'processing',
    itemIds: list.map((it) => it.id),
    focusItemId,
    items: list.map((it, index) => ({
      index,
      title: it.title || 'Item',
      thumb: thumbOf(it),
      matchesCount: 1,
      matchJobId: it.generateMatchJobId,
    })),
    jobMap: Object.fromEntries(
      list.flatMap((it, index) => (it.generateJobId ? [[index, { jobId: it.generateJobId }]] : [])),
    ),
    userImagesByIndex: Object.fromEntries(
      list.map((it, index) => [index, (it.photos || []).map((p) => p.uri).filter(Boolean)]),
    ),
    focusIndex,
  };
}

/** Resolve an id-based handoff back into the legacy item-row shape from cart$. */
export function resolveItemsFromIds(
  itemIds: string[],
  fallbackMatchJobId?: string,
): Array<{ index: number; title: string; thumb: string; matchesCount: number; matchJobId?: string; itemId: string }> {
  return itemIds.map((id, index) => {
    const it = selectItem(id);
    return {
      index,
      itemId: id,
      title: it?.title || `Item ${index + 1}`,
      thumb: it ? thumbOf(it) : '',
      matchesCount: 1,
      matchJobId: it?.generateMatchJobId ?? fallbackMatchJobId,
    };
  });
}

/**
 * Derive the per-index generate jobMap from the store for an id-based handoff.
 * Indexes with no job (in store or fallback) are absent — missing key = no job.
 */
export function resolveJobMapFromIds(
  itemIds: string[],
  fallback: Record<number, { jobId: string; status?: string }> = {},
): Record<number, { jobId: string; status?: string }> {
  const out: Record<number, { jobId: string; status?: string }> = {};
  itemIds.forEach((id, index) => {
    const jobId = selectItem(id)?.generateJobId ?? fallback[index]?.jobId;
    if (jobId) out[index] = { jobId, status: fallback[index]?.status };
  });
  return out;
}
