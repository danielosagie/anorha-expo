import React from 'react';
import type { UserEntitlements } from '../utils/entitlements';

export type SessionUser = { id: string; email: string } | null;
export type SessionBootstrapState = 'initializing' | 'ready' | 'degraded';
export type SessionMode = 'live' | 'cached';

export interface SessionContextType {
  ready: boolean;
  bridgeReady: boolean;
  user: SessionUser;
  entitlements: UserEntitlements | null;
  bootstrapState: SessionBootstrapState;
  usingCachedSession: boolean;
  sessionMode: SessionMode;
  bootstrapError: string | null;
  lastReadyAt: number | null;
  refresh: () => Promise<void>;
}

export const SessionContext = React.createContext<SessionContextType | null>(null);






