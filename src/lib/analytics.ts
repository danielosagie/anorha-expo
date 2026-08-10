/**
 * Central analytics module for PostHog events.
 * Use capture() for all events - no-ops when PostHog isn't configured.
 * The PostHog instance is set by PostHogInit when the provider is mounted.
 *
 * Event names are shared with the backend
 * (sssync-bknd/src/analytics/analytics-events.ts). A funnel only works if both
 * sides emit the same string, so add a name to both files in the same change.
 */

/** PostHog group type used for org-level rollups. Must match the backend's ORGANIZATION_GROUP. */
export const ORGANIZATION_GROUP = 'organization';

// Event name constants for consistency and autocomplete.
//
// Every name below has a live call site. An event nobody emits reads as a real
// zero on a dashboard rather than as "not measured", so when you add a name
// here, wire it in the same change or leave it out.
export const AnalyticsEvents = {
  APP_OPENED: 'app_opened',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  PRODUCT_ADDED: 'product_added',
  /** Saved to inventory with no platform selected. The backend's publish events
   *  are per platform connection, so this path is invisible server-side. */
  LISTING_CREATED: 'listing_created',
  PUBLISH_COMPLETED: 'publish_completed',
  TEAM_INVITE_SENT: 'team_invite_sent',
  PAYWALL_VIEWED: 'paywall_viewed',
  BILLING_PORTAL_OPENED: 'billing_portal_opened',
  INVENTORY_UPDATED: 'inventory_updated',
  PARTNER_INVITE_SENT: 'partner_invite_sent',
  PARTNER_INVITE_ACCEPTED: 'partner_invite_accepted',
  /** OAuth round-trip the user saw fail or cancel. The backend cannot see this:
   *  a connection row is never written, so only the client knows it happened. */
  PLATFORM_CONNECT_FAILED: 'platform_connect_failed',

  // --- Owned by the backend. Listed here so nobody double-counts them. ---
  // platform_connected / platform_reconnected            -> platform-connections.service
  // inventory_import_started / inventory_import_completed -> initial-sync.processor
  // sync_activated                                        -> initial-sync.processor
  // subscription_started                                  -> billing.service (Polar webhook)
  // user_created / organization_created                   -> auth.service (Clerk webhook)
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

// Store for the PostHog instance - set by PostHogInit
let posthogInstance: {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (id: string, traits?: Record<string, unknown>) => void;
  group: (type: string, key: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
} | null = null;

export function setPostHogInstance(instance: typeof posthogInstance) {
  posthogInstance = instance;
}

export function capture(event: AnalyticsEventName | string, properties?: Record<string, unknown>) {
  posthogInstance?.capture?.(event, properties);
}

export function identify(userId: string, traits?: Record<string, unknown>) {
  posthogInstance?.identify?.(userId, traits);
}

export function group(organizationId: string, traits?: Record<string, unknown>) {
  posthogInstance?.group?.(ORGANIZATION_GROUP, organizationId, traits);
}

/** Clears the identity on sign-out so the next person gets a fresh distinct id. */
export function reset() {
  posthogInstance?.reset?.();
}
