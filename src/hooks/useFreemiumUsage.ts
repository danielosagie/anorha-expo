import { useState, useCallback, useEffect } from 'react';
import { ensureSupabaseJwt } from '../lib/supabase';
import { capture } from '../lib/analytics';

const API_BASE_URL = 'https://api.sssync.app/api';

export interface FreemiumStatus {
    // Free tier usage
    usageCount: number;
    freeLimit: number;
    remaining: number;
    isFreeTierExhausted: boolean;

    // Trial info
    trialDaysRemaining: number;
    isTrialActive: boolean;
    trialEndsAt: string | null;

    // Subscription info
    hasSubscription: boolean;
    currentPlan: string | null;

    // Tier options for paywall
    tiers: Array<{
        id: string;
        name: string;
        price: number;
        billingPeriod: string;
        users: number;
        features: string[];
    }>;
}

interface UseFreemiumUsageReturn {
    status: FreemiumStatus | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    incrementLocalUsage: () => void;
}

const DEFAULT_STATUS: FreemiumStatus = {
    usageCount: 0,
    freeLimit: 3,
    remaining: 3,
    isFreeTierExhausted: false,
    trialDaysRemaining: 7,
    isTrialActive: true,
    trialEndsAt: null,
    hasSubscription: false,
    currentPlan: null,
    tiers: [],
};

export function useFreemiumUsage(): UseFreemiumUsageReturn {
    const [status, setStatus] = useState<FreemiumStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const token = await ensureSupabaseJwt();
            if (!token) {
                console.warn('[useFreemiumUsage] No auth token available');
                setStatus(DEFAULT_STATUS);
                return;
            }

            const response = await fetch(`${API_BASE_URL}/billing/freemium-status`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch freemium status: ${response.status}`);
            }

            const data = await response.json();
            setStatus(data);
            capture('billing_metering_readiness_snapshot', {
                usageCount: data?.usageCount ?? 0,
                freeLimit: data?.freeLimit ?? 0,
                hasSubscription: !!data?.hasSubscription,
                plan: data?.currentPlan ?? null,
            });
        } catch (err: any) {
            console.error('[useFreemiumUsage] Error fetching status:', err);
            setError(err.message);
            // Use defaults on error so app doesn't break
            setStatus(DEFAULT_STATUS);
        } finally {
            setLoading(false);
        }
    }, []);

    // Fetch on mount
    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    // Optimistic local increment (for immediate UI feedback)
    const incrementLocalUsage = useCallback(() => {
        setStatus(prev => {
            if (!prev) return prev;
            const newUsageCount = prev.usageCount + 1;
            const newRemaining = Math.max(0, prev.freeLimit - newUsageCount);
            capture('billing_metering_usage_increment', {
                usageCount: newUsageCount,
                freeLimit: prev.freeLimit,
                remaining: newRemaining,
                hasSubscription: !!prev.hasSubscription,
            });
            return {
                ...prev,
                usageCount: newUsageCount,
                remaining: newRemaining,
                isFreeTierExhausted: newRemaining === 0 && !prev.hasSubscription,
            };
        });
    }, []);

    return {
        status,
        loading,
        error,
        refresh: fetchStatus,
        incrementLocalUsage,
    };
}

export default useFreemiumUsage;
