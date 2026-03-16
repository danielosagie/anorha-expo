import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CampaignSummary, CampaignThreadSummary } from './types';

type ConversationMetadataState = {
  hiddenCampaignIds: Record<string, boolean>;
  hiddenThreadIds: Record<string, boolean>;
  campaignTitles: Record<string, string>;
  threadTitles: Record<string, string>;
};

const STORE_KEY = 'liquidation-conversation:metadata:v1';

let cache: ConversationMetadataState | null = null;

const createEmptyState = (): ConversationMetadataState => ({
  hiddenCampaignIds: {},
  hiddenThreadIds: {},
  campaignTitles: {},
  threadTitles: {},
});

const threadKey = (campaignId: string, threadId: string) => `${campaignId}:${threadId}`;

const loadState = async (): Promise<ConversationMetadataState> => {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) {
      cache = createEmptyState();
      return cache;
    }
    const parsed = JSON.parse(raw) as Partial<ConversationMetadataState>;
    cache = {
      hiddenCampaignIds: parsed.hiddenCampaignIds || {},
      hiddenThreadIds: parsed.hiddenThreadIds || {},
      campaignTitles: parsed.campaignTitles || {},
      threadTitles: parsed.threadTitles || {},
    };
    return cache;
  } catch {
    cache = createEmptyState();
    return cache;
  }
};

const persistState = async (state: ConversationMetadataState) => {
  cache = state;
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(state));
};

const updateState = async (
  updater: (state: ConversationMetadataState) => ConversationMetadataState,
): Promise<ConversationMetadataState> => {
  const current = await loadState();
  const next = updater(current);
  await persistState(next);
  return next;
};

export const applyCampaignMetadata = async (campaigns: CampaignSummary[]): Promise<CampaignSummary[]> => {
  const state = await loadState();
  return campaigns
    .filter(campaign => !state.hiddenCampaignIds[campaign.id])
    .map(campaign => ({
      ...campaign,
      title: state.campaignTitles[campaign.id] || campaign.title,
    }));
};

export const applyThreadMetadata = async (
  campaignId: string,
  threads: CampaignThreadSummary[],
): Promise<CampaignThreadSummary[]> => {
  const state = await loadState();
  return threads
    .filter(thread => !state.hiddenThreadIds[threadKey(campaignId, thread.id)])
    .map(thread => ({
      ...thread,
      title: state.threadTitles[threadKey(campaignId, thread.id)] || thread.title,
    }));
};

export const renameCampaignLocal = async (campaignId: string, title: string) => {
  await updateState(state => ({
    ...state,
    campaignTitles: {
      ...state.campaignTitles,
      [campaignId]: title,
    },
    hiddenCampaignIds: {
      ...state.hiddenCampaignIds,
      [campaignId]: false,
    },
  }));
};

export const hideCampaignLocal = async (campaignId: string) => {
  await updateState(state => ({
    ...state,
    hiddenCampaignIds: {
      ...state.hiddenCampaignIds,
      [campaignId]: true,
    },
  }));
};

export const renameThreadLocal = async (campaignId: string, threadId: string, title: string) => {
  const key = threadKey(campaignId, threadId);
  await updateState(state => ({
    ...state,
    threadTitles: {
      ...state.threadTitles,
      [key]: title,
    },
    hiddenThreadIds: {
      ...state.hiddenThreadIds,
      [key]: false,
    },
  }));
};

export const hideThreadLocal = async (campaignId: string, threadId: string) => {
  const key = threadKey(campaignId, threadId);
  await updateState(state => ({
    ...state,
    hiddenThreadIds: {
      ...state.hiddenThreadIds,
      [key]: true,
    },
  }));
};
