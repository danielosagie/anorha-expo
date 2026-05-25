// Shared types for the AddProduct feature (extracted from AddProductScreen.tsx).
// NOTE: AddProductScreen.tsx still has local copies of several of these (structurally
// compatible). Consolidating to this single source is a cleanup follow-up.
import { QuickScanPhase } from '../../lib/quickScanStream';

export type CameraMode = 'camera' | 'barcode' | 'manifest' | 'receipt' | 'shelf';

export type UnicodeSpinnerDefinition = {
  frames: string[];
  interval: number;
};

export interface MatchCandidate {
  id: string;
  title: string;
  description: string;
  price: number;
  imageUrl: string;
  matchPercentage: number;
  sourceUrl: string;
  productId?: string;
  variantId?: string;
  productUrl?: string;
  isLocalMatch?: boolean;
  queryKey?: string;
  estimatedShippingMin?: number;
  estimatedShippingMax?: number;
  estimatedShippingMidpoint?: number;
  estimatedShippingLabel?: string;
  pricingResearch?: any;
}

export interface MatchResponse {
  systemAction: 'show_single_match' | 'show_multiple_matches' | 'show_multiple_candidates' | 'fallback_to_manual';
  confidence: 'high' | 'medium' | 'low';
  rankedCandidates: MatchCandidate[];
  totalMatches: number;
  reranker?: {
    type: 'llama4-groq' | 'jina-modal' | 'fast-text' | 'none';
    rankingMethod?: 'exact_match' | 'semantic_similarity' | 'fuzzy_match' | 'vector_fallback';
    confidence?: number;
    reasoning?: string;
    processingTimeMs?: number;
    alternatives?: any[];
  };
}

export interface JobResponse {
  jobId: string;
  status: string;
  estimatedTimeMinutes: number;
  totalProducts: number;
  message: string;
}

export type QuickMatchSelection = {
  serpApiData: any[];
  preSelectedIndices: number[];
  source?: 'quick_scan_auto' | 'quick_scan_confirmed';
  confidence?: number;
  reasoning?: string;
};

export type ItemLoadingState = {
  isLoading: boolean;
  stage: string;
  error?: string;
};

export type CameraInstruction =
  | 'ready'
  | 'move_closer'
  | 'move_back'
  | 'add_light'
  | 'focus'
  | 'processing'
  | 'matches_found'
  | 'no_matches'
  | 'barcode_scanned'
  | 'analyzing'
  | 'extracting'
  | 'optimizing'
  | 'searching'
  | 'capturing'
  | 'recognizing'
  | 'matched'
  | 'needs_review';

export type ShelfProgressStatus = 'idle' | 'streaming' | 'completed' | 'no_items' | 'timeout' | 'error';

export type ShelfProgressState = {
  phase: QuickScanPhase;
  progress: number;
  elapsedMs: number;
  totalItems: number;
  completedItems: number;
  stalled: boolean;
  status: ShelfProgressStatus;
  reasonCode?: string;
  message?: string;
};
