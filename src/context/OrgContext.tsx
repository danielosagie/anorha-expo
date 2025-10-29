// sssync_mobile_test/src/context/OrgContext.tsx

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/clerk-expo';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';

export interface UserOrgAccess {
  id: string;
  name: string;
  role: 'org:admin' | 'org:member';
  assignedPoolIds: string[];
  isActive: boolean;
}

export interface OrgContextType {
  currentOrg: UserOrgAccess | null;
  availableOrgs: UserOrgAccess[];
  isLoading: boolean;
  error: string | null;
  switchOrg: (orgId: string) => Promise<void>;
  refreshOrgs: () => Promise<void>;
}

export const OrgContext = createContext<OrgContextType>({
  currentOrg: null,
  availableOrgs: [],
  isLoading: true,
  error: null,
  switchOrg: async () => {},
  refreshOrgs: async () => {},
});

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isSignedIn, user: clerkUser } = useUser();
  const [availableOrgs, setAvailableOrgs] = useState<UserOrgAccess[]>([]);
  const [currentOrg, setCurrentOrg] = useState<UserOrgAccess | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const API_BASE = 'https://api.sssync.app';

  /**
   * 1. Sync Clerk teams to DB first (backfill)
   */
  const syncClerkTeams = useCallback(async () => {
    if (!isSignedIn || !clerkUser?.id) return;

    try {
      const token = await ensureSupabaseJwt();
      const response = await fetch(`${API_BASE}/api/organizations/sync-clerk-teams`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[OrgContext] Clerk sync complete:', data);
      return data;
    } catch (err) {
      console.error('[OrgContext] Clerk sync error:', err);
      setError(err instanceof Error ? err.message : 'Sync failed');
      throw err;
    }
  }, [isSignedIn, clerkUser?.id]);

  /**
   * 2. Fetch all available orgs for this user
   */
  const loadAvailableOrgs = useCallback(async () => {
    if (!isSignedIn) return;

    try {
      const token = await ensureSupabaseJwt();
      const response = await fetch(`${API_BASE}/api/organizations/user/all-orgs`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch orgs');
      }

      const { orgs, activeOrgId } = await response.json();
      
      setAvailableOrgs(orgs);
      
      // Set current org to the active one
      const active = orgs.find((org: UserOrgAccess) => org.id === activeOrgId);
      if (active) {
        setCurrentOrg(active);
      } else if (orgs.length > 0) {
        setCurrentOrg(orgs[0]);
      }

      setError(null);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to load orgs';
      console.error('[OrgContext] Load orgs error:', errMsg);
      setError(errMsg);
    }
  }, [isSignedIn]);

  /**
   * 3. Switch active org
   */
  const switchOrg = useCallback(async (orgId: string) => {
    try {
      const token = await ensureSupabaseJwt();
      const response = await fetch(
        `${API_BASE}/api/organizations/user/active-org/${orgId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to switch org');
      }

      // Update local state
      const switched = availableOrgs.find(org => org.id === orgId);
      if (switched) {
        setCurrentOrg(switched);
        // Mark as active in available orgs list
        setAvailableOrgs(orgs =>
          orgs.map(org => ({
            ...org,
            isActive: org.id === orgId,
          }))
        );
      }

      setError(null);
      console.log('[OrgContext] Switched to org:', orgId);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Switch failed';
      console.error('[OrgContext] Switch org error:', errMsg);
      setError(errMsg);
      throw err;
    }
  }, [availableOrgs]);

  /**
   * 4. Refresh orgs (re-fetch from API)
   */
  const refreshOrgs = useCallback(async () => {
    setIsLoading(true);
    try {
      // First sync Clerk (in case new teams were added in Clerk)
      await syncClerkTeams();
      // Then reload available orgs
      await loadAvailableOrgs();
    } catch (err) {
      console.error('[OrgContext] Refresh error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [syncClerkTeams, loadAvailableOrgs]);

  /**
   * On app load: Sync Clerk teams, then load orgs
   */
  useEffect(() => {
    if (!isSignedIn) {
      setCurrentOrg(null);
      setAvailableOrgs([]);
      setIsLoading(false);
      return;
    }

    refreshOrgs();
  }, [isSignedIn, refreshOrgs]);

  return (
    <OrgContext.Provider
      value={{
        currentOrg,
        availableOrgs,
        isLoading,
        error,
        switchOrg,
        refreshOrgs,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const context = React.useContext(OrgContext);
  if (!context) {
    throw new Error('useOrg must be used within OrgProvider');
  }
  return context;
}

export default OrgProvider;