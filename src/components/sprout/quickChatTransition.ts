import { useSyncExternalStore } from 'react';
import { Dimensions } from 'react-native';
import { makeMutable } from 'react-native-reanimated';

export const QUICK_CHAT_SHEET_HOST = 'sprout-quick-chat-sheet';
export const QUICK_CHAT_FULL_HOST = 'sprout-quick-chat-full';

export type QuickChatDestination = 'sheet' | 'full';

export type QuickChatFrame = {
  y: number;
  height: number;
};

type QuickChatTransitionState = {
  destination: QuickChatDestination;
  frame: QuickChatFrame;
  transitioning: boolean;
  phase: 'idle' | 'expanding' | 'collapsing';
};

const windowHeight = Dimensions.get('window').height;
let state: QuickChatTransitionState = {
  destination: 'sheet',
  frame: {
    y: Math.round(windowHeight * 0.45),
    height: Math.round(windowHeight * 0.55),
  },
  transitioning: false,
  phase: 'idle',
};

const listeners = new Set<() => void>();
let collapseHandler: (() => void) | null = null;

export const quickChatProgress = makeMutable(0);

const emit = (update: Partial<QuickChatTransitionState>) => {
  state = { ...state, ...update };
  listeners.forEach(listener => listener());
};

export const quickChatTransition = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  resetSheet: (frame?: QuickChatFrame) => {
    quickChatProgress.set(0);
    emit({
      destination: 'sheet',
      transitioning: false,
      phase: 'idle',
      ...(frame ? { frame } : {}),
    });
  },
  setFrame: (frame: QuickChatFrame) => emit({ frame }),
  beginFull: () => emit({ destination: 'full', transitioning: true, phase: 'expanding' }),
  finishFull: () => emit({ transitioning: false, phase: 'idle' }),
  beginCollapse: () => emit({ transitioning: true, phase: 'collapsing' }),
  finishCollapse: () => emit({ destination: 'sheet', transitioning: false, phase: 'idle' }),
  setCollapseHandler: (handler: (() => void) | null) => {
    collapseHandler = handler;
  },
  requestCollapse: () => collapseHandler?.(),
};

export const useQuickChatTransition = () =>
  useSyncExternalStore(
    quickChatTransition.subscribe,
    quickChatTransition.getSnapshot,
    quickChatTransition.getSnapshot,
  );
