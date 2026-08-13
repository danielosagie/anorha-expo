import type { PlatformConnectionRow } from '../context/PlatformConnectionsContext';

export const PLATFORM_CONNECTIONS_CACHE_PREFIX = 'sssync_platform_connections_cache_v1';

export function platformConnectionsCacheKey(ownerId: string): string {
  return `${PLATFORM_CONNECTIONS_CACHE_PREFIX}:${ownerId}`;
}

type PlatformConnectionsCachePayload = {
  ownerId: string;
  rows: PlatformConnectionRow[];
  savedAt: number;
};

export function serializePlatformConnectionsCache(
  ownerId: string,
  rows: PlatformConnectionRow[],
  savedAt = Date.now(),
): string {
  return JSON.stringify({ ownerId, rows, savedAt } satisfies PlatformConnectionsCachePayload);
}

export function parsePlatformConnectionsCache(
  raw: string | null,
  ownerId: string,
): PlatformConnectionRow[] | null {
  if (!raw || !ownerId) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlatformConnectionsCachePayload>;
    if (parsed.ownerId !== ownerId || !Array.isArray(parsed.rows)) return null;
    return parsed.rows.filter((row): row is PlatformConnectionRow => (
      !!row && typeof row.Id === 'string' && typeof row.PlatformType === 'string'
    ));
  } catch {
    return null;
  }
}
