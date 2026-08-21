export type MatchConfidence = 'high' | 'medium' | 'low';

export type MatchSelectionSource =
  | 'quick_scan_lock'
  | 'quick_scan_seed'
  | 'smart_picker'
  | 'text_rank'
  | 'text_visual_synthesis'
  | 'fallback';

const MATCH_LABELS: Record<MatchConfidence, string> = {
  high: 'High match',
  medium: 'Medium match',
  low: 'Low match',
};

export const getMatchConfidenceLabel = (
  confidence: MatchConfidence,
  selectedBy?: MatchSelectionSource,
): string => confidence === 'low' && selectedBy === 'fallback'
  ? 'Unverified'
  : MATCH_LABELS[confidence];
