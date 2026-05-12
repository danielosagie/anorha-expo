import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { SessionContext } from './SessionContext';
import { useOrg } from './OrgContext';
import { capture } from '../lib/analytics';
import { BillingGateResponse, normalizeBillingGateResponse } from '../types/billingGate';
import { DEFAULT_FREEMIUM_STATUS, FreemiumStatus } from '../types/freemium';

const API_BASE_RAW = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
const API_BASE = API_BASE_RAW.replace(/\/$/, '').endsWith('/api')
  ? API_BASE_RAW.replace(/\/$/, '')
  : `${API_BASE_RAW.replace(/\/$/, '')}/api`;

export interface AppDataContextValue {
  productCount: number;
  productCountLoading: boolean;
  productCountError: string | null;
  productCountUpdatedAt: number | null;
  freemiumStatus: FreemiumStatus | null;
  freemiumLoading: boolean;
  freemiumError: string | null;
  freemiumUpdatedAt: number | null;
  billingGate: BillingGateResponse | null;
  billingGateUpdatedAt: number | null;
  refreshProductCount: () => Promise<void>;
  refreshFreemiumStatus: () => Promise<void>;
  preflightAIGate: (featureKey: string, quantity?: number) => Promise<BillingGateResponse>;
  incrementLocalFreemiumUsage: () => void;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const session = useContext(SessionContext);
  const { currentOrg } = useOrg();
  const [productCount, setProductCount] = useState(0);
  const [productCountLoading, setProductCountLoading] = useState(false);
  const [productCountError, setProductCountError] = useState<string | null>(null);
  const [productCountUpdatedAt, setProductCountUpdatedAt] = useState<number | null>(null);
  const [freemiumStatus, setFreemiumStatus] = useState<FreemiumStatus | null>(null);
  const [freemiumLoading, setFreemiumLoading] = useState(false);
  const [freemiumError, setFreemiumError] = useState<string | null>(null);
  const [freemiumUpdatedAt, setFreemiumUpdatedAt] = useState<number | null>(null);
  const [billingGate, setBillingGate] = useState<BillingGateResponse | null>(null);
  const [billingGateUpdatedAt, setBillingGateUpdatedAt] = useState<number | null>(null);

  const refreshProductCount = useCallback(async () => {
    const userId = session?.user?.id;

    if (!session?.bridgeReady || !userId) {
      setProductCountLoading(false);
      return;
    }

    setProductCountLoading(true);
    setProductCountError(null);

    try {
      const { count, error } = await supabase
        .from('ProductVariants')
        .select('*', { count: 'exact', head: true })
        .eq('UserId', userId)
        .not('Sku', 'like', 'DRAFT-%');

      if (error) {
        throw error;
      }

      setProductCount(count || 0);
      setProductCountUpdatedAt(Date.now());
    } catch (error: any) {
      setProductCountError(error?.message || 'Unable to load product count');
    } finally {
      setProductCountLoading(false);
    }
  }, [session?.bridgeReady, session?.user?.id]);

  const refreshFreemiumStatus = useCallback(async () => {
    try {
      setFreemiumLoading(true);
      setFreemiumError(null);

      const token = await ensureSupabaseJwt();
      if (!token) {
        setFreemiumStatus(DEFAULT_FREEMIUM_STATUS);
        setFreemiumUpdatedAt(Date.now());
        return;
      }

      const response = await fetch(`${API_BASE}/billing/freemium-status`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch freemium status: ${response.status}`);
      }

      const data = await response.json();
      setFreemiumStatus(data);
      setFreemiumUpdatedAt(Date.now());
      capture('billing_metering_readiness_snapshot', {
        usageCount: data?.usageCount ?? 0,
        freeLimit: data?.freeLimit ?? 0,
        hasSubscription: !!data?.hasSubscription,
        plan: data?.currentPlan ?? null,
      });
    } catch (error: any) {
      setFreemiumError(error?.message || 'Unable to load freemium status');
      setFreemiumStatus(DEFAULT_FREEMIUM_STATUS);
    } finally {
      setFreemiumLoading(false);
    }
  }, []);

  const preflightAIGate = useCallback(async (
    featureKey: string,
    quantity = 1,
  ): Promise<BillingGateResponse> => {
    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        const unavailable = normalizeBillingGateResponse({
          code: 'billing_status_unavailable',
          message: 'Your session is reconnecting. Try again in a moment.',
          featureKey,
          blockingState: 'billing_status_unavailable',
          canProceed: false,
        }, featureKey);
        setBillingGate(unavailable);
        setBillingGateUpdatedAt(Date.now());
        return unavailable;
      }

      const response = await fetch(`${API_BASE}/billing/ai-gate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ featureKey, quantity }),
      });

