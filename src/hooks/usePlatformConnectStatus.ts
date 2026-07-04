// usePlatformConnectStatus — hook wrapper around derivePlatformConnectStatus.
//
// Wires the two live sources (platform connections + computer presence) so a
// single consumer (the connect flow, a connected-platform row) gets one truthful
// status. In a LIST, prefer calling useFacebookJobStatus() + usePlatformConnections()
// once at the screen and mapping rows through derivePlatformConnectStatus, to
// avoid one presence subscription per row.

import { useMemo } from 'react';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { useFacebookJobStatus } from './useFacebookJobStatus';
import {
  derivePlatformConnectStatus,
  type PlatformConnectStatus,
} from '../lib/platformConnectStatus';

export function usePlatformConnectStatus(platform: string): PlatformConnectStatus {
  const { liveConnections } = usePlatformConnections();
  const { computerOnline, presenceLoaded } = useFacebookJobStatus();
  return useMemo(
    () => derivePlatformConnectStatus(platform, liveConnections, { computerOnline, presenceLoaded }),
    [platform, liveConnections, computerOnline, presenceLoaded],
  );
}
