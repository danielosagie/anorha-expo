import type { ImportStatusData, InboxRecentImport } from '../hooks/useImportStatus';

export interface ResumableCsvImport {
  connectionId: string;
  importId?: string;
  pendingItems: number;
  status: string;
}

const isCsvSource = (source: string) => {
  const normalized = source.toLowerCase();
  return normalized === 'csv' || normalized === 'csv_upload';
};

const newestCsvImportByConnection = (imports: InboxRecentImport[]) => {
  const byConnection = new Map<string, InboxRecentImport>();
  for (const entry of imports) {
    if (!entry.connectionId || !isCsvSource(entry.source)) continue;
    const current = byConnection.get(entry.connectionId);
    if (!current || entry.createdAt > current.createdAt) {
      byConnection.set(entry.connectionId, entry);
    }
  }
  return byConnection;
};

export function findResumableCsvImports(
  status: Pick<ImportStatusData, 'connections' | 'recentImports'>,
): ResumableCsvImport[] {
  const recentByConnection = newestCsvImportByConnection(status.recentImports);
  const entries = new Map<string, ResumableCsvImport>();

  for (const connection of status.connections) {
    if (connection.platformType?.toLowerCase() !== 'csv') continue;
    const recent = recentByConnection.get(connection.connectionId);
    const pendingItems = Math.max(0, connection.needsAttention);
    const importOpen = recent && recent.status.toLowerCase() !== 'complete';
    if (pendingItems <= 0 && !importOpen) continue;

    entries.set(connection.connectionId, {
      connectionId: connection.connectionId,
      importId: recent?.importId || undefined,
      pendingItems,
      status: recent?.status || connection.state,
    });
  }

  for (const recent of status.recentImports) {
    if (
      !recent.connectionId ||
      !isCsvSource(recent.source) ||
      recent.status.toLowerCase() === 'complete' ||
      entries.has(recent.connectionId)
    ) {
      continue;
    }
    entries.set(recent.connectionId, {
      connectionId: recent.connectionId,
      importId: recent.importId || undefined,
      pendingItems: Math.max(0, recent.itemsFailed),
      status: recent.status,
    });
  }

  return Array.from(entries.values()).sort((a, b) => b.pendingItems - a.pendingItems);
}
