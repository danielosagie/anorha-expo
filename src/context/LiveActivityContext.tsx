import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { BulkJobActivityProps } from '../live-activities/BulkJobActivity';
import { ensureSupabaseJwt } from '../lib/supabase';

type LiveActivityJobType = 'match' | 'generate';

type LiveActivityContextValue = {
  updateBulkJobActivity: (jobId: string, jobType: LiveActivityJobType, props: BulkJobActivityProps) => void;
  endBulkJobActivity: (jobId?: string) => void;
};

const LiveActivityContext = createContext<LiveActivityContextValue>({
  updateBulkJobActivity: () => {},
  endBulkJobActivity: () => {},
});

const API_BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'https://api.sssync.app';
const CAN_USE_LIVE_ACTIVITY = Platform.OS === 'ios' && Constants.appOwnership !== 'expo';

type BulkJobActivityFactory = typeof import('../live-activities/BulkJobActivity').default;
type BulkJobActivityInstance = ReturnType<BulkJobActivityFactory['start']>;

export const LiveActivityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const activityRef = useRef<BulkJobActivityInstance | null>(null);
  const activityFactoryRef = useRef<BulkJobActivityFactory | null>(null);
  const activityFactoryPromiseRef = useRef<Promise<BulkJobActivityFactory | null> | null>(null);
  const currentJobIdRef = useRef<string | null>(null);
  const lastSignatureRef = useRef<string>('');
  const lastRegisteredTokenRef = useRef<string>('');
  const lastRegisteredJobRef = useRef<string>('');

  const loadActivityFactory = useCallback(async () => {
    if (!CAN_USE_LIVE_ACTIVITY) return null;
    if (activityFactoryRef.current) return activityFactoryRef.current;
    if (activityFactoryPromiseRef.current) return activityFactoryPromiseRef.current;

    const loader = import('../live-activities/BulkJobActivity')
      .then((module) => {
        activityFactoryRef.current = module.default;
        return module.default;
      })
      .catch((error) => {
        console.warn('[LiveActivity] Expo Widgets unavailable:', error);
        return null;
      })
      .finally(() => {
        activityFactoryPromiseRef.current = null;
      });

    activityFactoryPromiseRef.current = loader;
    return loader;
  }, []);

  const registerPushToken = useCallback(
    async (jobId: string, jobType: LiveActivityJobType, pushToken: string) => {
      if (!pushToken) return;
      if (pushToken === lastRegisteredTokenRef.current && jobId === lastRegisteredJobRef.current) return;

      const authToken = await ensureSupabaseJwt();
      if (!authToken) return;

      lastRegisteredTokenRef.current = pushToken;
      lastRegisteredJobRef.current = jobId;

      await fetch(`${API_BASE_URL}/api/live-activities/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobId,
          jobType,
          pushToken,
        }),
      }).catch((error) => {
        console.warn('[LiveActivity] Failed to register push token:', error);
      });
    },
    [],
  );

  const startOrUpdateAsync = useCallback(
    async (jobId: string, jobType: LiveActivityJobType, props: BulkJobActivityProps) => {
      if (!CAN_USE_LIVE_ACTIVITY) return;
      const activityFactory = await loadActivityFactory();
      if (!activityFactory) return;

      const signature = JSON.stringify(props);
      const isSameJob = currentJobIdRef.current === jobId;

      if (!isSameJob && activityRef.current) {
        try {
          activityRef.current.end('default');
        } catch {}
        activityRef.current = null;
        lastSignatureRef.current = '';
      }

      if (!activityRef.current) {
        currentJobIdRef.current = jobId;
        try {
          activityRef.current = activityFactory.start(props);
          activityRef.current.addPushTokenListener(({ pushToken }) => {
            void registerPushToken(jobId, jobType, pushToken);
          });
          lastSignatureRef.current = signature;
        } catch (error) {
          console.warn('[LiveActivity] Failed to start activity:', error);
        }
        return;
      }

      if (signature !== lastSignatureRef.current) {
        lastSignatureRef.current = signature;
        try {
          activityRef.current.update(props);
        } catch (error) {
          console.warn('[LiveActivity] Failed to update activity:', error);
        }
      }
    },
    [loadActivityFactory, registerPushToken],
  );

  const startOrUpdate = useCallback(
    (jobId: string, jobType: LiveActivityJobType, props: BulkJobActivityProps) => {
      void startOrUpdateAsync(jobId, jobType, props);
    },
    [startOrUpdateAsync],
  );

  const endBulkJobActivity = useCallback((jobId?: string) => {
    if (!CAN_USE_LIVE_ACTIVITY) return;
    if (jobId && currentJobIdRef.current && jobId !== currentJobIdRef.current) {
      return;
    }
    if (activityRef.current) {
      try {
        activityRef.current.end('default');
      } catch {}
    }
    activityRef.current = null;
    currentJobIdRef.current = null;
    lastSignatureRef.current = '';
  }, []);

  const value = useMemo(
    () => ({
      updateBulkJobActivity: startOrUpdate,
      endBulkJobActivity,
    }),
    [endBulkJobActivity, startOrUpdate],
  );

  return <LiveActivityContext.Provider value={value}>{children}</LiveActivityContext.Provider>;
};

export const useLiveActivity = () => useContext(LiveActivityContext);
