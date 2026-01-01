// sssync_mobile_test/src/context/OrgContext.tsx

import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';
import { useUser, useOrganizationList } from '@clerk/clerk-expo';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { SessionContext } from './SessionContext';

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
  hasPendingInvites: boolean;
  switchOrg: (orgId: string) => Promise<void>;
  refreshOrgs: () => Promise<void>;
}

export const OrgContext = createContext<OrgContextType>({
  currentOrg: null,
  availableOrgs: [],
  isLoading: true,
  error: null,
  hasPendingInvites: false,
  switchOrg: async () => { },
  refreshOrgs: async () => { },
});

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isSignedIn, user: clerkUser } = useUser();
  const { userInvitations, isLoaded: invitationsLoaded } = useOrganizationList({
    userInvitations: { infinite: true },
  });
  const session = useContext(SessionContext);
  const [availableOrgs, setAvailableOrgs] = useState<UserOrgAccess[]>([]);
  const [currentOrg, setCurrentOrg] = useState<UserOrgAccess | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Derived state: check if user has pending org invitations
  const hasPendingInvites = invitationsLoaded && (userInvitations?.data?.length ?? 0) > 0;

  const API_BASE = 'https://api.sssync.app';

  /**
   * Fetch all available orgs for this user
   * Note: Clerk team sync is now handled automatically via backend webhooks
   */
  const loadAvailableOrgs = useCallback(async () => {
    if (!isSignedIn) return;

    try {
      const token = await ensureSupabaseJwt();
      console.log('[OrgContext] Fetching orgs with token prefix:', token?.substring(0, 20) + '...');

      // Fetch user's organizations from /api/organizations
      const orgsResponse = await fetch(`${API_BASE}/api/organizations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      console.log('[OrgContext] Response status:', orgsResponse.status, orgsResponse.statusText);

      if (!orgsResponse.ok) {
        const errorBody = await orgsResponse.text();
        console.error('[OrgContext] API error response:', { status: orgsResponse.status, body: errorBody });
        throw new Error(`Failed to fetch orgs: ${orgsResponse.status} - ${errorBody}`);
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

      // Set empty state - user should have created org during signup
      // If they don't have one, the app should guide them to create one
      console.log('[OrgContext] No orgs found, setting empty state');
      setAvailableOrgs([]);
      setCurrentOrg(null);
      setError('No organization found. Please complete signup to create one.');
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
   * Refresh orgs (re-fetch from API)
   */
  const refreshOrgs = useCallback(async () => {
    setIsLoading(true);
    try {
      await loadAvailableOrgs();
    } catch (err) {
      console.error('[OrgContext] Refresh error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [loadAvailableOrgs]);

  /**
   * On app load: Wait for session to be ready, then load orgs
   */
  useEffect(() => {
    if (!isSignedIn) {
      setCurrentOrg(null);
      setAvailableOrgs([]);
      setIsLoading(false);
      return;
    }

    // Wait for SessionProvider to configure the Supabase bridge
    if (!session?.ready) {
      console.log('[OrgContext] Waiting for session.ready before loading orgs...');
      return;
    }

    console.log('[OrgContext] Session ready, loading orgs...');
    refreshOrgs();
  }, [isSignedIn, session?.ready, refreshOrgs]);

  return (
    <OrgContext.Provider
      value={{
        currentOrg,
        availableOrgs,
        isLoading,
        error,
        hasPendingInvites,
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