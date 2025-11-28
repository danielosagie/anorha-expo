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
      
      // Fetch user's organizations from /api/organizations
      const orgsResponse = await fetch(`${API_BASE}/api/organizations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!orgsResponse.ok) {
        throw new Error('Failed to fetch orgs');
      }

      let orgsData = await orgsResponse.json();
      console.log('[OrgContext] Orgs data:', orgsData);
      
      // Parse response format: [{ Role, Organizations: { Id, Name, ... } }, ...]
      const formattedOrgs: UserOrgAccess[] = (orgsData || []).map((membership: any) => ({
        id: membership.Organizations.Id,
        name: membership.Organizations.Name,
        role: membership.Role as 'org:admin' | 'org:member',
        assignedPoolIds: membership.assigned_pool_ids || [],
        isActive: false,
      }));
      console.log('[OrgContext] Formatted orgs:', formattedOrgs);

      // Fetch active organization
      const activeResponse = await fetch(`${API_BASE}/api/organizations/me/active`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      let activeOrgId: string | null = null;
      if (activeResponse.ok) {
        const activeData = await activeResponse.json();
        activeOrgId = activeData.orgId;
        console.log('[OrgContext] Active data:', activeData);
      }

      // Mark active org
      const orgsWithActive = formattedOrgs.map(org => ({
        ...org,
        isActive: org.id === activeOrgId,
      }));
      console.log('[OrgContext] Set available orgs, count:', orgsWithActive.length);

      setAvailableOrgs(orgsWithActive);
      
      // Set current org
      const active = orgsWithActive.find((org) => org.id === activeOrgId);
      if (active) {
        console.log('[OrgContext] Set current org:', active);
        setCurrentOrg(active);
      } else if (orgsWithActive.length > 0) {
        console.log('[OrgContext] Set current org to first:', orgsWithActive[0]);
        setCurrentOrg(orgsWithActive[0]);
      }

      setError(null);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to load orgs';
      console.error('[OrgContext] Load orgs error:', err);
      if (err instanceof Error && err.message.includes('Failed to fetch')) {
        console.log('[OrgContext] Fetch failed, possible auth issue');
      }
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
      // Syncing Clerk teams is best-effort; backend webhooks already do this.
      try {
        await syncClerkTeams();
      } catch (syncErr) {
        console.warn('[OrgContext] Clerk sync is optional, continuing:', syncErr);
      }
      // Always reload orgs even if sync failed
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