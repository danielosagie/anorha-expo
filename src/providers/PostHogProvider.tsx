import React from 'react';

/**
 * Temporary fail-open analytics wrapper.
 *
 * posthog-react-native is currently crashing during module initialization in
 * this runtime, which prevents AppRegistry from registering the app at all.
 * Until the native/runtime mismatch is resolved, keep analytics as a no-op so
 * startup and offline flows remain usable.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function PostHogIdentify() {
  return null;
}
