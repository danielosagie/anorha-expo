import { useState, useEffect } from 'react';
import { ensureSupabaseJwt } from '../lib/supabase';

interface DraftData {
  // Define draft structure
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

  const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'http://localhost:3000';

  const getToken = async () => {
    // Implement token retrieval
    return await ensureSupabaseJwt(); // Assume this is available
  };

  const saveDraft = async (data: DraftData) => {
    try {
      const token = await getToken();
      const response = await fetch(`${baseUrl}/api/products/drafts/${variantId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ draftData: data }),
      });

      if (!response.ok) {
        throw new Error('Failed to save draft');
      }
    } catch (error) {
      console.error('Save draft error:', error);
      throw error;
    }
  };

  const loadDraft = async () => {
    setIsLoadingDraft(true);
    try {
      const token = await getToken();
      const response = await fetch(`${baseUrl}/api/products/drafts/${variantId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setDraftData(data.draftData);
      } else if (response.status === 404) {
        setDraftData(null);
      }
    } catch (error) {
      console.error('Load draft error:', error);
      setDraftData(null);
    } finally {
      setIsLoadingDraft(false);
    }
  };

  const publishDraft = async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${baseUrl}/api/products/${variantId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ ...draftData, publish: true }),
      });

      if (!response.ok) {
        throw new Error('Failed to publish draft');
      }

      setDraftData(null);
    } catch (error) {
      console.error('Publish draft error:', error);
      throw error;
    }
  };

  const discardDraft = async () => {
    try {
      const token = await getToken();
      await fetch(`${baseUrl}/api/products/drafts/${variantId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      setDraftData(null);
    } catch (error) {
      console.error('Discard draft error:', error);
    }
  };

  useEffect(() => {
    loadDraft();
  }, [variantId]);

  return {
    draftData,
    isLoadingDraft,
    saveDraft,
    loadDraft,
    publishDraft,
    discardDraft,
  };
};


