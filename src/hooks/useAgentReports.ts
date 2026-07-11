import { useCallback, useContext, useEffect, useState } from 'react';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { SessionContext } from '../context/SessionContext';
import { API_BASE_URL } from '../config/env';
import { createLogger } from '../utils/logger';
import type { ReportDocument } from '../features/liquidationConversation/types';

const log = createLogger('useAgentReports');

export type AgentReportSource = 'chat' | 'insight' | 'digest' | 'system';

export interface AgentReportRecord {
  id: string;
  documentId: string;
  source: AgentReportSource;
  sessionId?: string | null;
  threadId?: string | null;
  title: string;
  summary: string;
  document: ReportDocument;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

interface UseAgentReportsReturn {
  reports: AgentReportRecord[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  archiveReport: (reportId: string) => Promise<boolean>;
}

const normalizeReport = (raw: any): AgentReportRecord | null => {
  if (!raw || typeof raw !== 'object') return null;
  const document = raw.document;
  if (!document || !Array.isArray(document.sections)) return null;
  return {
    id: String(raw.id || document.documentId || ''),
    documentId: String(raw.documentId || document.documentId || ''),
    source: (['chat', 'insight', 'digest', 'system'] as const).includes(raw.source) ? raw.source : 'chat',
    sessionId: raw.sessionId || null,
    threadId: raw.threadId || null,
    title: String(raw.title || document.title || 'Report'),
    summary: String(raw.summary || document.summary || ''),
    document: {
      documentId: String(document.documentId || raw.documentId || ''),
      title: String(document.title || raw.title || 'Report'),
      summary: String(document.summary || raw.summary || ''),
      format: 'report',
      sections: document.sections,
    },
    status: raw.status === 'archived' ? 'archived' : 'active',
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || raw.createdAt || ''),
  };
};

/**
 * Org-wide list of agent-authored reports (chat reports, home insights,
 * campaign wrap-ups) from GET /api/agent/reports. Powers the Reports tab.
 */
export function useAgentReports(enabled = true): UseAgentReportsReturn {
  const session = useContext(SessionContext);
  const [reports, setReports] = useState<AgentReportRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    if (!enabled) return;
    if (!session?.bridgeReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Reports are temporarily unavailable.');

      const response = await fetch(`${API_BASE_URL}/api/agent/reports?limit=50`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to load reports (${response.status})`);
      }
      const data = await response.json();
      const normalized = (Array.isArray(data?.reports) ? data.reports : [])
        .map(normalizeReport)
        .filter((r: AgentReportRecord | null): r is AgentReportRecord => r !== null);
      setReports(normalized);
      setTotal(Number.isFinite(Number(data?.total)) ? Number(data.total) : normalized.length);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load reports';
      log.warn('[useAgentReports] fetch failed:', message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [enabled, session?.bridgeReady]);

  const archiveReport = useCallback(
    async (reportId: string): Promise<boolean> => {
      try {
        const token = await ensureSupabaseJwt();
        if (!token) return false;
        const response = await fetch(`${API_BASE_URL}/api/agent/reports/${encodeURIComponent(reportId)}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'archived' }),
        });
        if (!response.ok) return false;
        setReports((prev) => prev.filter((r) => r.id !== reportId && r.documentId !== reportId));
        setTotal((prev) => Math.max(0, prev - 1));
        return true;
      } catch (e) {
        log.warn('[useAgentReports] archive failed:', e instanceof Error ? e.message : e);
        return false;
      }
    },
    [],
  );

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return { reports, total, loading, error, refetch: fetchReports, archiveReport };
}
