import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import * as Haptics from 'expo-haptics';
import {
  initialToastState,
  toastReducer,
  type ToastInput,
  type ToastRecord,
} from './toastState';

type ToastContextValue = {
  toast: ToastRecord | null;
  activeHostId: string | null;
  showToast: (input: ToastInput) => void;
  dismissToast: (id?: number) => void;
  registerHost: (id: string, priority: number) => void;
  unregisterHost: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, initialToastState);
  const [activeHostId, setActiveHostId] = useState<string | null>(null);
  const hostsRef = useRef(new Map<string, { priority: number; order: number }>());
  const hostOrderRef = useRef(0);

  const resolveActiveHost = useCallback(() => {
    const hosts = Array.from(hostsRef.current.entries());
    hosts.sort((a, b) => b[1].priority - a[1].priority || b[1].order - a[1].order);
    setActiveHostId(hosts[0]?.[0] ?? null);
  }, []);

  const registerHost = useCallback((id: string, priority: number) => {
    const existing = hostsRef.current.get(id);
    hostsRef.current.set(id, {
      priority,
      order: existing?.order ?? ++hostOrderRef.current,
    });
    resolveActiveHost();
  }, [resolveActiveHost]);

  const unregisterHost = useCallback((id: string) => {
    hostsRef.current.delete(id);
    resolveActiveHost();
  }, [resolveActiveHost]);

  const showToast = useCallback((input: ToastInput) => {
    dispatch({ type: 'show', input, now: Date.now() });
    void Haptics.selectionAsync().catch(() => undefined);
  }, []);

  const dismissToast = useCallback((id?: number) => {
    dispatch({ type: 'dismiss', id });
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    toast: state.current,
    activeHostId,
    showToast,
    dismissToast,
    registerHost,
    unregisterHost,
  }), [
    activeHostId,
    dismissToast,
    registerHost,
    showToast,
    state.current,
    unregisterHost,
  ]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}

export function useToast() {
  const { showToast, dismissToast } = useToastContext();
  return useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);
}

export function useToastHostRegistration(id: string, enabled: boolean, priority: number) {
  const context = useToastContext();
  useEffect(() => {
    if (!enabled) {
      context.unregisterHost(id);
      return undefined;
    }
    context.registerHost(id, priority);
    return () => context.unregisterHost(id);
  }, [context.registerHost, context.unregisterHost, enabled, id, priority]);
  return context;
}

export type { ToastAction, ToastActionLabel, ToastInput, ToastTone } from './toastState';
