import React from 'react';
import type { UserEntitlements } from '../utils/entitlements';

export type SessionUser = { id: string; email: string } | null;

export interface SessionContextType {
  ready: boolean;
  user: SessionUser;
  entitlements: UserEntitlements | null;
  refresh: () => Promise<void>;
}

export const SessionContext = React.createContext<SessionContextType | null>(null);








