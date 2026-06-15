/** Web mock for context/PlatformConnectionsContext (real one uses socket.io + supabase realtime). */
import React from 'react';

const mockConnections = [
  { Id: 'conn_shopify', UserId: 'user_mock', PlatformType: 'shopify', DisplayName: 'My Shopify', Status: 'active', IsEnabled: true, CreatedAt: '', UpdatedAt: '' },
  { Id: 'conn_square', UserId: 'user_mock', PlatformType: 'square', DisplayName: 'My Square', Status: 'active', IsEnabled: true, CreatedAt: '', UpdatedAt: '' },
  { Id: 'conn_amazon', UserId: 'user_mock', PlatformType: 'amazon', DisplayName: 'My Amazon', Status: 'active', IsEnabled: true, CreatedAt: '', UpdatedAt: '' },
];

const connectedByPlatform: Record<string, boolean> = { shopify: true, square: true, amazon: true };

const value = {
  connections: mockConnections,
  liveConnections: mockConnections,
  progressByConnectionId: {},
  connectedByPlatform,
  isConnected: (p: string) => !!connectedByPlatform[String(p).toLowerCase()],
  refresh: async () => {},
  loading: false,
  error: undefined,
  toggles: {},
};

export const PlatformConnectionsProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const usePlatformConnections = () => value;
export default { PlatformConnectionsProvider, usePlatformConnections };
