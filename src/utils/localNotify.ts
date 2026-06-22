import * as Notifications from 'expo-notifications';
import { createLogger } from './logger';

const log = createLogger('localNotify');

/**
 * Fire an immediate LOCAL notification (best-effort). The global handler installed in
 * usePushNotifications controls foreground display, and tap-routing for
 * `data.type === 'listing_ready'` is handled in AppNavigator.
 *
 * NOTE: this only delivers while the JS runtime is alive — i.e. the app is foregrounded
 * or recently backgrounded. For a listing that finishes while the app is fully
 * backgrounded/killed, the reliable path is a BACKEND push on generate-job completion
 * (the device token is already registered via /api/notifications/device). Use this for
 * the in-app "seller left the screen / switched tabs" case.
 */
export async function notifyListingReady(count = 1): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: count > 1 ? `${count} listings ready` : 'Listing ready',
        body: count > 1
          ? 'Your listings are ready to review and publish.'
          : 'Your listing is ready to review and publish.',
        data: { type: 'listing_ready' },
      },
      trigger: null, // deliver now
    });
  } catch (e) {
    log.warn('notifyListingReady failed', e);
  }
}
