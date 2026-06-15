/**
 * useJobsState - Centralized state management for multi-item job flows
 * 
 * Manages the state of items as they progress through:
 * Scan → Match → Generate → Details
 * 
 * Used by LoadingScreen, MatchSelectionScreen, and GenerateDetailsScreen
 * to maintain consistent state across the workflow.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchGenerateJobStatus } from '../lib/generateJobs';
import { createLogger } from '../utils/logger';
const log = createLogger('useJobsState');


// Step status types
export type StepStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'skipped';

// Individual item state in the job flow
export interface ItemJobState {
    index: number;
    title: string;
    thumb?: string;
    productId?: string;
    variantId?: string;
    matchJobId?: string; // The match job ID for this specific item

    // Scan step (photo capture - typically completed before this hook is used)
    scan: {
        status: StepStatus;
        photos: string[];
    };

    // Match step (SerpAPI lookup + reranking)
    match: {
        status: StepStatus;
        jobId?: string;
        matchesCount: number;
        progress?: number; // 0-100
        currentStage?: string;
        selectedIndices?: number[];
        serpApiData?: any[];
        vlmAnalysis?: {
            confidence: number;
            ocrText: string;
            brand: string;
            model: string;
            type: string;
            paraphrases: string[];
        };
    };

    // Generate step (AI listing generation)
    generate: {
        status: StepStatus;
        jobId?: string;
        progress?: number;
        currentStage?: string;
        platforms?: string[];
    };

    // Details step (review/edit generated content)
    details: {
        status: StepStatus;
        hasData: boolean;
        isPublished: boolean;
    };
}

// Initial params that can be passed to the hook
export interface JobsStateInitParams {
    matchJobId?: string;
    items?: Array<{
        index: number;
        title?: string;
        thumb?: string;
        matchesCount?: number;
        matchJobId?: string;
        productId?: string;
        variantId?: string;
    }>;
    jobMap?: Record<number, { jobId: string; status?: string }>;
    userImagesByIndex?: Record<number, string[]>;
}

// Return type for the hook
export interface UseJobsStateReturn {
    items: ItemJobState[];
    currentIndex: number;
    setCurrentIndex: (index: number) => void;

    // Update functions
    updateItemMatch: (index: number, update: Partial<ItemJobState['match']>) => void;
    updateItemGenerate: (index: number, update: Partial<ItemJobState['generate']>) => void;
    updateItemDetails: (index: number, update: Partial<ItemJobState['details']>) => void;

    // Bulk operations
    setSelectedMatches: (index: number, selectedIndices: number[]) => void;
    startGenerate: (index: number, jobId: string) => void;
    markGenerateComplete: (index: number) => void;
    markGenerateFailed: (index: number) => void;

    // Status helpers
    getStepColor: (index: number, step: 'scan' | 'match' | 'generate' | 'details') => string;
    isStepEnabled: (index: number, step: 'scan' | 'match' | 'generate' | 'details') => boolean;

    // Polling control
    startPolling: () => void;
    stopPolling: () => void;
}

const STORAGE_KEY = 'jobsState';

// Status color mapping
const STATUS_COLORS: Record<StepStatus, string> = {
    pending: '#4B5563',    // Dark gray
    queued: '#FFD700',     // Yellow
    processing: '#FFD700', // Yellow (animated)
    completed: '#10B981',  // Green
    failed: '#EF4444',     // Red
    skipped: '#9CA3AF',    // Light gray
};

/**
 * Convert initial params or existing data to ItemJobState array
 */
function initializeItems(params: JobsStateInitParams): ItemJobState[] {
    const { items = [], jobMap = {}, userImagesByIndex = {} } = params;

    if (items.length === 0) {
        // Return a single default item if nothing provided
        return [{
            index: 0,
            title: 'Item 1',
            scan: { status: 'completed', photos: [] },
            match: { status: 'pending', matchesCount: 0 },
            generate: { status: 'pending' },
            details: { status: 'pending', hasData: false, isPublished: false },
        }];
    }

    return items.map((item, i) => {
        const idx = item.index ?? i;
        const photos = userImagesByIndex[idx] || [];
        const genJob = jobMap[idx];

        // Derive statuses from existing data
        const hasPhotos = photos.length > 0;
        const hasMatches = (item.matchesCount ?? 0) > 0;
        const hasGenJob = !!genJob?.jobId;
        const genStatus = genJob?.status;

        return {
            index: idx,
            title: item.title || `Item ${idx + 1}`,
            thumb: item.thumb,
            productId: item.productId,
            variantId: item.variantId,
            matchJobId: item.matchJobId,

            scan: {
                status: hasPhotos ? 'completed' : 'pending',
                photos,
            },

            match: {
                status: hasMatches ? 'completed' : 'pending',
                matchesCount: item.matchesCount ?? 0,
                jobId: params.matchJobId,
            },

            generate: {
                status: genStatus === 'completed' ? 'completed'
                    : genStatus === 'failed' ? 'failed'
                        : hasGenJob ? 'processing'
                            : 'pending',
                jobId: genJob?.jobId,
            },

            details: {
                status: genStatus === 'completed' ? 'completed' : 'pending',
                hasData: genStatus === 'completed',
                isPublished: false,
            },
        };
    });
}

/**
 * Main hook for managing job state across screens
 */
