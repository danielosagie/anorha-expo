import { useState, useCallback, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Alert } from 'react-native';
import { UserEntitlements, fetchUserEntitlements, isFeatureAvailable } from '../utils/entitlements';
import { ensureSupabaseJwt } from '../lib/supabase';

const API_BASE_URL = 'https://api.sssync.app';

interface UsePaywallReturn {
  entitlements: UserEntitlements | null;
  loading: boolean;
  showPaywall: boolean;
  paywallFeature: string | undefined;
  openPaywall: (feature?: string) => void;
  closePaywall: () => void;
  handleUpgrade: () => Promise<void>;
  checkFeatureAccess: (feature: 'ai_scan' | 'multi_platform' | 'team_members' | 'advanced_sync') => boolean;
  requireFeature: (feature: 'ai_scan' | 'multi_platform' | 'team_members' | 'advanced_sync', featureLabel?: string) => boolean;
  refreshEntitlements: () => Promise<void>;
}

export function usePaywall(): UsePaywallReturn {
  const [entitlements, setEntitlements] = useState<UserEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<string | undefined>(undefined);

  // Fetch entitlements on mount
  const refreshEntitlements = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchUserEntitlements();
      setEntitlements(data);
    } catch (error) {
      console.error('[usePaywall] Error fetching entitlements:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshEntitlements();
  }, [refreshEntitlements]);

  // Open paywall modal
  const openPaywall = useCallback((feature?: string) => {
    setPaywallFeature(feature);
    setShowPaywall(true);
  }, []);

  // Close paywall modal
  const closePaywall = useCallback(() => {
    setShowPaywall(false);
    setPaywallFeature(undefined);
  }, []);

  // Handle upgrade - open billing portal
  const handleUpgrade = useCallback(async () => {
    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        Alert.alert('Error', 'Not authenticated. Please log in again.');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/auth/billing/login-link`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get billing link: ${response.status}`);
      }

      const { url } = await response.json();
      if (!url) {
        throw new Error('No URL received from server');
      }

      // Close paywall and open billing
      closePaywall();
      await WebBrowser.openBrowserAsync(url);
      
      // Refresh entitlements after returning from billing
      await refreshEntitlements();
    } catch (error: any) {
      console.error('[usePaywall] Failed to open billing:', error);
      Alert.alert('Error', `Failed to open billing: ${error.message}`);
    }
  }, [closePaywall, refreshEntitlements]);

  // Check if a feature is available (without showing paywall)
  const checkFeatureAccess = useCallback((feature: 'ai_scan' | 'multi_platform' | 'team_members' | 'advanced_sync'): boolean => {
    return isFeatureAvailable(entitlements, feature);
  }, [entitlements]);

  // Require a feature - checks access and shows paywall if not available
  // Returns true if user has access, false if paywall is shown
  const requireFeature = useCallback((
    feature: 'ai_scan' | 'multi_platform' | 'team_members' | 'advanced_sync',
    featureLabel?: string
  ): boolean => {
    const hasAccess = isFeatureAvailable(entitlements, feature);
    
    if (!hasAccess) {
      openPaywall(featureLabel);
      return false;
    }
    
    return true;
  }, [entitlements, openPaywall]);

  return {
    entitlements,
    loading,
    showPaywall,
    paywallFeature,
    openPaywall,
    closePaywall,
    handleUpgrade,
    checkFeatureAccess,
    requireFeature,
    refreshEntitlements,
  };
}

export default usePaywall;






