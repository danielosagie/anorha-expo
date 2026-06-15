// Tracks which campaign thread is currently foregrounded so a push notification
// for a reply the seller is already watching can be suppressed (see the
// notification handler in usePushNotifications). Module-level on purpose: the
// notification handler is registered at import time, outside React.
let activeCampaignId: string | null = null;
let activeThreadId: string | null = null;

export const setActiveThread = (campaignId: string | null, threadId: string | null) => {
  activeCampaignId = campaignId;
  activeThreadId = threadId;
};

export const getActiveThread = () => ({ activeCampaignId, activeThreadId });
