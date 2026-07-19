// Cart store — local-first Legend State observable that is the single source of
// truth for the capture → cart → preview → checkout flow.
//
// Follows the LocalConversationStore pattern: an in-memory Legend observable is
// the source of truth, with a debounced AsyncStorage snapshot for cold-start
// recovery. `serializeCartToDraft` / `hydrateCartFromDraft` bridge to the
// existing backend draft schema (saveDraftToBackend) so Scan Drafts keep working.
//
// Components read the cart by wrapping in `observer(...)` from
// '@legendapp/state/react' and calling the select* helpers below.

import { observable } from '@legendapp/state';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values'; // polyfill for uuid
import { v4 as uuidv4 } from 'uuid';
import type { CapturedPhoto } from '../../components/camera/PhotoStack';
import type { QuickMatchSelection } from '../../screens/AddProduct/types';
import type {
  CartDraftPayload,
  CartEntry,
  CartFolder,
  CartFolderStatus,
  CartItem,
  CartItemMatch,
  CartState,
  CartStatus,
  ItemStage,
  LegacyBulkItem,
} from './types';
import { isFolder, isItem } from './types';
import { canTransition, STATUS_HISTORY_LIMIT } from './transitions';
import { createLogger } from '../../utils/logger';
const log = createLogger('cartStore');


const STORAGE_KEY = 'cart:v1';
const SESSION_KEY = 'cart:v1:sessionId'; // backend quick-scan-session id, tied to the snapshot's lifecycle
const newId = () => uuidv4();
const now = () => Date.now();

const emptyState = (): CartState => ({
  entries: {},
  order: [],
  activeItemId: null,
  processedItemIds: [],
  itemStageById: {},
  savedForLaterIds: [],
});

/** Local-first source of truth for the capture → checkout cart. */
export const cart$ = observable<CartState>(emptyState());

const getEntry = (id: string): CartEntry | undefined => cart$.entries[id].get();

// A child item is "resolved" once it no longer needs the pipeline's attention.
const RESOLVED: CartStatus[] = ['matched', 'ready_to_list', 'listed', 'error'];
const PROGRESSED: CartStatus[] = ['matched', 'ready_to_list', 'listed'];

function recomputeFolderStatus(folderId: string) {
  const folder = getEntry(folderId);
  if (!isFolder(folder)) return;
  const children = folder.childIds.map(getEntry).filter(isItem);
  let status: CartFolderStatus = 'scanning';
  if (children.length > 0) {
    if (children.every(c => RESOLVED.includes(c.status))) status = 'complete';
    else if (children.some(c => PROGRESSED.includes(c.status))) status = 'partial';
  }
  cart$.entries[folderId].assign({ status, updatedAt: now() });
}

// --- mutations -------------------------------------------------------------

export function resetCart() {
  cart$.set(emptyState());
}

export function addSingleItem(
  photos: CapturedPhoto[] = [],
  opts: {
    title?: string;
    quantity?: number;
    status?: CartStatus;
    setActive?: boolean;
    preSelectedSource?: any;
  } = {},
): string {
  const id = newId();
  const ts = now();
  const item: CartItem = {
    kind: 'single',
    id,
    parentId: null,
    photos,
    title: opts.title,
    quantity: opts.quantity ?? 1,
    status: opts.status ?? (photos.length > 0 ? 'searching' : 'capturing'),
    preSelectedSource: opts.preSelectedSource,
    createdAt: ts,
    updatedAt: ts,
  };
  cart$.entries[id].set(item);
  cart$.order.set([...cart$.order.get(), id]);
  if (opts.setActive ?? true) cart$.activeItemId.set(id);
  return id;
}

/** Insert a single item under a caller-supplied id (used by the legacy bulk-items adapter). */
export function addItemWithId(
  id: string,
  photos: CapturedPhoto[] = [],
  opts: { title?: string; quantity?: number; status?: CartStatus; preSelectedSource?: any } = {},
): void {
  if (getEntry(id)) return;
  const ts = now();
  cart$.entries[id].set({
    kind: 'single',
    id,
    parentId: null,
    photos,
    title: opts.title,
    quantity: opts.quantity ?? 1,
    status: opts.status ?? (photos.length > 0 ? 'searching' : 'capturing'),
    preSelectedSource: opts.preSelectedSource,
    createdAt: ts,
    updatedAt: ts,
  });
  cart$.order.set([...cart$.order.get(), id]);
}

