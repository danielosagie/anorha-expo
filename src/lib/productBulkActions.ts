export type ProductBulkArchiveActionType = 'archive' | 'delete';

export interface ProductBulkActionResult {
  itemId: string;
  success: boolean;
  error?: string;
}

export interface ProductBulkActionResponse {
  status: 'completed';
  total: number;
  successful: number;
  failed: number;
  results: ProductBulkActionResult[];
}

export function buildProductBulkArchiveActions(
  ids: string[],
  actionType: ProductBulkArchiveActionType,
) {
  return ids.map((itemId) => ({ itemId, actionType, changes: [] as never[] }));
}

/** Treat a missing/malformed per-item receipt as a failure, never as success. */
export function getProductBulkActionFailures(
  ids: string[],
  response: ProductBulkActionResponse,
): ProductBulkActionResult[] {
  const resultsById = new Map(
    (Array.isArray(response?.results) ? response.results : []).map((result) => [result.itemId, result]),
  );
  return ids.flatMap((itemId) => {
    const result = resultsById.get(itemId);
    if (result?.success === true) return [];
    return [{
      itemId,
      success: false,
      error: result?.error || 'Server did not return a successful receipt for this item',
    }];
  });
}
