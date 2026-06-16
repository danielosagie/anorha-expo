import { useState, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { API_BASE_URL } from '../config/env';
import { getActiveThread } from '../lib/activeThread';
import { createLogger } from '../utils/logger';
const log = createLogger('usePushNotifications');


// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
        const data = (notification?.request?.content?.data || {}) as any;
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
