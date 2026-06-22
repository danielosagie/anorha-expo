// useBulkItems — backs AddProductScreen's legacy bulk-items state with the cart$
// store (the `useBulkItems` hook the NEXT_ENGINEER_PLAN called for, Part B.1).
//
// It exposes the EXACT { bulkItems, setBulkItems, activeItemId, ... } surface the
// screen already used, so the ~83 existing call sites stay unchanged while cart$
// becomes the single source of truth. Each setter accepts a value or an updater
// (prev => next) and reads `prev` live from cart$, so functional updates compose
// correctly even within a single synchronous handler (e.g. markItemsProcessed).

import { useCallback, useEffect, useState } from 'react';
import {
  cart$,
  createFolderFromShelf,
  reconcileBulkItems,
  reconcileConfirmed,
  reconcileQuickScanStore,
  seedCartFromLegacy,
  selectFolderChildren,
  selectLegacyBulkItems,
  selectLegacyConfirmed,
  selectLegacyQuickScanStore,
  selectProcessedSet,
  selectTopLevelEntries,
  setItemSavedForLater as storeSetItemSavedForLater,
  ungroupFolder as storeUngroupFolder,
} from '../../../features/cart/cartStore';
import { isFolder } from '../../../features/cart/types';
import type { CartItem, ItemStage, LegacyBulkItem } from '../../../features/cart/types';
import type { QuickMatchSelection } from '../types';

type SetState<T> = T | ((prev: T) => T);
type QuickScanStore = Record<string, { matchData: any; matchRows: any[] }>;
type ConfirmedMap = Record<string, QuickMatchSelection>;
type StageMap = Record<string, ItemStage>;

/** Top-level cart structure for rendering: a single item, or a shelf folder with its children. */
export type CartTreeNode =
  | { kind: 'single'; item: LegacyBulkItem }
  | { kind: 'folder'; id: string; label?: string; status: string; sourcePhotoUri?: string; childCount: number; children: LegacyBulkItem[] };

export interface ShelfFolderInput {
  sourcePhotoUri?: string;
  label?: string;
  items: Array<{ id?: string; title?: string; quantity?: number }>;
}

export interface BulkItemsInitial {
  bulkItems?: LegacyBulkItem[];
  activeItemId?: string | null;
  itemStageById?: StageMap;
  processedItemIds?: string[];
}

export interface UseBulkItems {
  bulkItems: LegacyBulkItem[];
  setBulkItems: (arg: SetState<LegacyBulkItem[]>) => void;
  activeItemId: string | null;
  setActiveItemId: (arg: SetState<string | null>) => void;
  quickScanStore: QuickScanStore;
  setQuickScanStore: (arg: SetState<QuickScanStore>) => void;
  confirmedQuickMatchByItemId: ConfirmedMap;
  setConfirmedQuickMatchByItemId: (arg: SetState<ConfirmedMap>) => void;
  itemStageById: StageMap;
  setItemStageById: (arg: SetState<StageMap>) => void;
  processedItemIds: string[];
  setProcessedItemIds: (arg: SetState<string[]>) => void;
  /** Top-level cart structure (singles + shelf folders) for the cart UI. */
  cartTree: CartTreeNode[];
  /** Create a shelf folder of detected items in the shared cart; returns the new ids. */
  createShelfFolder: (input: ShelfFolderInput) => { folderId: string; childIds: string[] };
  /** Dissolve a folder, promoting its children to top-level singles. */
  ungroupFolder: (folderId: string) => void;
  /** Item ids set aside via "Save for later" (excluded from checkout/subtotal). */
  savedForLaterIds: string[];
  setItemSavedForLater: (itemId: string, saved: boolean) => void;
}

const resolve = <T,>(arg: SetState<T>, prev: T): T =>
  typeof arg === 'function' ? (arg as (p: T) => T)(prev) : arg;