export function addPhotoToItem(itemId: string, photo: CapturedPhoto) {
  const item = getEntry(itemId);
  if (!isItem(item)) return;
  cart$.entries[itemId].assign({ photos: [...item.photos, photo], updatedAt: now() });
}

export function setItemPhotos(itemId: string, photos: CapturedPhoto[]) {
  if (!isItem(getEntry(itemId))) return;
  cart$.entries[itemId].assign({ photos, updatedAt: now() });
}

export function updateItem(itemId: string, patch: Partial<Omit<CartItem, 'kind' | 'id'>>) {
  if (!isItem(getEntry(itemId))) return;
  cart$.entries[itemId].assign({ ...patch, updatedAt: now() });
}

/**
 * Swap a captured photo's uri (e.g. local `file://` → uploaded public URL) once the scan
 * upload finishes. The persisted scan session and the clearout agent read the cart item's
 * photos, so leaving a device-local path here means the agent gets a `file://` it can't open
 * ("send me a pic"). Writing the public URL back fixes that at the source.
 */
export function setItemPhotoUri(itemId: string, photoId: string, uri: string) {
  const entry = getEntry(itemId);
  if (!isItem(entry)) return;
  const photos = Array.isArray((entry as CartItem).photos) ? (entry as CartItem).photos : [];
  if (!photos.some(p => p?.id === photoId)) return;
  cart$.entries[itemId].assign({
    photos: photos.map(p => (p?.id === photoId ? { ...p, uri } : p)),
    updatedAt: now(),
  });
}

export function setItemTitle(itemId: string, title: string) {
  if (!isItem(getEntry(itemId))) return;
  cart$.entries[itemId].assign({ title, updatedAt: now() });
}

export function setItemQuantity(itemId: string, quantity: number) {
  if (!isItem(getEntry(itemId))) return;
  const q = Math.max(1, Math.floor(quantity) || 1);
  cart$.entries[itemId].assign({ quantity: q, updatedAt: now() });
}

/**
 * Move an item through the explicit state machine (see transitions.ts).
 * Refuses (and loudly logs) illegal moves so flow bugs surface instead of
 * silently corrupting lifecycle state. Records a capped statusHistory.
 * Returns whether the transition was applied. Prefer this over setItemStatus
 * in flow code; setItemStatus is the unchecked path for hydration/adapters.
 */
export function transitionItem(
  itemId: string,
  to: CartStatus,
  extra?: { needsContextReason?: string; error?: string },
): boolean {
  const item = getEntry(itemId);
  if (!isItem(item)) return false;
  const from = item.status;
  if (!canTransition(from, to)) {
    log.warn(`[cart] REFUSED illegal transition ${from} → ${to} for item ${itemId}`);
    return false;
  }
  if (from !== to) {
    const history = [...(item.statusHistory ?? []), { from, to, at: now() }].slice(-STATUS_HISTORY_LIMIT);
    cart$.entries[itemId].assign({ statusHistory: history });
  }
  setItemStatus(itemId, to, extra);
  return true;
}

export function setItemStatus(
  itemId: string,
  status: CartStatus,
  extra?: { needsContextReason?: string; error?: string },
) {
  const item = getEntry(itemId);
  if (!isItem(item)) return;
  cart$.entries[itemId].assign({
    status,
    needsContextReason:
      status === 'needs_context' ? extra?.needsContextReason ?? item.needsContextReason : undefined,
    error: status === 'error' ? extra?.error ?? item.error : undefined,
    updatedAt: now(),
  });
  if (item.parentId) recomputeFolderStatus(item.parentId);
}

export function setItemMatch(itemId: string, match: CartItemMatch, opts: { status?: CartStatus } = {}) {
  const item = getEntry(itemId);
  if (!isItem(item)) return;
  cart$.entries[itemId].assign({
    match: { ...(item.match ?? {}), ...match },
    status: opts.status ?? item.status,
    updatedAt: now(),
  });
  if (item.parentId) recomputeFolderStatus(item.parentId);
}

export function setItemConfirmedMatch(
  itemId: string,
  confirmed: QuickMatchSelection,
  opts: { markMatched?: boolean; fromInventory?: boolean } = {},
) {
  const item = getEntry(itemId);
  if (!isItem(item)) return;
  cart$.entries[itemId].assign({
    match: { ...(item.match ?? {}), confirmed },
    fromInventory: opts.fromInventory ?? item.fromInventory,
    status: opts.markMatched === false ? item.status : 'matched',
    updatedAt: now(),
  });
  if (item.parentId) recomputeFolderStatus(item.parentId);
}

