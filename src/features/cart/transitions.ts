// Explicit state machine for the capture → match → generate → cart → checkout flow.
//
// CartStatus is the canonical per-item lifecycle; this module makes the LEGAL
// MOVES explicit so flow bugs surface as refused transitions (logged loudly)
// instead of silently corrupting an item's lifecycle. `transitionItem` in
// cartStore is the enforcing mutation; `setItemStatus` remains the unchecked
// escape hatch for hydration/adapters only.

import type { CartStatus } from './types';

/**
 * status → statuses it may legally move to.
 *
 *   capturing ──▶ searching ──▶ matched ──▶ generating ──▶ ready_to_list ──▶ listed
 *                     │  ▲          │            │               │
 *                     ▼  │          │            ▼               ▼
 *                 needs_context ◀───┘          error ◀──── (any stage)
 *
 * Backward edges are deliberate: a user can reject a match (matched→searching),
 * add context and retry (needs_context→searching), or regenerate a draft
 * (ready_to_list→generating). `listed` is terminal except for error recovery.
 */
export const CART_TRANSITIONS: Record<CartStatus, readonly CartStatus[]> = {
  capturing: ['searching', 'error'],
  searching: ['matched', 'needs_context', 'error'],
  needs_context: ['searching', 'matched', 'error'],
  matched: ['generating', 'searching', 'needs_context', 'error'],
  generating: ['ready_to_list', 'needs_context', 'error'],
  ready_to_list: ['listed', 'generating', 'error'],
  listed: ['error'],
  error: ['capturing', 'searching', 'generating'],
};

/** Self-transitions are no-ops and always allowed (idempotent updates). */
export function canTransition(from: CartStatus, to: CartStatus): boolean {
  if (from === to) return true;
  return CART_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface StatusTransition {
  from: CartStatus;
  to: CartStatus;
  at: number;
}

/** Cap kept small — history is for debugging flows, not an event log. */
export const STATUS_HISTORY_LIMIT = 12;
