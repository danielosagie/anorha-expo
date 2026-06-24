import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthPersistence } from './AuthPersistence';

/**
 * Purge every persisted auth artifact so a signed-OUT session cannot re-hydrate
 * itself on the next app launch.
 *
 * Two things conspire to "sign you back in" otherwise:
 *  1. Clerk's RN sign-out can throw a benign "origin" error and leave the session
 *     persisted in SecureStore (token cache + ResourceCache client snapshot), which
 *     ClerkProvider re-hydrates on next init → isSignedIn flips back true.
 *  2. AuthPersistence caches {isAuthenticated,userId,…} and, within its 30-min
 *     window, EnhancedSessionProvider restores that cached user without revalidating.
 *
 * This clears both. Best-effort: a missing key is a no-op, so it never makes
 * sign-out worse. Single source of truth for "tear down persisted auth" — shared by
 * AppNavigator.signOut and the session reconnect "sign out" escape.
 *
 * Clerk key names per @clerk/clerk-expo: token cache "__clerk_client_jwt" +
 * ResourceCache "__clerk_cache_{client,session_jwt}_<pk last 5>"; the backing store
 * varies by version, so we clear both SecureStore and AsyncStorage.
 */
export async function purgeClerkAndAuthCaches(): Promise<void> {
  try {
    const pkSuffix = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '').slice(-5);
    const clerkKeys = [
      '__clerk_client_jwt',
      `__clerk_cache_client_${pkSuffix}`,
      `__clerk_cache_session_jwt_${pkSuffix}`,
    ];
    await Promise.all(
      clerkKeys.flatMap((k) => [
        SecureStore.deleteItemAsync(k).catch(() => {}),
        AsyncStorage.removeItem(k).catch(() => {}),
      ]),
    );
  } catch {
    /* best-effort */
  }
  try {
    await AuthPersistence.getInstance().clearAuthData();
  } catch {
    /* best-effort */
  }
}