export function setItemPricing(itemId: string, pricing: any) {
  if (!isItem(getEntry(itemId))) return;
  cart$.entries[itemId].assign({ pricing, updatedAt: now() });
}

/** Attach generation job ids to an item (durable across unmount) for the click → GenerateDetailsScreen handoff. */
export function setItemGenerate(itemId: string, patch: { generateJobId?: string; generateMatchJobId?: string }) {
  if (!isItem(getEntry(itemId))) return;
  cart$.entries[itemId].assign({ ...patch, updatedAt: now() });
}

/** "Save for later" — set the item aside without losing it (excluded from checkout/subtotal). */
export function setItemSavedForLater(itemId: string, saved: boolean) {
  const prev = cart$.savedForLaterIds.get();
  const has = prev.includes(itemId);
  if (saved && !has) cart$.savedForLaterIds.set([...prev, itemId]);
  else if (!saved && has) cart$.savedForLaterIds.set(prev.filter(id => id !== itemId));
}

export function setItemNeedsContext(itemId: string, reason: string) {
  setItemStatus(itemId, 'needs_context', { needsContextReason: reason });
}

export function setActiveItem(id: string | null) {
  cart$.activeItemId.set(id);
}

export function removeEntry(id: string) {
  const entry = getEntry(id);
  if (!entry) return;

  if (isFolder(entry)) {
    for (const cid of entry.childIds) cart$.entries[cid].delete();
  } else if (entry.parentId) {
    const folder = getEntry(entry.parentId);
    if (isFolder(folder)) {
      cart$.entries[entry.parentId].set({
        ...folder,
        childIds: folder.childIds.filter(c => c !== id),
        updatedAt: now(),
      });
      recomputeFolderStatus(entry.parentId);
    }
  }

  cart$.entries[id].delete();
  cart$.order.set(cart$.order.get().filter(x => x !== id));
  const removedIds = isFolder(entry) ? [id, ...entry.childIds] : [id];
  const saved = cart$.savedForLaterIds.get();
  if (saved.some(s => removedIds.includes(s))) {
    cart$.savedForLaterIds.set(saved.filter(s => !removedIds.includes(s)));
  }

  if (cart$.activeItemId.get() === id) {
    const nextActive = selectAllItems().find(it => it.id !== id)?.id ?? null;
    cart$.activeItemId.set(nextActive);
  }
}

/** Create a "shelf" folder containing freshly detected items. */
export function createFolderFromShelf(input: {
  sourcePhotoUri?: string;
  label?: string;
  /** Items may carry an explicit id so callers (e.g. the shelf SSE stream) can address them later. */
  items: Array<{ id?: string; title?: string; quantity?: number; photos?: CapturedPhoto[]; status?: CartStatus }>;
}): { folderId: string; childIds: string[] } {
  const ts = now();
  const folderId = newId();
  const childIds: string[] = [];

  for (const raw of input.items) {
    const cid = raw.id || newId();
    childIds.push(cid);
    const child: CartItem = {
      kind: 'single',
      id: cid,
      parentId: folderId,
      photos: raw.photos ?? [],
      title: raw.title,
      quantity: raw.quantity ?? 1,
      status: raw.status ?? 'searching',
      createdAt: ts,
      updatedAt: ts,
    };
    cart$.entries[cid].set(child);
  }

  const folder: CartFolder = {
    kind: 'folder',
    id: folderId,
    label: input.label,
    sourcePhotoUri: input.sourcePhotoUri,
    childIds,
    status: 'scanning',
    createdAt: ts,
    updatedAt: ts,
  };
  cart$.entries[folderId].set(folder);
  cart$.order.set([...cart$.order.get(), folderId]);
  return { folderId, childIds };
}

