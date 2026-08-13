import type {
  CartDraftPayload,
  CartEntry,
  CartFolder,
  CartItem,
  CartState,
  CartStatus,
  ItemStage,
  ShelfItemBox,
} from './types';

const FOLDERS_KEY = '__folders';

const isItem = (entry: CartEntry | undefined): entry is CartItem => entry?.kind === 'single';
const isFolder = (entry: CartEntry | undefined): entry is CartFolder => entry?.kind === 'folder';

function normalizeHydratedShelfBox(value: unknown): ShelfItemBox | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const box = value as Record<string, unknown>;
  const numberField = (key: string): number | undefined => {
    const candidate = box[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
  };

  let x = numberField('x');
  let y = numberField('y');
  let width = numberField('width');
  let height = numberField('height');
  const sourceWidth = numberField('sourceWidth');
  const sourceHeight = numberField('sourceHeight');
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;

  if ((x > 1 || width > 1) && sourceWidth !== undefined && sourceWidth > 0) {
    x /= sourceWidth;
    width /= sourceWidth;
  }
  if ((y > 1 || height > 1) && sourceHeight !== undefined && sourceHeight > 0) {
    y /= sourceHeight;
    height /= sourceHeight;
  }
  if (x < 0 || y < 0 || x >= 1 || y >= 1 || width <= 0 || height <= 0) return undefined;

  const normalizedWidth = Math.min(width, 1 - x);
  const normalizedHeight = Math.min(height, 1 - y);
  if (normalizedWidth <= 0 || normalizedHeight <= 0) return undefined;

  return {
    x,
    y,
    width: normalizedWidth,
    height: normalizedHeight,
    ...(sourceWidth !== undefined && sourceWidth > 0 ? { sourceWidth } : {}),
    ...(sourceHeight !== undefined && sourceHeight > 0 ? { sourceHeight } : {}),
  };
}

function statusFromStage(stage: ItemStage | undefined): CartStatus | undefined {
  switch (stage) {
    case 'submitted_for_match': return 'searching';
    case 'awaiting_user_input': return 'needs_context';
    case 'generating': return 'generating';
    case 'generated': return 'ready_to_list';
    case 'existing_inventory': return 'matched';
    default: return undefined;
  }
}

function allItems(state: CartState): CartItem[] {
  return Object.values(state.entries).filter(isItem);
}

function orderedItems(state: CartState): CartItem[] {
  const seen = new Set<string>();
  const items: CartItem[] = [];
  for (const id of state.order) {
    const entry = state.entries[id];
    if (isItem(entry)) {
      seen.add(entry.id);
      items.push(entry);
    } else if (isFolder(entry)) {
      for (const childId of entry.childIds) {
        const child = state.entries[childId];
        if (isItem(child) && !seen.has(child.id)) {
          seen.add(child.id);
          items.push(child);
        }
      }
    }
  }
  for (const item of allItems(state)) {
    if (!seen.has(item.id)) items.push(item);
  }
  return items;
}

export function serializeCartStateToDraft(
  state: CartState,
  extra?: { shelfPhotoUri?: string | null },
): CartDraftPayload {
  const processed = new Set(state.processedItemIds);
  const savedForLaterIds = state.savedForLaterIds.filter((id) => !!state.entries[id]);
  const savedSet = new Set(savedForLaterIds);
  const savedFolderChildIds = new Set(
    savedForLaterIds.flatMap((id) => {
      const entry = state.entries[id];
      return isFolder(entry) ? entry.childIds : [];
    }),
  );
  const items = allItems(state).filter((item) => (
    !processed.has(item.id)
    || savedSet.has(item.id)
    || savedFolderChildIds.has(item.id)
    || !!item.generateJobId
    || !!item.generateMatchJobId
    || !!item.productId
    || !!item.variantId
  ));

  const scannedItems = items.map((item) => ({
    id: item.id,
    photos: item.photos,
    title: item.title,
    isActive: state.activeItemId === item.id,
    preSelectedSource: item.preSelectedSource,
    quantity: item.quantity,
    parentId: item.parentId ?? null,
    shelfBox: item.shelfBox,
    status: item.status,
    generateJobId: item.generateJobId,
    generateMatchJobId: item.generateMatchJobId,
    productId: item.productId,
    variantId: item.variantId,
  }));

  const matchContext: Record<string, any> = {};
  for (const item of items) {
    if (item.match?.response || item.match?.matchRows || item.match?.confirmed || item.pricing) {
      matchContext[item.id] = {
        matchData: item.match?.response,
        matchRows: item.match?.matchRows ?? [],
        confirmed: item.match?.confirmed,
        pricing: item.pricing,
      };
    }
  }
  matchContext[FOLDERS_KEY] = state.order
    .map((id) => state.entries[id])
    .filter(isFolder)
    .map((folder) => ({
      id: folder.id,
      label: folder.label,
      sourcePhotoUri: folder.sourcePhotoUri,
      childIds: folder.childIds,
    }));

  return {
    scannedItems,
    matchContext,
    itemStageById: { ...state.itemStageById },
    processedItemIds: [...state.processedItemIds],
    savedForLaterIds,
    shelfPhotoUri: extra?.shelfPhotoUri ?? null,
    activeItemId: state.activeItemId,
  };
}

