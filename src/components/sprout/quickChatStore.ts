import { useSyncExternalStore } from 'react';
import type { QuickChatSheetProps } from './QuickChatSheet';

export type QuickChatOpenOptions = Omit<
  QuickChatSheetProps,
  'firstName' | 'focusRequestKey' | 'onClose'
> & {
  /** Lets a contextual entry point restore its surrounding UI after dismissal. */
  onDismiss?: () => void;
};

type QuickChatSnapshot = Readonly<{
  visible: boolean;
  focusRequestKey: number;
  options?: QuickChatOpenOptions;
}>;

let snapshot: QuickChatSnapshot = {
  visible: false,
  focusRequestKey: 0,
};

const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const openQuickChat = (options?: QuickChatOpenOptions) => {
  snapshot = {
    visible: true,
    focusRequestKey: snapshot.focusRequestKey + 1,
    options,
  };
  emit();
};

export const closeQuickChat = () => {
  if (!snapshot.visible) return;
  snapshot = {
    visible: false,
    focusRequestKey: snapshot.focusRequestKey,
    options: undefined,
  };
  emit();
};

export const getQuickChatSnapshot = (): QuickChatSnapshot => snapshot;

export const useQuickChatStore = (): QuickChatSnapshot =>
  useSyncExternalStore(subscribe, getQuickChatSnapshot, getQuickChatSnapshot);