/** Add newly streamed shelf results to an existing folder without recreating it. */
export function addItemsToFolder(
  folderId: string,
  items: { id?: string; title?: string; quantity?: number; photos?: CapturedPhoto[]; status?: CartStatus }[],
): string[] {
  const folder = getEntry(folderId);
  if (!isFolder(folder)) return [];

  const ts = now();
  const nextChildIds = [...folder.childIds];
  const addedIds: string[] = [];

  for (const raw of items) {
    const childId = raw.id || newId();
    const existing = getEntry(childId);

    if (isItem(existing)) {
      if (existing.parentId !== folderId) continue;
      if (!nextChildIds.includes(childId)) nextChildIds.push(childId);
      addedIds.push(childId);
      continue;
    }

    cart$.entries[childId].set({
      kind: 'single',
      id: childId,
      parentId: folderId,
      photos: raw.photos ?? [],
      title: raw.title,
      quantity: raw.quantity ?? 1,
      status: raw.status ?? 'searching',
      createdAt: ts,
      updatedAt: ts,
    });
    nextChildIds.push(childId);
    addedIds.push(childId);
  }

  if (addedIds.length > 0) {
    cart$.entries[folderId].assign({
      childIds: nextChildIds,
      status: 'scanning',
      updatedAt: ts,
    });
  }

  return addedIds;
}

/** Dissolve a folder, promoting its children to top-level singles in place. */
export function ungroupFolder(folderId: string) {
  const folder = getEntry(folderId);
  if (!isFolder(folder)) return;

  for (const cid of folder.childIds) {
    if (isItem(getEntry(cid))) cart$.entries[cid].assign({ parentId: null, updatedAt: now() });
  }

  const order = cart$.order.get();
  const idx = order.indexOf(folderId);
  const next =
    idx === -1
      ? [...order, ...folder.childIds]
      : [...order.slice(0, idx), ...folder.childIds, ...order.slice(idx + 1)];
  cart$.order.set(next);
  cart$.entries[folderId].delete();
}

// --- selectors -------------------------------------------------------------

export function selectTopLevelEntries(): CartEntry[] {
  const state = cart$.get();
  return state.order.map(id => state.entries[id]).filter(Boolean) as CartEntry[];
}

export function selectFolderChildren(folderId: string): CartItem[] {
  const folder = getEntry(folderId);
  if (!isFolder(folder)) return [];
  const entries = cart$.entries.get();
  return folder.childIds.map(cid => entries[cid]).filter(isItem) as CartItem[];
}

/** All single items in display order, flattening folders — the legacy "bulkItems" view. */
export function selectAllItems(): CartItem[] {
  const state = cart$.get();
  const out: CartItem[] = [];
  for (const id of state.order) {
    const e = state.entries[id];
    if (!e) continue;
    if (e.kind === 'folder') {
      for (const cid of e.childIds) {
        const c = state.entries[cid];
        if (c && c.kind === 'single') out.push(c);
      }
    } else if (e.kind === 'single') {
      out.push(e);
    }
  }
  return out;
}

export function selectItem(itemId: string): CartItem | undefined {
  const e = getEntry(itemId);
  return isItem(e) ? e : undefined;
}

export function selectActiveItemId(): string | null {
  return cart$.activeItemId.get();
}

export function selectCounts() {
  const items = selectAllItems();
  return {
    total: items.length,
    searching: items.filter(i => i.status === 'searching').length,
    needsContext: items.filter(i => i.status === 'needs_context').length,
    matched: items.filter(i => i.status === 'matched').length,
    readyToList: items.filter(i => i.status === 'ready_to_list').length,
    listed: items.filter(i => i.status === 'listed').length,
  };
}

// --- legacy bulk-items adapter ---------------------------------------------
// These project cart$ into the exact shapes AddProductScreen's pre-cart state
// used, and reconcile its setX(prev => next) updates back into cart$. "Processed"
// items are filtered out of the active bulk-items LIST (selectLegacyBulkItems) but
// their match/confirmed data stays exposed (selectLegacyQuickScanStore/Confirmed)
// so navigating back to an already-matched item still shows its match.

export const selectProcessedSet = (): Set<string> => new Set(cart$.processedItemIds.get());

export function selectLegacyBulkItems(): LegacyBulkItem[] {
  const activeId = cart$.activeItemId.get();
  const processed = selectProcessedSet();
  return selectAllItems()
    .filter(it => !processed.has(it.id))
    .map(it => ({
      id: it.id,
      photos: it.photos,
      title: it.title,
      isActive: it.id === activeId,
      preSelectedSource: it.preSelectedSource,
      quantity: it.quantity,
    }));
}

