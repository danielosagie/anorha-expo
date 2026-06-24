/**
 * Job-flow types.
 *
 * NOTE: this used to also export a `useJobsState()` polling hook, but that hook was
 * dead (never called) — job-state polling is owned by `JobsContext`/`useJobs`,
 * `useJobProgress`, and `useJobStatus`. Only these two types are still consumed
 * (by ItemJobsModal), so the hook + its private types were removed. Kept at this
 * path to avoid churning the import.
 */

// Step status for a single stage of the scan → match → generate → details flow.
export type StepStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'skipped';

// Per-item state across the job flow.
export interface ItemJobState {
    index: number;
    title: string;
    thumb?: string;
    productId?: string;
    variantId?: string;
    matchJobId?: string; // The match job ID for this specific item

    // Scan step (photo capture - typically completed before this is used)
    scan: {
        status: StepStatus;
        photos: string[];
    };

    // Match step (lookup + reranking)
    match: {
        status: StepStatus;
        jobId?: string;
        matchesCount: number;
        progress?: number; // 0-100
        currentStage?: string;
        selectedIndices?: number[];
        matchRows?: any[];
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
