import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../lib/apiClient';

interface DraftData {
  [key: string]: any;
}

interface UseProductDraftReturn {
  draftData: DraftData | null;
  isLoadingDraft: boolean;
  saveDraft: (data: DraftData) => Promise<void>;
  loadDraft: () => Promise<void>;
  publishDraft: () => Promise<void>;
  discardDraft: () => Promise<void>;
}

export const useProductDraft = (variantId: string): UseProductDraftReturn => {
  const [draftData, setDraftData] = useState<DraftData | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);

  const saveDraft = useCallback(
    async (data: DraftData) => {
      await api.post(`/api/products/drafts/${variantId}`, { draftData: data });
    },
    [variantId],
  );

  const loadDraft = useCallback(async () => {
    setIsLoadingDraft(true);
    try {
      const data = await api.get<{ draftData: DraftData }>(
        `/api/products/drafts/${variantId}`,
      );
      setDraftData(data.draftData);
    } catch (error) {
      // A missing draft is an expected, non-error state.
      if (!(error instanceof ApiError && error.status === 404)) {
        console.error('Load draft error:', error);
      }
      setDraftData(null);
    } finally {
      setIsLoadingDraft(false);
    }
  }, [variantId]);

  const publishDraft = useCallback(async () => {
    await api.put(`/api/products/${variantId}`, { ...draftData, publish: true });
    setDraftData(null);
  }, [variantId, draftData]);

  const discardDraft = useCallback(async () => {
    try {
      await api.delete(`/api/products/drafts/${variantId}`);
    } catch (error) {
      console.error('Discard draft error:', error);
    }
    setDraftData(null);
  }, [variantId]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  return {
    draftData,
    isLoadingDraft,
    saveDraft,
    loadDraft,
    publishDraft,
    discardDraft,
  };
};
