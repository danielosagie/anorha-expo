import { useSyncExternalStore } from 'react';
import {
  initialSaveStatusState,
  SAVED_HOLD_MS,
  saveStatusReducer,
  type SaveStatusEvent,
  type SaveStatusState,
} from './saveStatusState';

/**
 * Module store rather than a context: saves fire from screens buried in stacks and from
 * sheets that outlive them, and the nav tag reads the same one truth from outside all of it.
 * Same shape as quickChatStore.
 */
let snapshot: SaveStatusState = initialSaveStatusState;
const listeners = new Set<() => void>();
let clearTimer: ReturnType<typeof setTimeout> | null = null;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function dispatch(event: SaveStatusEvent) {
  const next = saveStatusReducer(snapshot, event);
  if (next === snapshot) return;
  snapshot = next;

  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (snapshot.status === 'saved') {
    clearTimer = setTimeout(() => dispatch({ type: 'clear' }), SAVED_HOLD_MS);
  }

  listeners.forEach(listener => listener());
}

/**
 * Mark a save in flight. Returns the settle callback, which is safe to call more than once.
 * A double settle would otherwise leave the tag stuck on "Saving" while a sibling save runs.
 */
export function saveStarted(): (ok: boolean) => void {
  dispatch({ type: 'start' });
  let settled = false;
  return (ok: boolean) => {
    if (settled) return;
    settled = true;
    dispatch({ type: 'settle', ok, now: Date.now() });
  };
}

/** Sign-out and other hard resets: no save survives them, so neither should the tag. */
export function resetSaveStatus() {
  dispatch({ type: 'reset' });
}

export const getSaveStatusSnapshot = (): SaveStatusState => snapshot;

export const useSaveStatus = (): SaveStatusState =>
  useSyncExternalStore(subscribe, getSaveStatusSnapshot, getSaveStatusSnapshot);
