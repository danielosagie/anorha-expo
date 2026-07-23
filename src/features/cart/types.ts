// Cart feature — type model for the capture → cart → preview → checkout flow.
//
// One CartEntry unifies what the legacy AddProductScreen kept in five separate
// pieces of state: bulkItems[i] (photos/title/quantity), quickScanStore[id]
// (match results), confirmedQuickMatchByItemId[id] (the chosen match),
// itemStageById[id] (lifecycle), and processedItemIds. A CartFolder models a
// "shelf" (one wide photo → many detected items) that can be ungrouped into
// top-level singles.

import type { CapturedPhoto } from '../../components/camera/PhotoStack';
import type { MatchResponse, QuickMatchSelection } from '../../screens/AddProduct/types';
import type { MatchJobResult, GenerateJobResult } from '../../contracts';
import type { StatusTransition } from './transitions';

/**
 * Lifecycle status for a cart item — the cart's canonical state. Supersedes the
 * per-item `ItemStage` used by the legacy flow; see `itemStageToStatus` /
 * `statusToItemStage` in cartStore for the bridge during migration.
 */
export type CartStatus =
  | 'capturing'      // photos being added; search not started
  | 'searching'      // find-the-item search in flight
  | 'needs_context'  // couldn't find it — awaiting more context (text / better photo)
  | 'matched'        // found + (auto-)confirmed; ready to check out
  | 'generating'     // post-checkout: listing draft generating
  | 'ready_to_list'  // draft generated; awaiting per-item finalize (SKU + review)
  | 'listed'         // published to platform(s)
  | 'error';

/**
 * Mirrors the legacy `ItemStage` union declared in AddProductScreen.tsx.
 * Kept here so the cart module stays self-contained; consolidate the screen's
 * copy onto this one as a follow-up.
 */
export type ItemStage =
  | 'submitted_for_match'
  | 'awaiting_user_input'
  | 'generating'
  | 'generated'
  | 'existing_inventory';

export interface CartItemMatch {
  /** Full ranked candidates from the search (legacy: quickScanStore[id].matchData). */
  response?: MatchResponse;
  /** Raw marketplace/serp rows backing the candidates (legacy: quickScanStore[id].matchRows). */
  matchRows?: any[];
  /** The auto/user-confirmed selection (legacy: confirmedQuickMatchByItemId[id]). */
  confirmed?: QuickMatchSelection;
  /** Contract-typed per-product result from the orchestrate-match pipeline (src/contracts). */
  jobResult?: MatchJobResult;
}

/** Normalized crop of the shelf source photo that contains this item. */
export interface ShelfItemBox {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface CartItem {
  kind: 'single';
  id: string;
  /** Folder (shelf) this item belongs to, or null when top-level. */
  parentId?: string | null;
  photos: CapturedPhoto[];
  title?: string;
  quantity: number;
  status: CartStatus;
  match?: CartItemMatch;
  /** PricingResearchResult (low / median / high / recommended / samples). */
  pricing?: any;
  /** Why the item is in `needs_context` — surfaced to the user. */
  needsContextReason?: string;
  /** Preserved from legacy bulkItems for source pre-selection. */
  preSelectedSource?: any;
  /** Crop within the parent shelf photo. Coordinates are normalized to 0...1. */
  shelfBox?: ShelfItemBox;
  /** True when the match resolved to an existing inventory ProductVariant. */
  fromInventory?: boolean;
  /** The generate job whose result GenerateDetailsScreen fetches (durable across unmount). */
  generateJobId?: string;
  /** The originating match job (when the item generated via match→auto-generate), for GenerateDetailsScreen's matchJobId. */
  generateMatchJobId?: string;
  /** Contract-typed per-product result of the generate job (src/contracts). */
  generateResult?: GenerateJobResult;
  /** Recent legal status moves (newest last, capped) — written by transitionItem. */
  statusHistory?: StatusTransition[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type CartFolderStatus = 'scanning' | 'partial' | 'complete';

export interface CartFolder {
  kind: 'folder';
  id: string;
  /** Display label, e.g. "Shelf 1". */
  label?: string;
  /** The wide shelf photo this folder was scanned from. */
  sourcePhotoUri?: string;
  /** Ordered ids of the CartItems contained in this folder. */
  childIds: string[];
  status: CartFolderStatus;
  createdAt: number;
  updatedAt: number;
}

export type CartEntry = CartItem | CartFolder;

/** The shape AddProductScreen's legacy `bulkItems` array uses (adapter boundary). */
export interface LegacyBulkItem {
  id: string;
  photos: CapturedPhoto[];
  title?: string;
  isActive?: boolean;
  preSelectedSource?: any;
  quantity?: number;
  shelfBox?: ShelfItemBox;
}

export interface CartState {
  /** All entries (items and folders) keyed by id. */
  entries: Record<string, CartEntry>;
  /** Top-level ordering: folder ids and top-level item ids, in display order. */
  order: string[];
  /** Currently focused item (camera target), or null. */
  activeItemId: string | null;
  /**
   * Ids of items that have been "processed" (submitted for match / confirmed as
   * existing inventory). Mirrors the legacy `processedItemIds`. Processed items
   * are retained in `entries` but filtered out of the legacy bulk-items view.
   */
  processedItemIds: string[];
  /** Sparse map of processed item id → lifecycle stage. Mirrors legacy `itemStageById`. */
  itemStageById: Record<string, ItemStage>;
  /**
   * Ids of items or folders the user set aside ("Save for later"). Saved entries stay in
   * `entries` but are excluded from the active cart list, subtotal, and checkout.
   */
  savedForLaterIds: string[];
}

/** Shape persisted by the legacy draft autosave (saveDraftToBackend). */
export interface CartDraftPayload {
  scannedItems: any[];
  matchContext: Record<string, any>;
  itemStageById: Record<string, ItemStage>;
  processedItemIds: string[];
  savedForLaterIds?: string[];
  shelfPhotoUri?: string | null;
  activeItemId?: string | null;
}

export const isFolder = (e: CartEntry | undefined | null): e is CartFolder =>
  !!e && e.kind === 'folder';

export const isItem = (e: CartEntry | undefined | null): e is CartItem =>
  !!e && e.kind === 'single';
