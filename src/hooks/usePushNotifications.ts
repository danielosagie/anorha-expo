import { useState, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { useAuth, useUser } from '@clerk/clerk-expo';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
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
            const data = response.notification.request.content.data;
            handleNotificationResponse(data);
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
            const authToken = await getToken({ template: process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE || 'supabase' });
            const apiBaseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL;

            if (!apiBaseUrl) {
                console.warn('[PushNotifications] No API base URL found');
                return;
            }

            await fetch(`${apiBaseUrl}/notifications/device`, {
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

        } catch (err) {
            console.error('[PushNotifications] Failed to save token:', err);
        }
    };

    const handleNotificationResponse = (data: any) => {
        // Handle navigation based on notification type
        // You can use a global navigation ref or event emitter here to trigger navigation
        console.log('Notification tapped:', data);

        switch (data?.type) {
            case 'job_complete':
                // Navigate to job results
                break;
            case 'inventory_shared':
                // Navigate to partnerships
                break;
            case 'sprout_insight':
                // Navigate to Sprout
                break;
            default:
                break;
        }
    };

    return { expoPushToken, notification, error };
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
    // Push notifications often need a physical device
    if (!Device.isDevice) {
        console.log('[PushNotifications] Must use physical device for push notifications (simulators may not work)');
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
        console.log('[PushNotifications] Permission not granted');
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
        console.error('[PushNotifications] Error getting token:', error);
        return null;
    }
}
