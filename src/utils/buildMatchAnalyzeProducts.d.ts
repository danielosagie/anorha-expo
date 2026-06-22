export function buildMatchAnalyzeProducts(
  publicImageUrls: string[],
  itemsForAnalyze?: Array<{ id: string }>,
  quickMatchHintsByItemId?: Record<string, {
    matchRows: any[];
    preSelectedIndices: number[];
    source?: 'quick_scan_auto' | 'quick_scan_confirmed';
    confidence?: number;
    reasoning?: string;
  }>,
): Array<{
  productIndex: number;
  images: Array<{ url: string }>;
  quickMatchHint?: {
    source: 'quick_scan_auto' | 'quick_scan_confirmed';
    selectedIndex: number;
    candidates: any[];
    confidence?: number;
    reasoning?: string;
  };
}>;
