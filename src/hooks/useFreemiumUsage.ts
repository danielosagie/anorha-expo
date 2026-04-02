import { useFreemiumStatus } from '../context/AppDataContext';
import type { FreemiumStatus } from '../types/freemium';

interface UseFreemiumUsageReturn {
    status: FreemiumStatus | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    incrementLocalUsage: () => void;
}

export function useFreemiumUsage(): UseFreemiumUsageReturn {
    const { status, loading, error, refresh, incrementLocalUsage } = useFreemiumStatus();

    return {
        status,
        loading,
        error,
        refresh,
        incrementLocalUsage,
    };
}

export default useFreemiumUsage;