function deriveAll() {
  const activeId = cart$.activeItemId.get();
  const processed = selectProcessedSet();
  const toLegacy = (it: CartItem): LegacyBulkItem => ({
    id: it.id,
    photos: it.photos,
    title: it.title,
    isActive: it.id === activeId,
    preSelectedSource: it.preSelectedSource,
    quantity: it.quantity,
  });
  const cartTree: CartTreeNode[] = [];
  for (const e of selectTopLevelEntries()) {
    if (isFolder(e)) {
      const children = selectFolderChildren(e.id)
        .filter((c) => !processed.has(c.id))
        .map(toLegacy);
      cartTree.push({ kind: 'folder', id: e.id, label: e.label, status: e.status, sourcePhotoUri: e.sourcePhotoUri, childCount: children.length, children });
    } else if (!processed.has(e.id)) {
      cartTree.push({ kind: 'single', item: toLegacy(e as CartItem) });
    }
  }
  return {
    bulkItems: selectLegacyBulkItems(),
    cartTree,
    activeItemId: activeId,
    quickScanStore: selectLegacyQuickScanStore(),
    confirmedQuickMatchByItemId: selectLegacyConfirmed(),
    itemStageById: cart$.itemStageById.get() as StageMap,
    processedItemIds: cart$.processedItemIds.get(),
    savedForLaterIds: cart$.savedForLaterIds.get(),
  };
}

export function useBulkItems(getInitial: () => BulkItemsInitial): UseBulkItems {
  // Seed cart$ from the screen's initial legacy state once, then snapshot.
  const [snapshot, setSnapshot] = useState(() => {
    seedCartFromLegacy(getInitial());
    return deriveAll();
  });

  // Re-derive whenever cart$ changes (mutations from this screen or background events).
  useEffect(() => cart$.onChange(() => setSnapshot(deriveAll())), []);

  const setBulkItems = useCallback((arg: SetState<LegacyBulkItem[]>) => {
    const prev = selectLegacyBulkItems();
    reconcileBulkItems(prev, resolve(arg, prev));
  }, []);

  const setActiveItemId = useCallback((arg: SetState<string | null>) => {
    cart$.activeItemId.set(resolve(arg, cart$.activeItemId.get()) ?? null);
  }, []);

  const setQuickScanStore = useCallback((arg: SetState<QuickScanStore>) => {
    const prev = selectLegacyQuickScanStore();
    reconcileQuickScanStore(prev, resolve(arg, prev));
  }, []);

  const setConfirmedQuickMatchByItemId = useCallback((arg: SetState<ConfirmedMap>) => {
    const prev = selectLegacyConfirmed();
    reconcileConfirmed(prev, resolve(arg, prev));
  }, []);

  const setItemStageById = useCallback((arg: SetState<StageMap>) => {
    cart$.itemStageById.set(resolve(arg, cart$.itemStageById.get() as StageMap));
  }, []);

  const setProcessedItemIds = useCallback((arg: SetState<string[]>) => {
    cart$.processedItemIds.set(resolve(arg, cart$.processedItemIds.get()));
  }, []);

  const createShelfFolder = useCallback((input: ShelfFolderInput) => createFolderFromShelf(input), []);
  const ungroupFolder = useCallback((folderId: string) => storeUngroupFolder(folderId), []);

  return {
    bulkItems: snapshot.bulkItems,
    setBulkItems,
    activeItemId: snapshot.activeItemId,
    setActiveItemId,
    quickScanStore: snapshot.quickScanStore,
    setQuickScanStore,
    confirmedQuickMatchByItemId: snapshot.confirmedQuickMatchByItemId,
    setConfirmedQuickMatchByItemId,
    itemStageById: snapshot.itemStageById,
    setItemStageById,
    processedItemIds: snapshot.processedItemIds,
    setProcessedItemIds,
    cartTree: snapshot.cartTree,
    createShelfFolder,
    ungroupFolder,
    savedForLaterIds: snapshot.savedForLaterIds,
    setItemSavedForLater: storeSetItemSavedForLater,
  };
}