      const payload = response.ok
        ? await response.json()
        : await response.json().catch(() => null);
      const normalized = normalizeBillingGateResponse(payload, featureKey);
      setBillingGate(normalized);
      setBillingGateUpdatedAt(Date.now());
      return normalized;
    } catch (error: any) {
      const unavailable = normalizeBillingGateResponse({
        code: 'billing_status_unavailable',
        message: error?.message || 'Unable to verify billing right now.',
        featureKey,
        blockingState: 'billing_status_unavailable',
        canProceed: false,
      }, featureKey);
      setBillingGate(unavailable);
      setBillingGateUpdatedAt(Date.now());
      return unavailable;
    }
  }, []);

  const incrementLocalFreemiumUsage = useCallback(() => {
    setFreemiumStatus((prev) => {
      if (!prev) {
        return prev;
      }

      const usageCount = prev.usageCount + 1;
      const remaining = Math.max(0, prev.freeLimit - usageCount);
      capture('billing_metering_usage_increment', {
        usageCount,
        freeLimit: prev.freeLimit,
        remaining,
        hasSubscription: !!prev.hasSubscription,
      });

      return {
        ...prev,
        usageCount,
        remaining,
        isFreeTierExhausted: remaining === 0 && !prev.hasSubscription,
      };
    });
  }, []);

  useEffect(() => {
    if (!session?.ready) {
      setProductCount(0);
      setProductCountError(null);
      setFreemiumStatus(null);
      setFreemiumError(null);
      setBillingGate(null);
      return;
    }

    void refreshProductCount();
  }, [session?.ready, session?.bridgeReady, refreshProductCount]);

  useEffect(() => {
    if (!session?.ready) {
      return;
    }

    void refreshFreemiumStatus();
  }, [session?.ready, session?.bridgeReady, currentOrg?.id, refreshFreemiumStatus]);

  const value = useMemo<AppDataContextValue>(() => ({
    productCount,
    productCountLoading,
    productCountError,
    productCountUpdatedAt,
    freemiumStatus,
    freemiumLoading,
    freemiumError,
    freemiumUpdatedAt,
    billingGate,
    billingGateUpdatedAt,
    refreshProductCount,
    refreshFreemiumStatus,
    preflightAIGate,
    incrementLocalFreemiumUsage,
  }), [
    productCount,
    productCountLoading,
    productCountError,
    productCountUpdatedAt,
    freemiumStatus,
    freemiumLoading,
    freemiumError,
    freemiumUpdatedAt,
    billingGate,
    billingGateUpdatedAt,
    refreshProductCount,
    refreshFreemiumStatus,
    preflightAIGate,
    incrementLocalFreemiumUsage,
  ]);

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
};

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used within an AppDataProvider');
  }
  return context;
}

export function useProductCount() {
  const {
    productCount,
    productCountLoading,
    productCountError,
    productCountUpdatedAt,
    refreshProductCount,
  } = useAppData();

  return {
    productCount,
    loading: productCountLoading,
    error: productCountError,
    updatedAt: productCountUpdatedAt,
    refresh: refreshProductCount,
  };
}

export function useFreemiumStatus() {
  const {
    freemiumStatus,
    freemiumLoading,
    freemiumError,
    freemiumUpdatedAt,
    refreshFreemiumStatus,
    incrementLocalFreemiumUsage,
  } = useAppData();

  return {
    status: freemiumStatus,
    loading: freemiumLoading,
    error: freemiumError,
    updatedAt: freemiumUpdatedAt,
    refresh: refreshFreemiumStatus,
    incrementLocalUsage: incrementLocalFreemiumUsage,
  };
}

export function useAIBillingGate() {
  const {
    billingGate,
    billingGateUpdatedAt,
    preflightAIGate,
  } = useAppData();

  return {
    billingGate,
    updatedAt: billingGateUpdatedAt,
    preflightAIGate,
  };
}