export function selectLegacyQuickScanStore(): Record<string, { matchData: any; matchRows: any[] }> {
  // Processed items are INCLUDED here on purpose: their match data lives in cart$
  // and must stay readable so navigating back to an already-matched item still
  // shows its match (it's filtered only from the active bulk-items list, above).
  const out: Record<string, { matchData: any; matchRows: any[] }> = {};
  for (const it of selectAllItems()) {
    if (it.match?.response || it.match?.matchRows) {
      out[it.id] = { matchData: it.match.response, matchRows: it.match.matchRows ?? [] };
    }
  }
  return out;
}

export function selectLegacyConfirmed(): Record<string, QuickMatchSelection> {
  // Processed items included (see selectLegacyQuickScanStore) so a confirmed/auto
  // selection survives navigate-back.
  const out: Record<string, QuickMatchSelection> = {};
  for (const it of selectAllItems()) {
    if (it.match?.confirmed) out[it.id] = it.match.confirmed;
  }
  return out;
}

/** Apply a legacy setBulkItems(next) result back into cart$ (add / remove / update by id). */
export function reconcileBulkItems(prev: LegacyBulkItem[], next: LegacyBulkItem[]) {
  const nextIds = new Set(next.map(i => i.id));
  for (const p of prev) {
    if (!nextIds.has(p.id)) removeEntry(p.id);
  }
  for (const n of next) {
    if (!getEntry(n.id)) {
      addItemWithId(n.id, n.photos ?? [], {
        title: n.title,
        quantity: n.quantity,
        preSelectedSource: n.preSelectedSource,
      });
    } else {
      updateItem(n.id, {
        photos: n.photos ?? [],
        title: n.title,
        quantity: n.quantity ?? 1,
        preSelectedSource: n.preSelectedSource,
      });
    }
  }
  const activeFromFlag = next.find(n => n.isActive)?.id;
  if (activeFromFlag && cart$.activeItemId.get() !== activeFromFlag) {
    cart$.activeItemId.set(activeFromFlag);
  }
}

export function reconcileQuickScanStore(
  prev: Record<string, { matchData: any; matchRows: any[] }>,
  next: Record<string, { matchData: any; matchRows: any[] }>,
) {
  for (const id of Object.keys(next)) {
    if (!getEntry(id)) continue;
    const v = next[id];
    setItemMatch(id, { response: v?.matchData, matchRows: v?.matchRows ?? [] });
  }
  // Clear match data ONLY for a live, non-processed item the screen explicitly
  // dropped from the map (e.g. a re-scan reset). Processed items keep their match
  // in cart$ (navigate-back); fully removed items are cleared via removeEntry.
  // Without the processed-guard, markItemsProcessed's map-prune wiped the match
  // that we now want to retain — the "go back and the data is gone" bug.
  const processed = selectProcessedSet();
  for (const id of Object.keys(prev)) {
    if (!(id in next) && getEntry(id) && !processed.has(id)) {
      setItemMatch(id, { response: undefined, matchRows: undefined });
    }
  }
}

export function reconcileConfirmed(
  prev: Record<string, QuickMatchSelection>,
  next: Record<string, QuickMatchSelection>,
) {
  for (const id of Object.keys(next)) {
    if (!getEntry(id)) continue;
    setItemConfirmedMatch(id, next[id], { markMatched: false });
  }
  // Same guard as reconcileQuickScanStore: a re-research on a LIVE, non-processed
  // item legitimately drops its confirmed selection so fresh results surface, but
  // a processed item must keep its confirmed match for navigate-back.
  const processed = selectProcessedSet();
  for (const id of Object.keys(prev)) {
    if (!(id in next) && getEntry(id) && !processed.has(id)) {
      const it = selectItem(id);
      if (it?.match) updateItem(id, { match: { ...it.match, confirmed: undefined } });
    }
  }
}

/** Reset cart$ from the screen's initial legacy state (once, on mount). */
export function seedCartFromLegacy(initial: {
  bulkItems?: LegacyBulkItem[];
  activeItemId?: string | null;
  itemStageById?: Record<string, ItemStage>;
  processedItemIds?: string[];
}) {
  const ts = now();
  const entries: Record<string, CartEntry> = {};
  const order: string[] = [];
  for (const b of initial.bulkItems ?? []) {
    if (!b?.id) continue;
    const photos: CapturedPhoto[] = Array.isArray(b.photos) ? b.photos : [];
    entries[b.id] = {
      kind: 'single',
      id: b.id,
      parentId: null,
      photos,
      title: b.title,
      quantity: typeof b.quantity === 'number' ? b.quantity : 1,
      status: photos.length > 0 ? 'searching' : 'capturing',
      preSelectedSource: b.preSelectedSource,
      createdAt: ts,
      updatedAt: ts,
    };
    order.push(b.id);
  }
  cart$.set({
    entries,
    order,
    activeItemId: initial.activeItemId ?? null,
    processedItemIds: initial.processedItemIds ?? [],
    itemStageById: initial.itemStageById ?? {},
    // Carry saved-for-later across reseeds for any items that survived.
    savedForLaterIds: cart$.savedForLaterIds.get().filter((id) => !!entries[id]),
  });
}

