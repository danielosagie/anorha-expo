import { observable } from '@legendapp/state';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationThreadState } from './types';
import { createEmptyThreadState } from './conversationState';

const STORE_PREFIX = 'liquidation-conversation:v2';
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Legend is the local-first source of truth in memory; AsyncStorage snapshots support cold start recovery.
export const conversationLegendCache$ = observable<Record<string, ConversationThreadState>>({});

const keyForThread = (campaignId: string, threadId: string) => `${STORE_PREFIX}:${campaignId}:${threadId}`;

const writeNow = async (campaignId: string, threadId: string, state: ConversationThreadState) => {
  await AsyncStorage.setItem(keyForThread(campaignId, threadId), JSON.stringify(state));
};

export const loadThreadState = async (
  campaignId: string,
  threadId: string,
): Promise<ConversationThreadState> => {
  const key = keyForThread(campaignId, threadId);
  const cached = conversationLegendCache$[key].get();
  if (cached) {
    return cached;
  }
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      const empty = createEmptyThreadState(campaignId, threadId);
      conversationLegendCache$[key].set(empty);
      return empty;
    }
    const parsed = JSON.parse(raw) as ConversationThreadState;
    const hydrated = {
      ...createEmptyThreadState(campaignId, threadId),
      ...parsed,
      campaignId,
      threadId,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      pendingQueue: Array.isArray(parsed.pendingQueue) ? parsed.pendingQueue : [],
      draft: typeof parsed.draft === 'string' ? parsed.draft : '',
      partialAssistantText: typeof parsed.partialAssistantText === 'string' ? parsed.partialAssistantText : '',
    };
    conversationLegendCache$[key].set(hydrated);
    return hydrated;
  } catch {
    const empty = createEmptyThreadState(campaignId, threadId);
    conversationLegendCache$[key].set(empty);
    return empty;
  }
};

export const persistThreadState = async (
  state: ConversationThreadState,
  options?: { immediate?: boolean },
): Promise<void> => {
  const key = keyForThread(state.campaignId, state.threadId);
  conversationLegendCache$[key].set(state);
  const existingTimer = writeTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
    writeTimers.delete(key);
  }

  if (options?.immediate) {
    await writeNow(state.campaignId, state.threadId, state);
    return;
  }

  await new Promise<void>(resolve => {
    const timer = setTimeout(async () => {
      writeTimers.delete(key);
      await writeNow(state.campaignId, state.threadId, state).catch(() => undefined);
      resolve();
    }, 120);
    writeTimers.set(key, timer);
  });
};

export const updateStoredThreadState = async (
  campaignId: string,
  threadId: string,
  updater: (state: ConversationThreadState) => ConversationThreadState,
): Promise<ConversationThreadState> => {
  const current = await loadThreadState(campaignId, threadId);
  const next = updater(current);
  await persistThreadState(next, { immediate: true });
  return next;
};

export const clearThreadState = async (campaignId: string, threadId: string) => {
  const key = keyForThread(campaignId, threadId);
  conversationLegendCache$[key].delete();
  await AsyncStorage.removeItem(key);
};
