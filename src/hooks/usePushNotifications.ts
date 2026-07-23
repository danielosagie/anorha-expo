import { useState, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth, useUser } from '@clerk/expo';
import { API_BASE_URL } from '../config/env';
import { getActiveThread } from '../lib/activeThread';
import { createLogger } from '../utils/logger';
const log = createLogger('usePushNotifications');

const READY_JOB_IDS_KEY = 'notifications:ready-job-ids:v1';
const READY_JOB_IDS_LIMIT = 100;
let readyJobIdsPromise: Promise<{ ids: Set<string>; order: string[] }> | null = null;
const readyFallbackAt = new Map<string, number>();
const READY_FALLBACK_WINDOW_MS = 10 * 60 * 1000;

function readyJobIdentity(notification: Notifications.Notification): { jobId: string | null; fallbackKey: string | null } | null {
    const content = notification.request.content;
    const data = (content.data || {}) as any;
    const type = String(data?.type || '').toLowerCase();
    const text = `${String(content.title || '')} ${String(content.body || '')}`.toLowerCase();
    const isReady =
        type === 'job_complete' ||
        type === 'import_ready' ||
        type === 'import_review_ready' ||
        type === 'sync_ready' ||
        (text.includes('ready') && text.includes('review'));
    if (!isReady) return null;
    const rawId = data?.jobId ?? data?.job_id ?? data?.importJobId ?? data?.import_id;
    const jobId = rawId == null || String(rawId).trim() === '' ? null : String(rawId);
    const importType = String(data?.importType || '').trim().toLowerCase();
    return { jobId, fallbackKey: importType ? `import:${importType}` : null };
}

async function shouldSuppressReadyJob(notification: Notifications.Notification): Promise<boolean> {
    const identity = readyJobIdentity(notification);
    if (!identity) return false;
    const { jobId, fallbackKey } = identity;

    // Current backend import-ready payloads omit jobId. Keep a narrow in-memory
    // fallback so repeated completion pushes for the same platform do not banner
    // during one review session. Once jobId is present, the durable path below
    // gives exact once-per-job behavior across launches.
    if (!jobId) {
        if (!fallbackKey) return false;
        const now = Date.now();
        const lastSeenAt = readyFallbackAt.get(fallbackKey) ?? 0;
        readyFallbackAt.set(fallbackKey, now);
        return now - lastSeenAt < READY_FALLBACK_WINDOW_MS;
    }

    if (!readyJobIdsPromise) {
        readyJobIdsPromise = AsyncStorage.getItem(READY_JOB_IDS_KEY)
            .then((raw) => {
                const parsed = raw ? JSON.parse(raw) : [];
                const order = Array.isArray(parsed) ? parsed.map(String).slice(-READY_JOB_IDS_LIMIT) : [];
                return { ids: new Set(order), order };
            })
            .catch(() => ({ ids: new Set<string>(), order: [] }));
    }

    const seen = await readyJobIdsPromise;
    if (seen.ids.has(jobId)) return true;
    seen.ids.add(jobId);
    seen.order.push(jobId);
    if (seen.order.length > READY_JOB_IDS_LIMIT) {
        const removed = seen.order.splice(0, seen.order.length - READY_JOB_IDS_LIMIT);
        removed.forEach((id) => seen.ids.delete(id));
    }
    void AsyncStorage.setItem(READY_JOB_IDS_KEY, JSON.stringify(seen.order)).catch((error) => {
        log.warn('[PushNotifications] Failed to persist ready-job dedupe:', error);
    });
    return false;
}


// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
        const data = (notification?.request?.content?.data || {}) as any;
        if (await shouldSuppressReadyJob(notification)) {
            return {
                shouldShowAlert: false,
                shouldPlaySound: false,
                shouldSetBadge: false,
                shouldShowBanner: false,
                shouldShowList: false,
            };
        }
        // Suppress the in-app banner for a Sprout reply when the seller is already in
        // that exact campaign thread (they're watching it land). Backgrounded pushes
        // bypass this handler entirely, so they still show; replies seen from Home or
        // any other screen still banner normally.
        if (data?.type === 'sprout_reply' && data?.campaignId) {
            const { activeCampaignId } = getActiveThread();
            if (activeCampaignId && String(activeCampaignId) === String(data.campaignId)) {
                return {
                    shouldShowAlert: false,
                    shouldPlaySound: false,
                    shouldSetBadge: false,
                    shouldShowBanner: false,
                    shouldShowList: false,
                };
            }
        }
        return {
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
            shouldShowList: true,
        };
    },
});

interface PushNotificationState {
    expoPushToken: string | null;
    notification: Notifications.Notification | null;
    error: Error | null;
}

export function usePushNotifications() {
    const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
    const [notification, setNotification] = useState<Notifications.Notification | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [lastNotificationResponse, setLastNotificationResponse] = useState<Notifications.NotificationResponse | null>(null);

    const notificationListener = useRef<Notifications.EventSubscription | null>(null);
    const responseListener = useRef<Notifications.EventSubscription | null>(null);

    const { user } = useUser();
    const { getToken } = useAuth();

    useEffect(() => {
        let isMounted = true;

        const register = async () => {
            try {
                const token = await registerForPushNotificationsAsync();
                if (token && isMounted) {
                    setExpoPushToken(token);
                    // Save token to backend
                    await saveTokenToBackend(token);
                }
            } catch (err: any) {
                if (isMounted) setError(err);
            }
        };

        if (user) {
            register();
        }

        // Listen for incoming notifications (app in foreground)
        notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
            if (isMounted) setNotification(notification);
        });

        // Listen for notification responses (user tapped notification)
        responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
            log.debug('[PushNotifications] Tapped:', response);
            if (isMounted) setLastNotificationResponse(response);
        });

        return () => {
            isMounted = false;
            notificationListener.current && notificationListener.current.remove();
            responseListener.current && responseListener.current.remove();
        };
    }, [user?.id]);

    const saveTokenToBackend = async (token: string) => {
        if (!user?.id) return;

        try {
            const authToken = await getToken();
            const base = API_BASE_URL;
            if (!base) {
                log.warn('[PushNotifications] No API base URL found');
                return;
            }

            const res = await fetch(`${base}/api/notifications/device`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    token,
                    platform: Platform.OS,
                    deviceInfo: {
                        model: Device.modelName,
                        osVersion: String(Platform.Version),
                        brand: Device.brand
                    }
                })
            });
            if (!res.ok) {
                const text = await res.text();
                log.error('[PushNotifications] Backend rejected device registration:', res.status, text);
            }
        } catch (err) {
            log.error('[PushNotifications] Failed to save token:', err);
        }
    };

    return { expoPushToken, notification, lastNotificationResponse, error };
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
    // Push notifications often need a physical device
    if (!Device.isDevice) {
        log.debug('[PushNotifications] Must use physical device for push notifications (simulators may not work)');
        // We can return null, but sometimes simulators do support it for testing, 
        // though usually Expo Go on simulator fails.
        // carrying on to try anyway or just return null
    }

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permission if not granted
    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        log.debug('[PushNotifications] Permission not granted');
        return null;
    }

    // Get the Expo push token
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.expoConfig?.extra?.projectId;

    // Note: We don't necessarily need projectId if we are just using Expo Go or standard managed workflow, 
    // but it's good practice for EAS builds.
    // If projectId is missing, it might throw or warn.

    try {
        const token = await Notifications.getExpoPushTokenAsync({
            projectId,
        });

        // Android-specific channel setup
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'Default',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#5c9c00',
            });
        }

        return token.data;
    } catch (error) {
        log.error('[PushNotifications] Error getting token:', error);
        return null;
    }
}