// --- legacy stage <-> status bridge ----------------------------------------

export function itemStageToStatus(stage: ItemStage): CartStatus {
  switch (stage) {
    case 'submitted_for_match':
      return 'searching';
    case 'awaiting_user_input':
      return 'needs_context';
    case 'generating':
      return 'generating';
    case 'generated':
      return 'ready_to_list';
    case 'existing_inventory':
      return 'matched';
    default:
      return 'capturing';
  }
}

export function statusToItemStage(status: CartStatus, fromInventory?: boolean): ItemStage | undefined {
  switch (status) {
    case 'searching':
      return 'submitted_for_match';
    case 'needs_context':
      return 'awaiting_user_input';
    case 'generating':
      return 'generating';
    case 'ready_to_list':
    case 'listed':
      return 'generated';
    case 'matched':
      return fromInventory ? 'existing_inventory' : 'submitted_for_match';
    default:
      return undefined;
  }
}

// --- draft (backend) bridge ------------------------------------------------

const FOLDERS_KEY = '__folders'; // reserved key inside matchContext for folder grouping

/** Map the cart into the legacy draft payload accepted by saveDraftToBackend. */
export function serializeCartToDraft(extra?: { shelfPhotoUri?: string | null }): CartDraftPayload {
  const activeItemId = cart$.activeItemId.get();
  const processed = selectProcessedSet();
  const items = selectAllItems().filter(it => !processed.has(it.id));

  const scannedItems = items.map(it => ({
    id: it.id,
    photos: it.photos,
    title: it.title,
    isActive: activeItemId === it.id,
    preSelectedSource: it.preSelectedSource,
    quantity: it.quantity,
    parentId: it.parentId ?? null,
  }));

  const matchContext: Record<string, any> = {};
  for (const it of items) {
    if (it.match?.response || it.match?.matchRows) {
      matchContext[it.id] = { matchData: it.match.response, matchRows: it.match.matchRows ?? [] };
    }
  }

  // Carry folder grouping through the opaque matchContext blob so it round-trips.
  matchContext[FOLDERS_KEY] = selectTopLevelEntries()
    .filter(isFolder)
    .map(f => ({ id: f.id, label: f.label, sourcePhotoUri: f.sourcePhotoUri, childIds: f.childIds }));

  return {
    scannedItems,
    matchContext,
    itemStageById: { ...cart$.itemStageById.get() },
    processedItemIds: [...cart$.processedItemIds.get()],
    shelfPhotoUri: extra?.shelfPhotoUri ?? null,
    activeItemId,
  };
}

