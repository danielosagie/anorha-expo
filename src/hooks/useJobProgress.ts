import { useEffect, useState, useRef } from 'react';
import { useCollaboration } from './useCollaboration';
import { createLogger } from '../utils/logger';
const log = createLogger('useJobProgress');


export interface JobProgressData {
    jobId: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    currentStage?: string;
    progress?: number;
    results?: any[];
    error?: string;
}

export function useJobProgress(targetJobId?: string) {
    const { isConnected, onJobProgress } = useCollaboration();
    const [jobState, setJobState] = useState<JobProgressData | null>(null);

    useEffect(() => {
        if (!targetJobId) return;

        // Listen for updates
        // Note: We need to ensure useCollaboration exposes onJobProgress or we access the socket directly
        // Ideally useCollaboration should be updated to expose this, or we can add a generic event listener
        const unsubscribe = onJobProgress && onJobProgress((data) => {
            if (data.jobId === targetJobId) {
                log.debug('[SOCKET] Job progress:', data.status, data.currentStage);
                setJobState(data);
            }
        });

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [targetJobId, onJobProgress]);

    return { jobState, isConnected };
}
