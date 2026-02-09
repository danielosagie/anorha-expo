/**
 * Central analytics module for PostHog events.
 * Use capture() for all events - no-ops when PostHog isn't configured.
 * The PostHog instance is set by PostHogInit when the provider is mounted.
 */

// Event name constants for consistency and autocomplete
export const AnalyticsEvents = {
  APP_OPENED: 'app_opened',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  PRODUCT_ADDED: 'product_added',
  LISTING_CREATED: 'listing_created',
  PLATFORM_CONNECTED: 'platform_connected',
  PUBLISH_COMPLETED: 'publish_completed',
  TEAM_INVITE_SENT: 'team_invite_sent',
  PAYWALL_VIEWED: 'paywall_viewed',
  BILLING_PORTAL_OPENED: 'billing_portal_opened',
  SUBSCRIPTION_STARTED: 'subscription_started',
  INVENTORY_IMPORT_STARTED: 'inventory_import_started',
  INVENTORY_IMPORT_COMPLETED: 'inventory_import_completed',
  SYNC_ACTIVATED: 'sync_activated',
  INVENTORY_UPDATED: 'inventory_updated',
  PARTNER_INVITE_SENT: 'partner_invite_sent',
  PARTNER_INVITE_ACCEPTED: 'partner_invite_accepted',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

// Store for the PostHog instance - set by PostHogInit
let posthogInstance: {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (id: string, traits?: Record<string, unknown>) => void;
  group: (type: string, key: string, traits?: Record<string, unknown>) => void;
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
  posthogInstance?.group?.('organization', organizationId, traits);
}
