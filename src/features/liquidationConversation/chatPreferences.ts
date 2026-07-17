import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

export type ChatPreferences = {
  sharedMemory: boolean;
  expandedActivity: boolean;
  suggestedFollowUps: boolean;
};

const STORAGE_KEY = '@anorha/sprout-chat-preferences-v1';

const DEFAULTS: ChatPreferences = {
  sharedMemory: true,
  expandedActivity: false,
  suggestedFollowUps: true,
};

let snapshot: ChatPreferences = DEFAULTS;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(listener => listener());

export const getChatPreferencesSnapshot = (): ChatPreferences => snapshot;

export const loadChatPreferences = (): Promise<void> => {
  if (hydration) return hydration;
  hydration = AsyncStorage.getItem(STORAGE_KEY)
    .then(raw => {
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<ChatPreferences>;
      snapshot = {
        sharedMemory: stored.sharedMemory ?? DEFAULTS.sharedMemory,
        expandedActivity: stored.expandedActivity ?? DEFAULTS.expandedActivity,
        suggestedFollowUps: stored.suggestedFollowUps ?? DEFAULTS.suggestedFollowUps,
      };
      emit();
    })
    .catch(() => undefined);
  return hydration;
};

export const setChatPreference = async <K extends keyof ChatPreferences>(
  key: K,
  value: ChatPreferences[K],
): Promise<void> => {
  await loadChatPreferences();
  const previous = snapshot;
  snapshot = { ...snapshot, [key]: value };
  emit();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    snapshot = previous;
    emit();
    throw error;
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useChatPreferences = (): ChatPreferences => {
  useEffect(() => {
    void loadChatPreferences();
  }, []);
  return useSyncExternalStore(subscribe, getChatPreferencesSnapshot, getChatPreferencesSnapshot);
};