export function useJobsState(initParams?: JobsStateInitParams): UseJobsStateReturn {
    const [items, setItems] = useState<ItemJobState[]>(() =>
        initializeItems(initParams || {})
    );
    const [currentIndex, setCurrentIndex] = useState(0);
    const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isPollingRef = useRef(false);

    // Reinitialize when params change significantly
    useEffect(() => {
        if (initParams?.items && initParams.items.length > 0) {
            const newItems = initializeItems(initParams);
            setItems(prev => {
                // Merge new items with existing state to preserve user selections
                return newItems.map((newItem, i) => {
                    const existing = prev.find(p => p.index === newItem.index);
                    if (existing) {
                        return {
                            ...newItem,
                            match: { ...newItem.match, selectedIndices: existing.match.selectedIndices },
                        };
                    }
                    return newItem;
                });
            });
        }
    }, [initParams?.matchJobId, initParams?.items?.length]);

    // Update functions
    const updateItemMatch = useCallback((index: number, update: Partial<ItemJobState['match']>) => {
        setItems(prev => prev.map(item =>
            item.index === index
                ? { ...item, match: { ...item.match, ...update } }
                : item
        ));
    }, []);

    const updateItemGenerate = useCallback((index: number, update: Partial<ItemJobState['generate']>) => {
        setItems(prev => prev.map(item =>
            item.index === index
                ? { ...item, generate: { ...item.generate, ...update } }
                : item
        ));
    }, []);

    const updateItemDetails = useCallback((index: number, update: Partial<ItemJobState['details']>) => {
        setItems(prev => prev.map(item =>
            item.index === index
                ? { ...item, details: { ...item.details, ...update } }
                : item
        ));
    }, []);

    const setSelectedMatches = useCallback((index: number, selectedIndices: number[]) => {
        updateItemMatch(index, { selectedIndices });
    }, [updateItemMatch]);

    const startGenerate = useCallback((index: number, jobId: string) => {
        updateItemGenerate(index, { status: 'processing', jobId });
    }, [updateItemGenerate]);

    const markGenerateComplete = useCallback((index: number) => {
        updateItemGenerate(index, { status: 'completed' });
        updateItemDetails(index, { status: 'completed', hasData: true });
    }, [updateItemGenerate, updateItemDetails]);

    const markGenerateFailed = useCallback((index: number) => {
        updateItemGenerate(index, { status: 'failed' });
    }, [updateItemGenerate]);

    // Status helpers
    const getStepColor = useCallback((index: number, step: 'scan' | 'match' | 'generate' | 'details'): string => {
        const item = items.find(i => i.index === index);
        if (!item) return STATUS_COLORS.pending;

        const status = item[step].status;
        return STATUS_COLORS[status] || STATUS_COLORS.pending;
    }, [items]);

    const isStepEnabled = useCallback((index: number, step: 'scan' | 'match' | 'generate' | 'details'): boolean => {
        const item = items.find(i => i.index === index);
        if (!item) return false;

        switch (step) {
            case 'scan':
                return true; // Can always access scan
            case 'match':
                return item.scan.status === 'completed';
            case 'generate':
                return item.match.status === 'completed';
            case 'details':
                return item.generate.status === 'completed';
            default:
                return false;
        }
    }, [items]);

    // Polling for generate job statuses
    const pollGenerateJobs = useCallback(async () => {
        const processingItems = items.filter(item =>
            item.generate.status === 'processing' && item.generate.jobId
        );

        if (processingItems.length === 0) return;

        for (const item of processingItems) {
            try {
                const status = await fetchGenerateJobStatus(item.generate.jobId!);
                if (!status) continue;

                if (status.status === 'completed') {
                    markGenerateComplete(item.index);
                } else if (status.status === 'failed') {
                    markGenerateFailed(item.index);
                } else {
                    updateItemGenerate(item.index, {
                        currentStage: status.currentStage,
                        progress: status.progress,
                    });
                }
            } catch (e) {
                log.warn(`[useJobsState] Failed to poll job ${item.generate.jobId}:`, e);
            }
        }
    }, [items, markGenerateComplete, markGenerateFailed, updateItemGenerate]);

    const startPolling = useCallback(() => {
        if (isPollingRef.current) return;
        isPollingRef.current = true;

        const poll = () => {
            pollGenerateJobs();
            pollingRef.current = setTimeout(poll, 2000);
        };

        poll();
    }, [pollGenerateJobs]);

    const stopPolling = useCallback(() => {
        isPollingRef.current = false;
        if (pollingRef.current) {
            clearTimeout(pollingRef.current);
            pollingRef.current = null;
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => stopPolling();
    }, [stopPolling]);

    // Auto-start polling if there are processing jobs
    useEffect(() => {
        const hasProcessing = items.some(item => item.generate.status === 'processing');
        if (hasProcessing) {
            startPolling();
        } else {
            stopPolling();
        }
    }, [items, startPolling, stopPolling]);

    return {
        items,
        currentIndex,
        setCurrentIndex,
        updateItemMatch,
        updateItemGenerate,
        updateItemDetails,
        setSelectedMatches,
        startGenerate,
        markGenerateComplete,
        markGenerateFailed,
        getStepColor,
        isStepEnabled,
        startPolling,
        stopPolling,
    };
}

export default useJobsState;
