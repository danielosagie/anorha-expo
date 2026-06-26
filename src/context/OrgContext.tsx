// sssync_mobile_test/src/context/OrgContext.tsx

import React, { createContext, useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useUser, useOrganizationList } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureSupabaseJwt, getSupabaseJwtState, isSupabaseBridgeWarmingUp } from '../lib/supabase';
import { SessionContext } from './SessionContext';
import { API_BASE_URL } from '../config/env';
import { createLogger } from '../utils/logger';
const log = createLogger('OrgContext');


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

const ORG_CACHE_KEY = 'sssync_org_context_cache_v1';

function createHttpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function getErrorStatus(error: unknown): number | null {
  return typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : null;
}

function isConnectivityError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('offline') ||
    message.includes('internet')
  );
}

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

  const API_BASE = API_BASE_URL;

  const hydrateFromCache = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(ORG_CACHE_KEY);
      if (!stored) {
        return false;
      }

      const parsed = JSON.parse(stored) as {
        currentOrg: UserOrgAccess | null;
        availableOrgs: UserOrgAccess[];
      };

      setAvailableOrgs(parsed.availableOrgs || []);
      setCurrentOrg(parsed.currentOrg || parsed.availableOrgs?.find((org) => org.isActive) || null);
      return true;
    } catch (error) {
      log.warn('[OrgContext] Failed to hydrate org cache:', error);
      return false;
    }
  }, []);

  const persistOrgCache = useCallback(async (nextCurrentOrg: UserOrgAccess | null, nextAvailableOrgs: UserOrgAccess[]) => {
    try {
      await AsyncStorage.setItem(ORG_CACHE_KEY, JSON.stringify({
        currentOrg: nextCurrentOrg,
        availableOrgs: nextAvailableOrgs,
      }));
    } catch (error) {
      log.warn('[OrgContext] Failed to persist org cache:', error);
    }
  }, []);

  /**
   * Fetch all available orgs for this user
   * Note: Clerk team sync is now handled automatically via backend webhooks
   */
  const loadAvailableOrgs = useCallback(async () => {
    if (!isSignedIn) return;

    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        throw createHttpError(401, 'Missing session token for organization fetch');
      }
      log.debug('[OrgContext] Fetching orgs with token prefix:', token?.substring(0, 20) + '...');

      // Fetch user's organizations from /api/organizations
      const orgsResponse = await fetch(`${API_BASE}/api/organizations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      log.debug('[OrgContext] Response status:', orgsResponse.status, orgsResponse.statusText);

      if (!orgsResponse.ok) {
        const errorBody = await orgsResponse.text();
        log.error('[OrgContext] API error response:', { status: orgsResponse.status, body: errorBody });
        throw createHttpError(orgsResponse.status, `Failed to fetch orgs: ${orgsResponse.status} - ${errorBody}`);
      }

      let orgsData = await orgsResponse.json();
      log.debug('[OrgContext] Orgs data:', orgsData);

      // Parse response format: [{ Role, Organizations: { Id, Name, ... } }, ...]
      const formattedOrgs: UserOrgAccess[] = (orgsData || []).map((membership: any) => ({
        id: membership.Organizations.Id,
        name: membership.Organizations.Name,
        role: membership.Role as 'org:admin' | 'org:member',
        assignedPoolIds: membership.assigned_pool_ids || [],
        isActive: false,
      }));
      log.debug('[OrgContext] Formatted orgs:', formattedOrgs);

      // Fetch active organization
      const activeResponse = await fetch(`${API_BASE}/api/organizations/me/active`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      let activeOrgId: string | null = null;
      if (activeResponse.ok) {
        const activeData = await activeResponse.json();
        activeOrgId = activeData.orgId;
        log.debug('[OrgContext] Active data:', activeData);
      } else if (activeResponse.status === 401 || activeResponse.status === 403) {
        const errorBody = await activeResponse.text().catch(() => '');
        throw createHttpError(activeResponse.status, `Failed to fetch active org: ${activeResponse.status} - ${errorBody}`);
      }

      // Mark active org
      const orgsWithActive = formattedOrgs.map(org => ({
        ...org,
        isActive: org.id === activeOrgId,
      }));
      log.debug('[OrgContext] Set available orgs, count:', orgsWithActive.length);

      setAvailableOrgs(orgsWithActive);

      // Set current org
      const active = orgsWithActive.find((org) => org.id === activeOrgId);
      if (active) {
        log.debug('[OrgContext] Set current org:', active);
        setCurrentOrg(active);
        await persistOrgCache(active, orgsWithActive);
      } else if (orgsWithActive.length > 0) {
        log.debug('[OrgContext] Set current org to first:', orgsWithActive[0]);
        setCurrentOrg(orgsWithActive[0]);
        await persistOrgCache(orgsWithActive[0], orgsWithActive);
      } else {
        await persistOrgCache(null, []);
      }

      setError(null);
    } catch (err) {
      log.error('[OrgContext] Load orgs error:', err);
      const status = getErrorStatus(err);
      const hydrated = await hydrateFromCache();
      const authError = status === 401 || status === 403;
      const networkError = isConnectivityError(err);

      if (hydrated) {
        log.debug('[OrgContext] Using cached organization state after load failure');
        if (networkError) {
          setError('No internet connection. Continuing with cached workspace data.');
        } else if (authError) {
          setError('Unable to refresh organization access right now. Continuing with cached workspace data.');
        } else {
          setError('Live organization sync is unavailable. Continuing with cached workspace data.');
        }
        return;
      }

      log.debug('[OrgContext] No org cache found, clearing organization state');
      setAvailableOrgs([]);
      setCurrentOrg(null);
      if (networkError) {
        setError('No internet connection. Organization data could not be loaded.');
      } else if (authError) {
        setError('Unable to verify your organization access right now. Please sign in again.');
      } else {
        setError('Unable to load organizations right now.');
      }
    }
  }, [hydrateFromCache, isSignedIn, persistOrgCache]);

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
        const updatedOrgs = availableOrgs.map(org => ({
            ...org,
            isActive: org.id === orgId,
          }));
        setAvailableOrgs(updatedOrgs);
        await persistOrgCache({ ...switched, isActive: true }, updatedOrgs);
      }

      setError(null);
      log.debug('[OrgContext] Switched to org:', orgId);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Switch failed';
      log.error('[OrgContext] Switch org error:', errMsg);
      setError(errMsg);
      throw err;
    }
  }, [availableOrgs, persistOrgCache]);

  /**
   * Refresh orgs (re-fetch from API)
   */
  // The load effect below depends on refreshOrgs' identity, and refreshOrgs ->
  // loadAvailableOrgs -> setState re-renders recreate that identity, which re-fires
  // the effect. Without a guard this hammered /api/organizations/me/active dozens of
  // times a second. Coalesce re-entrant calls and throttle to one refresh / 4s.
  const refreshInFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(0);

  const refreshOrgs = useCallback(async () => {
    if (!session?.bridgeReady) {
      const jwtState = getSupabaseJwtState().state;
      log.debug('[OrgContext] Skipping org refresh until auth bridge is ready:', jwtState);
      await hydrateFromCache();
      setError(
        isSupabaseBridgeWarmingUp(jwtState)
          ? 'Refreshing your live session. Using cached workspace data for now.'
          : 'Live organization sync is unavailable. Continuing with cached workspace data.',
      );
      setIsLoading(false);
      return;
    }

    if (refreshInFlightRef.current) return;
    if (Date.now() - lastRefreshAtRef.current < 4000) return;
    refreshInFlightRef.current = true;
    lastRefreshAtRef.current = Date.now();

    setIsLoading(true);
    try {
      await loadAvailableOrgs();
    } catch (err) {
      log.error('[OrgContext] Refresh error:', err);
    } finally {
      setIsLoading(false);
      refreshInFlightRef.current = false;
    }
  }, [hydrateFromCache, loadAvailableOrgs, session?.bridgeReady]);

  /**
   * On app load: Wait for session to be ready, then load orgs
   */
  useEffect(() => {
    if (!isSignedIn) {
      setCurrentOrg(null);
      setAvailableOrgs([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    // Wait for SessionProvider to configure the Supabase bridge
    if (!session?.ready) {
      log.debug('[OrgContext] Waiting for session.ready before loading orgs...');
      return;
    }

    if (!session?.bridgeReady) {
      log.debug('[OrgContext] Session ready but auth bridge is not ready. Hydrating cached org state...');
      hydrateFromCache().finally(() => {
        setError(session?.bootstrapError || 'Refreshing your live session. Using cached workspace data for now.');
        setIsLoading(false);
      });
      return;
    }

    log.debug('[OrgContext] Session ready, loading orgs...');
    refreshOrgs();
  }, [hydrateFromCache, isSignedIn, session?.bridgeReady, session?.bootstrapError, session?.ready, refreshOrgs]);

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
