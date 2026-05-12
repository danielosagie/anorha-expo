// Shared types for import session (mapping suggestions, wizard state, etc.)

export interface MappingSuggestion {
  action: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE' | 'UNMATCHED';
  prevAction?: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE' | 'UNMATCHED';
  platformProduct: {
    id: string;
    sku: string;
    title: string;
    price: number;
    imageUrl: string | null;
    parentId?: string | null;
    parentTitle?: string | null;
  };
  suggestedCanonicalProduct: {
    id: string | null;
    sku: string;
    title: string;
    price?: number;
    imageUrl?: string | null;
  } | null;
  anorhaVariant?: {
    id: string;
    sku: string | null;
    title: string | null;
    price?: number;
    barcode?: string | null;
    imageUrl?: string | null;
  } | null;
  direction?: 'platform_to_anorha' | 'anorha_to_platform' | 'bidirectional';
  isSelected: boolean;
  matchType?: 'BARCODE' | 'SKU' | 'TITLE' | 'NONE';
  confidence?: number;
  resolved?: boolean;
  prevTab?: 'all' | 'needs_review' | 'matched' | 'ignored';
  originalData?: any;
}

export type ProductCreationMode = 'sync_everywhere' | 'pull_only' | 'push_only' | 'do_nothing';

export interface ConnectionLocation {
  platformLocationId: string;
  locationName: string;
  timezone?: string;
}

export interface ImportSessionCounts {
  all: number;
  matched: number;
  needs_review: number;
  review: number; // alias for wizard display
  ignored: number;
  ignore: number; // alias for wizard display
  push: number;
  pushTotal: number;
}