/** Rebuild the cart from a loaded draft payload (best-effort, folder-aware). */
export function hydrateCartFromDraft(payload: CartDraftPayload) {
  const scanned = Array.isArray(payload.scannedItems) ? payload.scannedItems : [];
  const matchCtx = payload.matchContext ?? {};
  const folders: Array<{ id: string; label?: string; sourcePhotoUri?: string; childIds: string[] }> =
    Array.isArray((matchCtx as any)[FOLDERS_KEY]) ? (matchCtx as any)[FOLDERS_KEY] : [];

  const entries: Record<string, CartEntry> = {};
  const childIdSet = new Set<string>(folders.flatMap(f => f.childIds));
  const ts = now();

  // Only non-processed items are persisted in scannedItems; processed ones live
  // solely in processedItemIds / itemStageById (matching the legacy draft schema).
  for (const s of scanned) {
    if (!s?.id) continue;
    const ctx = matchCtx[s.id];
    const photos: CapturedPhoto[] = Array.isArray(s.photos) ? s.photos : [];
    entries[s.id] = {
      kind: 'single',
      id: s.id,
      parentId: s.parentId ?? null,
      photos,
      title: s.title,
      quantity: typeof s.quantity === 'number' ? s.quantity : 1,
      status: photos.length ? 'searching' : 'capturing',
      match: ctx ? { response: ctx.matchData, matchRows: ctx.matchRows } : undefined,
      preSelectedSource: s.preSelectedSource,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  for (const f of folders) {
    entries[f.id] = {
      kind: 'folder',
      id: f.id,
      label: f.label,
      sourcePhotoUri: f.sourcePhotoUri,
      childIds: f.childIds.filter(cid => entries[cid]),
      status: 'scanning',
      createdAt: ts,
      updatedAt: ts,
    };
  }

  const order: string[] = [];
  for (const f of folders) if (entries[f.id]) order.push(f.id);
  for (const s of scanned) if (s?.id && !childIdSet.has(s.id) && entries[s.id]) order.push(s.id);

  cart$.set({
    entries,
    order,
    activeItemId: payload.activeItemId ?? null,
    processedItemIds: Array.isArray(payload.processedItemIds) ? payload.processedItemIds : [],
    itemStageById: payload.itemStageById ?? {},
    savedForLaterIds: cart$.savedForLaterIds.get().filter((id) => !!entries[id]),
  });
  for (const f of folders) if (entries[f.id]) recomputeFolderStatus(f.id);
}

// --- local snapshot (cold-start recovery) ----------------------------------

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

export async function hydrateCartSnapshot(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as CartState;
    if (parsed && parsed.entries && Array.isArray(parsed.order)) {
      cart$.set({
        entries: parsed.entries,
        order: parsed.order,
        activeItemId: parsed.activeItemId ?? null,
        processedItemIds: Array.isArray(parsed.processedItemIds) ? parsed.processedItemIds : [],
        itemStageById: parsed.itemStageById ?? {},
        savedForLaterIds: Array.isArray(parsed.savedForLaterIds) ? parsed.savedForLaterIds : [],
      });
      return true;
    }
  } catch {
    // ignore corrupt snapshot
  }
  return false;
}

export function persistCartSnapshot(opts?: { immediate?: boolean }) {
  const write = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cart$.get()));
    } catch {
      // best-effort
    }
  };
  if (opts?.immediate) {
    void write();
    return;
  }
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void write();
  }, 200);
}

/** Auto-persist a local snapshot whenever the cart changes. Returns a disposer. */
export function startCartSnapshotAutosave(): () => void {
  return cart$.onChange(() => persistCartSnapshot());
}

/** Peek the saved snapshot's UNFINISHED item count WITHOUT mutating cart$ — drives the
 *  resume prompt. Excludes already-processed items so an all-resolved cart doesn't re-prompt. */
export async function peekCartSnapshot(): Promise<{ count: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CartState;
    const order = Array.isArray(parsed?.order) ? parsed.order : Object.keys(parsed?.entries ?? {});
    const processed = new Set(Array.isArray(parsed?.processedItemIds) ? parsed.processedItemIds : []);
    const count = order.filter((id) => !processed.has(id)).length;
    return count > 0 ? { count } : null;
  } catch {
    return null;
  }
}

/** Drop the saved snapshot AND its backend draft-session id (used by "Start fresh"). */
export async function clearCartSnapshot(): Promise<void> {
  if (snapshotTimer) { clearTimeout(snapshotTimer); snapshotTimer = null; }
  try { await AsyncStorage.multiRemove([STORAGE_KEY, SESSION_KEY]); } catch { /* best-effort */ }
}

// --- durable backend draft-session id --------------------------------------
// The cart snapshot survives remounts, but the backend quick-scan-session id used to
// live only in a screen-local ref — so every remount of a resumed cart created a NEW
// draft row for the same items (the "many drafts per cart" sprawl; 89 rows for one
// user). Persist the id next to the snapshot so the whole cart lifecycle writes to ONE
// draft. Created with the first meaningful save, cleared together with the snapshot on
// "Start fresh".
export async function getActiveDraftSessionId(): Promise<string | null> {
  try { return (await AsyncStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
export async function setActiveDraftSessionId(id: string): Promise<void> {
  try { await AsyncStorage.setItem(SESSION_KEY, id); } catch { /* best-effort */ }
}
export async function clearActiveDraftSessionId(): Promise<void> {
  try { await AsyncStorage.removeItem(SESSION_KEY); } catch { /* best-effort */ }
}