export function hydrateCartStateFromDraft(
  payload: CartDraftPayload,
  timestamp = Date.now(),
): CartState {
  const scanned = Array.isArray(payload.scannedItems) ? payload.scannedItems : [];
  const matchContext = payload.matchContext ?? {};
  const folders: Array<{ id: string; label?: string; sourcePhotoUri?: string; childIds: string[] }> =
    Array.isArray(matchContext[FOLDERS_KEY]) ? matchContext[FOLDERS_KEY] : [];
  const entries: Record<string, CartEntry> = {};
  const childIdSet = new Set<string>(folders.flatMap((folder) => folder.childIds));

  for (const scannedItem of scanned) {
    if (!scannedItem?.id) continue;
    const context = matchContext[scannedItem.id];
    const photos = Array.isArray(scannedItem.photos) ? scannedItem.photos : [];
    const stageStatus = statusFromStage(payload.itemStageById?.[scannedItem.id]);
    const persistedStatus = typeof scannedItem.status === 'string' ? scannedItem.status as CartStatus : undefined;
    entries[scannedItem.id] = {
      kind: 'single',
      id: scannedItem.id,
      parentId: scannedItem.parentId ?? null,
      photos,
      title: scannedItem.title,
      quantity: typeof scannedItem.quantity === 'number' ? scannedItem.quantity : 1,
      status: stageStatus
        ?? persistedStatus
        ?? (context ? 'matched' : photos.length ? 'searching' : 'capturing'),
      match: context
        ? { response: context.matchData, matchRows: context.matchRows, confirmed: context.confirmed }
        : undefined,
      pricing: context?.pricing,
      preSelectedSource: scannedItem.preSelectedSource,
      shelfBox: normalizeHydratedShelfBox(scannedItem.shelfBox),
      generateJobId: typeof scannedItem.generateJobId === 'string' ? scannedItem.generateJobId : undefined,
      generateMatchJobId: typeof scannedItem.generateMatchJobId === 'string' ? scannedItem.generateMatchJobId : undefined,
      productId: typeof scannedItem.productId === 'string' ? scannedItem.productId : undefined,
      variantId: typeof scannedItem.variantId === 'string' ? scannedItem.variantId : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  for (const folder of folders) {
    entries[folder.id] = {
      kind: 'folder',
      id: folder.id,
      label: folder.label,
      sourcePhotoUri: folder.sourcePhotoUri,
      childIds: folder.childIds.filter((childId) => !!entries[childId]),
      status: 'scanning',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  const order: string[] = [];
  for (const folder of folders) if (entries[folder.id]) order.push(folder.id);
  for (const scannedItem of scanned) {
    if (scannedItem?.id && !childIdSet.has(scannedItem.id) && entries[scannedItem.id]) {
      order.push(scannedItem.id);
    }
  }

  return {
    entries,
    order,
    activeItemId: payload.activeItemId ?? null,
    processedItemIds: Array.isArray(payload.processedItemIds) ? payload.processedItemIds : [],
    itemStageById: payload.itemStageById ?? {},
    savedForLaterIds: Array.isArray(payload.savedForLaterIds)
      ? payload.savedForLaterIds.filter((id) => !!entries[id])
      : [],
  };
}

function resultHasContent(result: any): boolean {
  if (!result || typeof result !== 'object') return false;
  if (result.draftReady === true) return true;
  return Object.values(result.platforms || {}).some((platform) => (
    platform && typeof platform === 'object' && Object.keys(platform).length > 0
  ));
}

function resultForItem(item: CartItem, results: any[], fallbackIndex: number): any | undefined {
  return results.find((result) => item.variantId && result?.variantId === item.variantId)
    ?? results.find((result) => item.productId && result?.productId === item.productId)
    ?? [...results].sort((a, b) => Number(a?.productIndex ?? 0) - Number(b?.productIndex ?? 0))[fallbackIndex];
}

export interface CartRecoveryLoaders {
  fetchGenerateStatus: (jobId: string) => Promise<any | null>;
  fetchCanonicalItem: (variantId: string) => Promise<Record<string, any> | null>;
  fetchMatchStatus?: (jobId: string) => Promise<any | null>;
}

export async function recoverHydratedCartState(
  state: CartState,
  loaders: CartRecoveryLoaders,
  timestamp = Date.now(),
): Promise<CartState> {
  const next: CartState = {
    ...state,
    entries: Object.fromEntries(Object.entries(state.entries).map(([id, entry]) => [id, { ...entry }])),
    itemStageById: { ...state.itemStageById },
  };
  const items = orderedItems(next);

  if (loaders.fetchMatchStatus) {
    const matchGroups = new Map<string, CartItem[]>();
    for (const item of items) {
      if (!item.generateJobId && item.generateMatchJobId) {
        const group = matchGroups.get(item.generateMatchJobId) || [];
        group.push(item);
        matchGroups.set(item.generateMatchJobId, group);
      }
    }
    await Promise.all([...matchGroups.entries()].map(async ([jobId, group]) => {
      const status = await loaders.fetchMatchStatus?.(jobId);
      const results = Array.isArray(status?.results) ? status.results : [];
      group.forEach((item, index) => {
        const result = results[index];
        const generateJobId = result?.autoGenerateJobId;
        if (typeof generateJobId === 'string' && generateJobId) item.generateJobId = generateJobId;
      });
    }));
  }

  const generateGroups = new Map<string, CartItem[]>();
  for (const item of items) {
    if (!item.generateJobId) continue;
    const group = generateGroups.get(item.generateJobId) || [];
    group.push(item);
    generateGroups.set(item.generateJobId, group);
  }

  await Promise.all([...generateGroups.entries()].map(async ([jobId, group]) => {
    const status = await loaders.fetchGenerateStatus(jobId);
    const results = Array.isArray(status?.results) ? status.results : [];
    await Promise.all(group.map(async (item, index) => {
      const result = resultForItem(item, results, index);
      if (result) {
        item.generateResult = result;
        if (typeof result.productId === 'string') item.productId = result.productId;
        if (typeof result.variantId === 'string') item.variantId = result.variantId;
      }
      if (item.variantId) {
        const canonicalItem = await loaders.fetchCanonicalItem(item.variantId);
        if (canonicalItem) {
          item.canonicalItem = canonicalItem;
          if (Object.prototype.hasOwnProperty.call(canonicalItem, 'Title')) {
            item.title = canonicalItem.Title == null ? undefined : String(canonicalItem.Title);
          }
          if (Object.prototype.hasOwnProperty.call(canonicalItem, 'Price')) {
            item.pricing = { recommended: canonicalItem.Price };
          }
          if (typeof canonicalItem.ProductId === 'string') item.productId = canonicalItem.ProductId;
          if (typeof canonicalItem.Id === 'string') item.variantId = canonicalItem.Id;
        }
      }

      if (resultHasContent(result)) {
        item.status = 'ready_to_list';
        next.itemStageById[item.id] = 'generated';
      } else if (status?.status === 'failed' || status?.status === 'cancelled') {
        item.status = 'error';
        item.error = status.error || 'Generation failed';
      } else if (status) {
        item.status = 'generating';
        next.itemStageById[item.id] = 'generating';
      }
      item.updatedAt = timestamp;
    }));
  }));

  const canonicalOnly = items.filter((item) => !item.generateJobId && item.variantId);
  await Promise.all(canonicalOnly.map(async (item) => {
    const canonicalItem = await loaders.fetchCanonicalItem(item.variantId!);
    if (!canonicalItem) return;
    item.canonicalItem = canonicalItem;
    if (Object.prototype.hasOwnProperty.call(canonicalItem, 'Title')) {
      item.title = canonicalItem.Title == null ? undefined : String(canonicalItem.Title);
    }
    item.updatedAt = timestamp;
  }));

  return next;
}

export const hasReviewableGenerateResult = (item: CartItem | undefined): boolean =>
  !!item?.generateResult && resultHasContent(item.generateResult);
