/**
 * JobsContext - Shared state management for multi-item job flows
 * 
 * Provides global state for:
 * - Items in the current match job
 * - Generate job status for each item
 * - Persistence via AsyncStorage
 * - Automatic polling for processing jobs
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';

// Types
export type StepStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface JobItem {
    index: number;
    title: string;
    thumb?: string;
    matchesCount: number;
    matchJobId?: string;
    productId?: string;
    variantId?: string;
}

export interface GenerateJobInfo {
    jobId: string;
    status: StepStatus;
    progress?: number;
    currentStage?: string;
    startedAt?: number;
    completedAt?: number;
}

interface JobsState {
    matchJobId: string | null;
    items: JobItem[];
    generateJobs: Record<number, GenerateJobInfo>;
    lastUpdated: number;
}

interface JobsContextValue {
    // State
    matchJobId: string | null;
    items: JobItem[];
    generateJobs: Record<number, GenerateJobInfo>;

    // Actions
    initializeFromMatchJob: (matchJobId: string, items: JobItem[]) => void;
    initializeFromGenerateJob: (generateJobId: string) => Promise<void>;
    setItems: (items: JobItem[]) => void;
    updateItem: (index: number, update: Partial<JobItem>) => void;

    // Generate job management
    startGenerateJob: (index: number, jobId: string) => void;
    updateGenerateJob: (index: number, update: Partial<GenerateJobInfo>) => void;
    markGenerateComplete: (index: number) => void;
    markGenerateFailed: (index: number) => void;

    // Bulk operations
    getItemsByStatus: (status: StepStatus | 'all') => JobItem[];
    getPendingItems: () => JobItem[];
    getProcessingItems: () => JobItem[];
    getCompletedItems: () => JobItem[];
    getFailedItems: () => JobItem[];

    // Polling
    startPolling: () => void;
    stopPolling: () => void;
    isPolling: boolean;
}

const JobsContext = createContext<JobsContextValue | null>(null);

const STORAGE_PREFIX = 'jobs_state_';
const BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'https://api.sssync.app';

// Provider component
export function JobsProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<JobsState>({
        matchJobId: null,
        items: [],
        generateJobs: {},
        lastUpdated: Date.now(),
    });

    const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isPolling, setIsPolling] = useState(false);

    // Persist state to AsyncStorage
    const persistState = useCallback(async (newState: JobsState) => {
        if (!newState.matchJobId) return;
        try {
            await AsyncStorage.setItem(
                `${STORAGE_PREFIX}${newState.matchJobId}`,
                JSON.stringify(newState)
            );
        } catch (e) {
            console.warn('[JobsContext] Failed to persist state:', e);
        }
    }, []);

    // Load state from AsyncStorage
    const loadState = useCallback(async (matchJobId: string): Promise<JobsState | null> => {
        try {
            const stored = await AsyncStorage.getItem(`${STORAGE_PREFIX}${matchJobId}`);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.warn('[JobsContext] Failed to load state:', e);
        }
        return null;
    }, []);

    // Initialize from a match job - fetches existing generate jobs from DB
    const initializeFromMatchJob = useCallback(async (matchJobId: string, items: JobItem[]) => {
        // Try to load existing state from AsyncStorage first
        const existing = await loadState(matchJobId);

        // Also fetch from database to get generate jobs for this user
        // Since there's no match_job_id FK, we fetch recent completed jobs and match by productIndex
        let dbGenerateJobs: Record<number, GenerateJobInfo> = {};
        try {
            // Get current user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                console.warn('[JobsContext] No user for DB fetch');
            } else {
                const { data: generateJobsData, error } = await supabase
                    .from('generate_jobs')
                    .select('job_id, status, created_at, results')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(20); // Get recent jobs

                if (!error && generateJobsData && generateJobsData.length > 0) {
                    // Get the productIndices from the items we're tracking
                    const itemIndices = new Set(items.map(i => i.index));

                    // Process generate jobs - check if results match our item indices
                    generateJobsData.forEach((job) => {
                        const results = Array.isArray(job.results) ? job.results : [];
                        results.forEach((result: any) => {
                            const productIndex = result?.productIndex;
                            if (typeof productIndex === 'number' && itemIndices.has(productIndex)) {
                                // Only set if we don't already have a newer job for this index
                                if (!dbGenerateJobs[productIndex]) {
                                    dbGenerateJobs[productIndex] = {
                                        jobId: job.job_id,
                                        status: job.status === 'completed' ? 'completed' :
                                            job.status === 'failed' ? 'failed' :
                                                job.status === 'processing' ? 'processing' : 'pending',
                                        startedAt: new Date(job.created_at).getTime(),
                                        completedAt: job.status === 'completed' ? new Date(job.created_at).getTime() : undefined,
                                    };
                                }
                            }
                        });
                    });
                    console.log(`[JobsContext] Loaded ${Object.keys(dbGenerateJobs).length} generate jobs from DB for ${items.length} items`);
                }
            }
        } catch (e) {
            console.warn('[JobsContext] Failed to fetch generate jobs from DB:', e);
        }

        // Merge: DB takes precedence over AsyncStorage, but processing jobs from AsyncStorage are kept
        const mergedGenerateJobs = { ...dbGenerateJobs };
        if (existing?.generateJobs) {
            Object.entries(existing.generateJobs).forEach(([indexStr, job]) => {
                const idx = parseInt(indexStr, 10);
                // Keep AsyncStorage version if it's processing and DB doesn't show complete
                if (job.status === 'processing' || job.status === 'queued') {
                    if (!mergedGenerateJobs[idx] || mergedGenerateJobs[idx].status !== 'completed') {
                        mergedGenerateJobs[idx] = job;
                    }
                }
            });
        }

        if (existing && existing.items.length > 0) {
            // Merge with new items (keep existing generate job status)
            const mergedItems = items.map(item => {
                const existingItem = existing.items.find(e => e.index === item.index);
                return existingItem ? { ...item, ...existingItem } : item;
            });

            setState({
                matchJobId,
                items: mergedItems,
                generateJobs: mergedGenerateJobs,
                lastUpdated: Date.now(),
            });
        } else {
            // Fresh initialization
            setState({
                matchJobId,
                items,
                generateJobs: mergedGenerateJobs,
                lastUpdated: Date.now(),
            });
        }

        // Persist the merged state
        persistState({
            matchJobId,
            items: items,
            generateJobs: mergedGenerateJobs,
            lastUpdated: Date.now(),
        });
    }, [loadState, persistState]);

    // Initialize from a generate job - try to find related match job or just update generate status
    const initializeFromGenerateJob = useCallback(async (generateJobId: string) => {
        try {
            // Fetch the generate job to get its results
            const { data: generateJob, error: genError } = await supabase
                .from('generate_jobs')
                .select('job_id, status, results, user_id')
                .eq('job_id', generateJobId)
                .single();

            if (genError || !generateJob) {
                console.warn('[JobsContext] Could not fetch generate job:', genError);
                return;
            }

            // Check if we already have a matchJobId in context
            // If so, just update the generate job status for items in results
            const existingMatchJobId = state.matchJobId;
            const generateResults = Array.isArray(generateJob.results) ? generateJob.results : [];

            if (existingMatchJobId && state.items.length > 0) {
                // Update generate job status for items in this generate job's results
                generateResults.forEach((result: any) => {
                    const productIndex = result?.productIndex;
                    if (typeof productIndex === 'number') {
                        setState(prev => {
                            const generateJobs = {
                                ...prev.generateJobs,
                                [productIndex]: {
                                    jobId: generateJob.job_id,
                                    status: (generateJob.status === 'completed' ? 'completed' :
                                        generateJob.status === 'failed' ? 'failed' : 'processing') as StepStatus,
                                    completedAt: generateJob.status === 'completed' ? Date.now() : undefined,
                                },
                            };
                            const newState = { ...prev, generateJobs, lastUpdated: Date.now() };
                            persistState(newState);
                            return newState;
                        });
                    }
                });
                console.log(`[JobsContext] Updated ${generateResults.length} items from generate job ${generateJobId}`);
                return;
            }

            // Try to find recent match jobs for this user to build items list
            const { data: matchJobs, error: matchError } = await supabase
                .from('match_jobs')
                .select('job_id, status, results')
                .eq('user_id', generateJob.user_id)
                .eq('status', 'completed')
                .order('created_at', { ascending: false })
                .limit(5);

            if (matchError || !matchJobs || matchJobs.length === 0) {
                console.warn('[JobsContext] No match jobs found for user');
                return;
            }

            // Use the most recent match job
            const matchJob = matchJobs[0];
            const matchJobId = matchJob.job_id;

            // Build items from match job results
            const matchResults = Array.isArray(matchJob.results) ? matchJob.results : [];
            const items: JobItem[] = matchResults.map((result: any, idx: number) => {
                const firstMatch = result?.serpApiData?.[0];
                return {
                    index: idx,
                    title: firstMatch?.title || `Item ${idx + 1}`,
                    thumb: firstMatch?.image || firstMatch?.thumbnail || '',
                    matchesCount: result?.serpApiData?.length || 0,
                    matchJobId: matchJobId,
                };
            });

            // Now use the standard initializeFromMatchJob to complete setup
            await initializeFromMatchJob(matchJobId, items);

            console.log(`[JobsContext] Initialized from generate job ${generateJobId}, found ${items.length} items from match ${matchJobId}`);
        } catch (e) {
            console.error('[JobsContext] Error in initializeFromGenerateJob:', e);
        }
    }, [initializeFromMatchJob, state.matchJobId, state.items.length, persistState]);

    // Set items
    const setItems = useCallback((items: JobItem[]) => {
        setState(prev => {
            const newState = { ...prev, items, lastUpdated: Date.now() };
            persistState(newState);
            return newState;
        });
    }, [persistState]);

    // Update single item
    const updateItem = useCallback((index: number, update: Partial<JobItem>) => {
        setState(prev => {
            const items = prev.items.map(item =>
                item.index === index ? { ...item, ...update } : item
            );
            const newState = { ...prev, items, lastUpdated: Date.now() };
            persistState(newState);
            return newState;
        });
    }, [persistState]);

    // Start a generate job
    const startGenerateJob = useCallback((index: number, jobId: string) => {
        setState(prev => {
            const generateJobs = {
                ...prev.generateJobs,
                [index]: {
                    jobId,
                    status: 'processing' as StepStatus,
                    startedAt: Date.now(),
                },
            };
            const newState = { ...prev, generateJobs, lastUpdated: Date.now() };
            persistState(newState);
            return newState;
        });
    }, [persistState]);

    // Update generate job
    const updateGenerateJob = useCallback((index: number, update: Partial<GenerateJobInfo>) => {
        setState(prev => {
            const existing = prev.generateJobs[index];
            if (!existing) return prev;

            const generateJobs = {
                ...prev.generateJobs,
                [index]: { ...existing, ...update },
            };
            const newState = { ...prev, generateJobs, lastUpdated: Date.now() };
            persistState(newState);
            return newState;
        });
    }, [persistState]);

    // Mark complete
    const markGenerateComplete = useCallback((index: number) => {
        updateGenerateJob(index, { status: 'completed', completedAt: Date.now() });
    }, [updateGenerateJob]);

    // Mark failed
    const markGenerateFailed = useCallback((index: number) => {
        updateGenerateJob(index, { status: 'failed' });
    }, [updateGenerateJob]);

    // Get items by status
    const getItemsByStatus = useCallback((status: StepStatus | 'all'): JobItem[] => {
        if (status === 'all') return state.items;
        return state.items.filter(item => {
            const genJob = state.generateJobs[item.index];
            return genJob?.status === status;
        });
    }, [state.items, state.generateJobs]);

    const getPendingItems = useCallback(() => {
        return state.items.filter(item => !state.generateJobs[item.index]);
    }, [state.items, state.generateJobs]);

    const getProcessingItems = useCallback(() => {
        return state.items.filter(item => {
            const job = state.generateJobs[item.index];
            return job?.status === 'processing' || job?.status === 'queued';
        });
    }, [state.items, state.generateJobs]);

    const getCompletedItems = useCallback(() => {
        return state.items.filter(item => state.generateJobs[item.index]?.status === 'completed');
    }, [state.items, state.generateJobs]);

    const getFailedItems = useCallback(() => {
        return state.items.filter(item => state.generateJobs[item.index]?.status === 'failed');
    }, [state.items, state.generateJobs]);

    // Poll for processing jobs
    const pollProcessingJobs = useCallback(async () => {
        const processing = Object.entries(state.generateJobs)
            .filter(([, job]) => job.status === 'processing' || job.status === 'queued');

        if (processing.length === 0) return;

        try {
            const token = await ensureSupabaseJwt();
            if (!token) return;

            for (const [indexStr, job] of processing) {
                const index = parseInt(indexStr, 10);
                try {
                    const res = await fetch(
                        `${BASE_URL}/api/products/generate/jobs/${job.jobId}/status`,
                        { headers: { Authorization: `Bearer ${token}` } }
                    );

                    if (!res.ok) continue;
                    const status = await res.json();

                    if (status.status === 'completed') {
                        markGenerateComplete(index);
                    } else if (status.status === 'failed') {
                        markGenerateFailed(index);
                    } else {
                        updateGenerateJob(index, {
                            currentStage: status.currentStage,
                            progress: status.progress,
                        });
                    }
                } catch (e) {
                    console.warn(`[JobsContext] Poll failed for job ${job.jobId}:`, e);
                }
            }
        } catch (e) {
            console.warn('[JobsContext] Polling error:', e);
        }
    }, [state.generateJobs, markGenerateComplete, markGenerateFailed, updateGenerateJob]);

    // Start/stop polling
    const startPolling = useCallback(() => {
        if (isPolling) return;
        setIsPolling(true);

        const poll = () => {
            pollProcessingJobs();
            pollingRef.current = setTimeout(poll, 3000);
        };
        poll();
    }, [isPolling, pollProcessingJobs]);

    const stopPolling = useCallback(() => {
        setIsPolling(false);
        if (pollingRef.current) {
            clearTimeout(pollingRef.current);
            pollingRef.current = null;
        }
    }, []);

    // Auto-start polling when there are processing jobs
    useEffect(() => {
        const hasProcessing = Object.values(state.generateJobs).some(
            job => job.status === 'processing' || job.status === 'queued'
        );

        if (hasProcessing && !isPolling) {
            startPolling();
        } else if (!hasProcessing && isPolling) {
            stopPolling();
        }
    }, [state.generateJobs, isPolling, startPolling, stopPolling]);

    // Cleanup on unmount
    useEffect(() => {
        return () => stopPolling();
    }, [stopPolling]);

    const value: JobsContextValue = {
        matchJobId: state.matchJobId,
        items: state.items,
        generateJobs: state.generateJobs,
        initializeFromMatchJob,
        initializeFromGenerateJob,
        setItems,
        updateItem,
        startGenerateJob,
        updateGenerateJob,
        markGenerateComplete,
        markGenerateFailed,
        getItemsByStatus,
        getPendingItems,
        getProcessingItems,
        getCompletedItems,
        getFailedItems,
        startPolling,
        stopPolling,
        isPolling,
    };

    return (
        <JobsContext.Provider value={value}>
            {children}
        </JobsContext.Provider>
    );
}

// Hook to use the context
export function useJobs(): JobsContextValue {
    const context = useContext(JobsContext);
    if (!context) {
        throw new Error('useJobs must be used within a JobsProvider');
    }
    return context;
}

// Optional hook that doesn't throw (for screens that may not have provider)
export function useJobsOptional(): JobsContextValue | null {
    return useContext(JobsContext);
}

export default JobsContext;
