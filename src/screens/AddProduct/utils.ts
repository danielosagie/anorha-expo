// Shared helpers for the AddProduct feature (extracted from AddProductScreen.tsx).
// NOTE: AddProductScreen.tsx still has a local copy of getShelfProgressPresentation
// (structurally compatible). Consolidating to this single source is a cleanup follow-up.
import { ShelfProgressState, CameraInstruction } from './types';

// Strip "scanned product/item" prefixes and dataset/quick_scan suffixes from match titles.
export const cleanMatchText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/^(scanned product|scanned item|product scan)[:\s-]*/i, '')
    .replace(/\s*\((quick_scan|.*dataset|custom_.*)\)/gi, '')
    .trim();
};

// Map a shelf-scan progress state to user-facing title/subtitle/instruction.
export const getShelfProgressPresentation = (progress: ShelfProgressState) => {
  if (progress.status === 'no_items') {
    return {
      title: 'No items detected',
      subtitle: progress.message || 'Try a tighter photo with clearer package labels.',
      instruction: 'ready' as CameraInstruction,
    };
  }

  if (progress.status === 'timeout') {
    return {
      title: 'Scan took too long',
      subtitle: progress.message || 'Retry the same photo or take a clearer shelf shot.',
      instruction: 'ready' as CameraInstruction,
    };
  }

  if (progress.status === 'error') {
    if (progress.reasonCode === 'free_tier_exhausted') {
      return {
        title: 'Free scans used up',
        subtitle: 'Upgrade to scan another shelf.',
        instruction: 'ready' as CameraInstruction,
      };
    }

    return {
      title: 'Scan hit a snag',
      subtitle: progress.message || 'The shelf stream stopped before results came back.',
      instruction: 'ready' as CameraInstruction,
    };
  }

  switch (progress.phase) {
    case 'separating_items':
      return {
        title: 'Separating items',
        subtitle: 'Breaking the shelf into distinct packages before matching.',
        instruction: 'extracting' as CameraInstruction,
      };
    case 'reading_labels':
      return {
        title: 'Reading labels',
        subtitle: 'Pulling brand names, model numbers, and search terms.',
        instruction: 'optimizing' as CameraInstruction,
      };
    case 'searching_matches':
      return {
        title: progress.completedItems > 0 ? `${progress.completedItems} found` : 'Finding items…',
        subtitle: 'Items appear as found.',
        instruction: 'searching' as CameraInstruction,
      };
    case 'finishing':
      return {
        title: progress.completedItems > 0 ? `${progress.completedItems} found` : 'Finding items…',
        subtitle: 'Finishing scan.',
        instruction: 'searching' as CameraInstruction,
      };
    case 'inspecting_shelf':
    default:
      return {
        title: 'Inspecting shelf',
        subtitle: 'Looking for item boundaries, label clusters, and readable packages.',
        instruction: 'analyzing' as CameraInstruction,
      };
  }
};
