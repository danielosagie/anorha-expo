import { ConvexHttpClient } from 'convex/browser';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../../config/env';
import { clearThreadState, loadThreadState, persistThreadState, updateStoredThreadState } from './LocalConversationStore';
import type { ConversationDataAdapter } from './ConversationDataAdapter';
import {
  applyCampaignMetadata,
  applyThreadMetadata,
  hideCampaignLocal,
  hideThreadLocal,
  renameCampaignLocal,
  renameThreadLocal,
} from './LocalConversationMetadataStore';
import {
  createClientId,
  mergeRemoteMessages,
  retryFailedTurn,
} from './conversationState';
import type {
  CampaignConfig,
  CampaignConfigUpdate,
  CampaignItem,
  CampaignOverview,
  CampaignSummary,
  CampaignThreadSummary,
  ConversationMessage,
  CreateCampaignInput,
  CreateThreadInput,
  DecisionPrompt,
  DecisionSubmission,
  ItemStatus,
  NegotiationDecisionInput,
  QuestionPrompt,
  RunFlashCampaignInput,
  StreamTurnInput,
  StreamTurnObserver,
} from './types';
import { createLogger } from '../../utils/logger';
const log = createLogger('HybridConversationDataAdapter');


const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL || 'https://merry-buffalo-800.convex.cloud';

type NestSession = {
  id: string;
  status: CampaignSummary['status'];
  goal?: { targetRevenue?: number; timeframeDays?: number };
  state?: { phase?: string };
  createdAt: string;
  updatedAt: string;
  primaryThreadId?: string;
  /** First campaign item's image (backend list enrichment). */
  thumbnailUrl?: string;
  /** When the agent's next autonomous check is scheduled (ISO). */
  nextWakeAt?: string;
  /** Sold/total item counts (backend list enrichment) — drives the card progress bar. */
  stats?: { soldCount?: number; totalCount?: number; negotiating?: number };
};

type NestThread = {
  id: string;
  title?: string;
  status: CampaignThreadSummary['status'];
  isPrimary: boolean;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

type NestMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  timestamp?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

type NestConfig = {
  sessionId: string;
  orgId: string;
  targetRevenue: number;
  timeframeDays: number;
  aggressiveness: 'conservative' | 'balanced' | 'aggressive';
  inventoryScope: 'all' | 'pool' | 'specific';
  poolId?: string;
  productIds?: string[];
  guardrails: {
    minAcceptableOfferPercent: number;
    maxAutoPriceDropPercent: number;
    maxAutoCounterCountPerDay: number;
    autoExecuteWithinGuardrails: boolean;
  };
  updatedAt: string;
};

type StreamingEvent = {
  data?: string;
  message?: string;
};

class RequestError extends Error {
  statusCode?: number;
  payload?: any;

  constructor(message: string, options?: { statusCode?: number; payload?: any }) {
    super(message);
    this.name = 'RequestError';
    this.statusCode = options?.statusCode;
    this.payload = options?.payload;
  }
}

const getApiBaseUrl = () => API_BASE_URL;

const readString = (value: unknown) => (typeof value === 'string' ? value : undefined);

// Pull attached photo urls off a persisted message's metadata so they render as
// thumbnails in the chat history. The backend may store them under any of these
// keys depending on the turn type (seller-attached photos vs agent-posted job card).
const extractImageUrls = (metadata: Record<string, any> | undefined): string[] => {
  if (!metadata) return [];
  const candidates = [metadata.imageUrls, metadata.image_urls, metadata.images, metadata.photos];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      const urls = c.map(u => (typeof u === 'string' ? u : u?.url)).filter((u: unknown): u is string => typeof u === 'string' && !!u);
      if (urls.length) return urls;
    }
  }
  return [];
};

export class HybridConversationDataAdapter implements ConversationDataAdapter {
  private readonly convex = new ConvexHttpClient(CONVEX_URL);
  private readonly getClerkToken?: () => Promise<string | null>;
  private static readonly cacheWriteLocks = new Map<string, Promise<void>>();
  private static readonly lastCacheFingerprintByThread = new Map<string, string>();
  private static readonly inFlightCacheFingerprintByThread = new Map<string, string>();

  constructor(options?: { getClerkToken?: () => Promise<string | null> }) {
    this.getClerkToken = options?.getClerkToken;
  }

  async listCampaigns(): Promise<CampaignSummary[]> {
    const nest = await this.tryRequestNest<{ success: boolean; sessions: NestSession[] }>(
      '/api/agent/sessions?type=liquidation&status=active,waiting_user,paused,completed,failed',
    );
    const convexCampaigns = await this.safeConvexQuery<Array<any>>('campaigns:listCampaigns', {});
    const merged = new Map<string, CampaignSummary>();

    for (const session of nest?.sessions || []) {
      const campaign = this.mapCampaign(session);
      merged.set(campaign.id, campaign);
    }

    for (const row of convexCampaigns || []) {
      const campaign = this.mapCachedCampaign(row);
      if (!campaign.id) continue;
      const existing = merged.get(campaign.id);
      merged.set(campaign.id, {
        ...campaign,
        ...existing,
        title: campaign.title || existing?.title || 'Liquidation campaign',
        status: existing?.status || campaign.status,
        createdAt: existing?.createdAt || campaign.createdAt,
        updatedAt:
          existing && new Date(existing.updatedAt).getTime() >= new Date(campaign.updatedAt).getTime()
            ? existing.updatedAt
            : campaign.updatedAt,
        primaryThreadId: existing?.primaryThreadId || campaign.primaryThreadId,
      });
    }

    const combined = Array.from(merged.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    // Return the locally-decorated list (renames applied, hidden/deleted filtered
    // out) — ALWAYS, even when it's empty. The old `: combined` fallback resurrected
    // a just-deleted campaign whenever you removed your last one (an empty decorated
    // list fell back to the unfiltered set). An empty list is the correct state when
    // everything's been hidden/deleted.
    const decorated = await applyCampaignMetadata(combined);
    return decorated;
  }

  async listThreads(campaignId: string): Promise<CampaignThreadSummary[]> {
    const nest = await this.requestNest<{
      success: boolean;
      threads: NestThread[];
      primaryThreadId?: string;
    }>(`/api/agent/sessions/${campaignId}/threads`);

    const mapped = (nest.threads || []).map(thread => this.mapThread(campaignId, thread));
    const byId = new Map<string, CampaignThreadSummary>();
    for (const thread of mapped) {
      byId.set(thread.id, thread);
    }

    const convexThreads = await this.safeConvexQuery<Array<any>>('threads:listByCampaign', { campaignId });
    for (const row of convexThreads || []) {
      const id = String(row?.threadId || '');
      if (!id) continue;
      const existing = byId.get(id);
      byId.set(id, {
        id,
        campaignId,
        title: String(row?.title || existing?.title || 'New chat'),
        status: (row?.status || existing?.status || 'active') as CampaignThreadSummary['status'],
        isPrimary: existing?.isPrimary || id === nest.primaryThreadId,
        lastMessageAt: String(row?.lastMessageAt || existing?.lastMessageAt || new Date().toISOString()),
        updatedAt: String(row?.updatedAt || existing?.updatedAt || new Date().toISOString()),
        metadata: { ...(existing?.metadata || {}), ...(row?.metadata || {}) },
      });
    }

    const sorted = Array.from(byId.values()).sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );
    return applyThreadMetadata(campaignId, sorted);
  }

  async hydrateThread(campaignId: string, threadId: string): Promise<ConversationMessage[]> {
    const stored = await loadThreadState(campaignId, threadId);
    return stored.messages;
  }

  async getMessages(campaignId: string, threadId: string): Promise<ConversationMessage[]> {
    const stored = await loadThreadState(campaignId, threadId);
    const res = await this.requestNest<{
      success: boolean;
      messages: NestMessage[];
      threadId?: string;
    }>(`/api/agent/sessions/${campaignId}/messages?threadId=${encodeURIComponent(threadId)}`);
    const activeThreadId = res.threadId || threadId;
    const remoteMessages = (res.messages || [])
      .map(message => this.mapMessage(campaignId, activeThreadId, message))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const merged = mergeRemoteMessages(stored.messages, remoteMessages);
    await persistThreadState(
      {
        ...stored,
        campaignId,
        threadId: activeThreadId,
        messages: merged,
        partialAssistantText: '',
      },
      { immediate: true },
    );
    await this.enqueueCacheUpsert(campaignId, activeThreadId, merged);
    return merged;
  }

  async streamTurn(input: StreamTurnInput, observer: StreamTurnObserver): Promise<{ threadId: string }> {
    const token = await ensureSupabaseJwt();
    if (!token) {
      const error = new Error('Not authenticated');
      observer.onError?.(error);
      throw error;
    }

    const url = `${getApiBaseUrl()}/api/agent/sessions/${input.campaignId}/turns/stream`;
    let resolvedThreadId = input.threadId || '';
    let completed = false;
    let actionCompletionTimer: ReturnType<typeof setTimeout> | null = null;
    let assistantStreamStarted = false;
    let fallbackTriggered = false;
    // The server accepted the turn (ack / any assistant output). Once true, a dropped
    // socket is recoverable: the turn is running/finished server-side, so we poll for
    // the completed reply instead of re-posting (which would duplicate the turn) or
    // marking the message failed.
    let turnAccepted = false;
    let openRetried = false;

    return new Promise<{ threadId: string }>((resolve, reject) => {
      const EventSource = require('react-native-sse').default as any;
      let source: any = null;

      const finish = (resultThreadId?: string) => {
        if (completed) return;
        completed = true;
        if (actionCompletionTimer) {
          clearTimeout(actionCompletionTimer);
          actionCompletionTimer = null;
        }
        source?.close();
        resolve({ threadId: resultThreadId || resolvedThreadId || input.threadId || '' });
      };

      const fail = (error: Error) => {
        if (completed) return;
        completed = true;
        if (actionCompletionTimer) {
          clearTimeout(actionCompletionTimer);
          actionCompletionTimer = null;
        }
        source?.close();
        observer.onError?.(error);
        reject(error);
      };

      // A genuinely missing stream endpoint (404): the turn never ran, so re-post it.
      const triggerFallback = async (errorText?: string) => {
        if (completed || fallbackTriggered) return;
        fallbackTriggered = true;
        if (actionCompletionTimer) {
          clearTimeout(actionCompletionTimer);
          actionCompletionTimer = null;
        }
        source?.close();
        try {
          const result = await this.streamTurnFallback(input, observer, errorText);
          completed = true;
          resolve(result);
        } catch (fallbackError) {
          const error = fallbackError instanceof Error ? fallbackError : new Error('Fallback turn failed');
          completed = true;
          observer.onError?.(error);
          reject(error);
        }
      };

      // A mid-stream socket drop AFTER the server accepted the turn. Do NOT re-post —
      // poll the thread for the completed reply so the answer lands without a scary
      // "Failed / network connection lost" banner.
      const recoverAfterDrop = async (errorText?: string) => {
        if (completed || fallbackTriggered) return;
        fallbackTriggered = true;
        if (actionCompletionTimer) {
          clearTimeout(actionCompletionTimer);
          actionCompletionTimer = null;
        }
        source?.close();
        try {
          const result = await this.recoverCompletedTurn(input, observer, resolvedThreadId);
          completed = true;
          resolve(result);
        } catch (recoverError) {
          fail(recoverError instanceof Error ? recoverError : new Error(errorText || 'Streaming connection failed'));
        }
      };

      const handleMessage = (event: StreamingEvent) => {
        const raw = typeof event.data === 'string' ? event.data : '';
        // A keep-alive ping, an SSE comment, a sentinel, or a split/garbled chunk
        // is not a turn failure. Skip the single event instead of tearing down the
        // whole stream (the prior code called fail() here, which is what made the
        // chat "crash" mid-response).
        if (!raw || raw === 'undefined' || raw === '[DONE]' || raw.startsWith(':')) return;
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return; // un-parseable event, ignore and keep streaming
        }
        try {
          const type = readString(parsed.type) || readString(parsed.event);
          const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : parsed;
          const threadId = readString(payload.threadId);
          if (threadId) {
            resolvedThreadId = threadId;
          }

          switch (type) {
            case 'thread.created':
              if (threadId) {
                observer.onThreadCreated?.(threadId);
              }
              break;
            case 'message.ack':
              turnAccepted = true;
              observer.onMessageAck?.({
                clientMessageId: readString(payload.clientMessageId) || input.clientMessageId,
                serverMessageId: readString(payload.serverMessageId) || readString(payload.messageId),
                threadId,
              });
              break;
            case 'assistant.started':
              assistantStreamStarted = true;
              turnAccepted = true;
              if (actionCompletionTimer) {
                clearTimeout(actionCompletionTimer);
                actionCompletionTimer = null;
              }
              observer.onAssistantStarted?.({
                messageId: readString(payload.messageId) || readString(payload.assistantMessageId),
                threadId,
              });
              break;
            case 'assistant.delta':
              turnAccepted = true;
              observer.onAssistantDelta?.({
                delta: readString(payload.delta) || readString(payload.content) || '',
                messageId: readString(payload.messageId) || readString(payload.assistantMessageId),
                threadId,
              });
              break;
            case 'assistant.completed':
              observer.onAssistantCompleted?.({
                messageId: readString(payload.messageId) || readString(payload.assistantMessageId),
                content: readString(payload.content),
                threadId,
              });
              finish(threadId);
              break;
            case 'assistant.reasoning':
              // Optional thinking trace — rendered in the collapsible activity card.
              // Absent for non-thinking models; harmless when never emitted.
              observer.onReasoning?.({
                reasoning: readString(payload.reasoning) || readString(payload.delta) || readString(payload.content) || '',
                messageId: readString(payload.messageId) || readString(payload.assistantMessageId),
                threadId,
              });
              break;
            case 'tool.completed':
              turnAccepted = true;
              // A finished agent tool — arg-free by contract. Surfaces as a step item.
              observer.onToolCompleted?.({
                tool: readString(payload.tool) || 'tool',
                label: readString(payload.label) || readString(payload.tool) || 'Step',
                status: readString(payload.status) || 'success',
                durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
                resultSummary: readString(payload.resultSummary) || undefined,
                // Structured value changes (price/status diffs) so the diff card renders
                // live, not only after a cold reload. Arg-free + already humanized server-side.
                ...((payload as any).resultDetail && typeof (payload as any).resultDetail === 'object' ? { resultDetail: (payload as any).resultDetail } : {}),
                ...(Array.isArray((payload as any).changes) ? { changes: (payload as any).changes } : {}),
                ...(readString((payload as any).reason) ? { reason: readString((payload as any).reason) } : {}),
                ...((payload as any).itemRef && typeof (payload as any).itemRef === 'object' ? { itemRef: (payload as any).itemRef } : {}),
                ...((payload as any).undo && typeof (payload as any).undo === 'object' ? { undo: (payload as any).undo } : {}),
                // An agent-authored report (create_report / revise_report). Ingesting it
                // live lets the report card render as the turn streams; without this the
                // report only appeared after a cold reload (toolSteps[].document), which
                // read as "the tool call came out empty".
                ...((payload as any).document && typeof (payload as any).document === 'object' && Array.isArray((payload as any).document.sections)
                  ? { document: (payload as any).document }
                  : {}),
                // A proposed plan (propose_plan) → rendered as an approvable card in the
                // conversation; pendingActionId is what Approve/Revise hit.
                ...((payload as any).plan && typeof (payload as any).plan === 'object' && typeof (payload as any).plan.title === 'string'
                  ? { plan: (payload as any).plan }
                  : {}),
                threadId,
              });
              break;
            case 'action.completed':
              turnAccepted = true;
              observer.onActionCompleted?.({
                clientMessageId: readString(payload.clientMessageId) || input.clientMessageId,
                actionType: readString(payload.actionType) || input.actionType,
                summary: readString(payload.summary) || readString(payload.content),
                threadId,
              });
              if (input.kind === 'action' && !assistantStreamStarted && !actionCompletionTimer) {
                actionCompletionTimer = setTimeout(() => finish(threadId), 250);
              }
              break;
            case 'error':
              fail(new Error(readString(payload.message) || 'Streaming turn failed'));
              break;
            default:
              break;
          }
        } catch {
          // A handler threw (e.g. a transient state update). Drop this one event;
          // do not fail the turn — the stream finishes on assistant.completed / error.
          return;
        }
      };

      const handleError = (event: StreamingEvent) => {
        const errorMessage =
          readString((event as any)?.message) ||
          readString((event as any)?.data) ||
          'Streaming connection failed';
        // The route itself is missing (404) — re-post the turn through the non-stream path.
        if (this.isMissingStreamEndpointError(errorMessage)) {
          void triggerFallback(errorMessage);
          return;
        }
        // The server already took the turn — recover the finished reply by polling,
        // not by re-posting (which would run the turn twice).
        if (turnAccepted) {
          void recoverAfterDrop(errorMessage);
          return;
        }
        // Dropped before the server even accepted the turn — classic iOS -1005 on a
        // stale pooled socket. Retry the connection once before giving up.
        if (!openRetried && this.isTransientConnectionError(errorMessage)) {
          openRetried = true;
          try { source?.close(); } catch { /* socket already gone */ }
          connect();
          return;
        }
        fail(new Error(errorMessage));
      };

      const connect = () => {
        source = new EventSource(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            threadId: input.threadId || undefined,
            clientMessageId: input.clientMessageId,
            kind: input.kind,
            content: input.content,
            actionType: input.actionType,
            actionPayload: input.actionPayload,
            imageUrls: input.imageUrls,
            kickoff: input.kickoff || undefined,
          }),
        } as any);
        source.addEventListener('message', handleMessage);
        source.addEventListener('error', handleError);
      };

      connect();
    });
  }

  async persistDraft(campaignId: string, threadId: string, draft: string): Promise<void> {
    await updateStoredThreadState(campaignId, threadId, state => ({
      ...state,
      draft,
      updatedAt: new Date().toISOString(),
    }));
  }

  async retryFailedMessage(campaignId: string, threadId: string, clientMessageId: string): Promise<void> {
    await updateStoredThreadState(campaignId, threadId, state => retryFailedTurn(state, clientMessageId));
  }

  async createCampaign(input: CreateCampaignInput): Promise<CampaignSummary> {
    const quick = await this.requestNest<{
      success: boolean;
      sessionId: string;
      primaryThreadId?: string;
    }>('/api/agent/quick/liquidation', {
      method: 'POST',
      body: JSON.stringify({
        targetRevenue: input.targetRevenue,
        timeframeDays: input.timeframeDays,
        poolId: input.poolId,
        inventoryScope: input.inventoryScope,
        productIds: input.productIds,
        aggressiveness: input.aggressiveness || 'balanced',
      }),
    });

    const detail = await this.requestNest<{
      success: boolean;
      session: NestSession;
      primaryThreadId?: string;
    }>(`/api/agent/sessions/${quick.sessionId}`);
    const campaign = this.mapCampaign(detail.session);
    const primaryThreadId = detail.primaryThreadId || detail.session.primaryThreadId || quick.primaryThreadId || `primary-${campaign.id}`;

    await this.safeConvexMutation('campaigns:upsertFromSession', {
      campaignId: campaign.id,
      sessionId: campaign.id,
      title: input.title || campaign.title,
      status: campaign.status,
      primaryThreadId,
      metadata: {
        targetRevenue: input.targetRevenue,
        timeframeDays: input.timeframeDays,
      },
    });

    await this.safeConvexMutation('threads:create', {
      campaignId: campaign.id,
      threadId: primaryThreadId,
      title: 'Primary',
      isPrimary: true,
    });

    return {
      ...campaign,
      primaryThreadId,
    };
  }

  async getCampaignItems(campaignId: string): Promise<CampaignItem[]> {
    const res = await this.requestNest<{
      success: boolean;
      items: Array<{
        id: string;
        productId: string;
        name: string;
        channels: string;
        currentPrice: number;
        floorPrice?: number;
        status: string;
        imageUrl?: string;
        sku?: string;
        totalQuantity?: number;
        lastSyncedAt?: string | null;
        isStale?: boolean;
      }>;
    }>(`/api/agent/sessions/${campaignId}/items`);
    return (res.items || []).map(it => ({
      id: it.id,
      productId: it.productId,
      name: it.name,
      channels: it.channels || '',
      currentPrice: it.currentPrice,
      floorPrice: it.floorPrice,
      status: (it.status as ItemStatus) || 'listed',
      imageUrl: it.imageUrl,
      sku: it.sku,
      totalQuantity: it.totalQuantity,
      lastSyncedAt: it.lastSyncedAt,
      isStale: it.isStale,
    }));
  }

  async addCampaignItems(campaignId: string, variantIds: string[]): Promise<{ added: number; skipped: number }> {
    const res = await this.requestNest<{ success: boolean; added: number; skipped: number }>(
      `/api/agent/sessions/${campaignId}/items`,
      { method: 'POST', body: JSON.stringify({ variantIds }) },
    );
    return { added: res.added || 0, skipped: res.skipped || 0 };
  }

  /** Remove items from a campaign by campaign-item id (these are CampaignItem.id values). */
  async removeCampaignItems(campaignId: string, itemIds: string[]): Promise<{ removed: number }> {
    const res = await this.requestNest<{ success: boolean; removed: number }>(
      `/api/agent/sessions/${campaignId}/items`,
      { method: 'DELETE', body: JSON.stringify({ itemIds }) },
    );
    return { removed: res.removed || 0 };
  }

  /** Update campaign items in place (new price, per-item floor, and/or status). */
  async updateCampaignItems(
    campaignId: string,
    itemIds: string[],
    changes: { price?: number; floorPrice?: number; status?: string },
  ): Promise<{ updated: number }> {
    const res = await this.requestNest<{ success: boolean; updated: number }>(
      `/api/agent/sessions/${campaignId}/items`,
      { method: 'PATCH', body: JSON.stringify({ itemIds, ...changes }) },
    );
    return { updated: res.updated || 0 };
  }

  async createThread(campaignId: string, input: CreateThreadInput): Promise<CampaignThreadSummary> {
    const threadId = `thread-${Date.now()}`;
    const created = await this.requestNest<{ success: boolean; thread: NestThread }>(
      `/api/agent/sessions/${campaignId}/threads`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: input.title || 'New chat',
          threadId,
          metadata: { source: 'mobile_conversation_shell_v2' },
        }),
      },
    );

    await this.safeConvexMutation('threads:create', {
      campaignId,
      threadId: created.thread.id || threadId,
      title: created.thread.title || input.title || 'New chat',
      isPrimary: false,
    });

    return this.mapThread(campaignId, created.thread);
  }

  async renameCampaign(campaignId: string, title: string): Promise<CampaignSummary> {
    await renameCampaignLocal(campaignId, title);
    await this.tryRequestNest(`/api/agent/sessions/${campaignId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    await this.safeConvexMutation('campaigns:rename', { campaignId, title });
    const list = await this.listCampaigns().catch(() => []);
    return list.find(campaign => campaign.id === campaignId) || {
      id: campaignId,
      title,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      primaryThreadId: `primary-${campaignId}`,
    };
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    await hideCampaignLocal(campaignId);
    await this.tryRequestNest(`/api/agent/sessions/${campaignId}`, {
      method: 'DELETE',
    });
    await this.safeConvexMutation('campaigns:remove', { campaignId });
    await this.safeConvexMutation('threads:removeByCampaign', { campaignId });
  }

  // Pause/resume a campaign from the home screen (PATCH the session status).
  async setCampaignStatus(campaignId: string, status: CampaignSummary['status']): Promise<void> {
    await this.tryRequestNest(`/api/agent/sessions/${campaignId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async renameThread(campaignId: string, threadId: string, title: string): Promise<CampaignThreadSummary> {
    await renameThreadLocal(campaignId, threadId, title);
    await this.tryRequestNest(`/api/agent/sessions/${campaignId}/threads/${threadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    await this.safeConvexMutation('threads:updateMeta', { threadId, title });
    const list = await this.listThreads(campaignId).catch(() => []);
    return list.find(thread => thread.id === threadId) || {
      id: threadId,
      campaignId,
      title,
      status: 'active',
      isPrimary: false,
      lastMessageAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async deleteThread(campaignId: string, threadId: string): Promise<void> {
    await hideThreadLocal(campaignId, threadId);
    await clearThreadState(campaignId, threadId).catch(() => undefined);
    await this.tryRequestNest(`/api/agent/sessions/${campaignId}/threads/${threadId}`, {
      method: 'DELETE',
    });
    await this.safeConvexMutation('threads:remove', { threadId });
  }

  async submitDecision(campaignId: string, threadId: string, decision: DecisionSubmission): Promise<void> {
    if (decision.action === 'approve' && decision.strategyId) {
      await this.requestNest(`/api/liquidation/strategies/${decision.strategyId}/approve`, {
        method: 'POST',
      });
      await this.requestNest(`/api/liquidation/strategies/${decision.strategyId}/execute`, {
        method: 'POST',
      });
      return;
    }

    // Generic plan (propose_plan pending action): approve runs the bundled action via the
    // backend executor; revise/follow_up reject the proposal and send the seller's note so
    // Sprout re-plans. Keyed by planId (the pending-action id), not a thread.
    if (decision.planId) {
      if (decision.action === 'approve') {
        await this.requestNest(`/api/agent/sessions/${campaignId}/pending-actions/${decision.planId}/approve`, {
          method: 'POST',
          body: JSON.stringify({ note: decision.content }),
        });
        return;
      }
      // Drop the proposed plan (best-effort) before sending the seller's revision note below.
      await this.requestNest(`/api/agent/sessions/${campaignId}/pending-actions/${decision.planId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ note: decision.content }),
      }).catch(() => undefined);
    }

    const fallbackContent =
      decision.action === 'revise'
        ? 'Please revise the strategy with a more conservative execution path.'
        : decision.action === 'follow_up'
          ? 'Can you provide a quick risk/reward comparison before we proceed?'
          : 'Approved. Proceed with the strategy.';

    await this.requestNest(`/api/agent/sessions/${campaignId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: decision.content || fallbackContent,
        threadId,
        // Stable across a retry/double-tap so the backend and the local merge can
        // recognize this as one decision instead of creating duplicate user turns.
        clientMessageId: `decision:${decision.decisionId}:${decision.action}`.slice(0, 180),
      }),
    });
  }

  // Load questions and plans together. The previous implementation fetched the
  // same endpoint up to four times per message: scoped + campaign-wide for each
  // prompt type. A single campaign-wide read can preserve the same behavior by
  // ranking actions from the visible thread first, then newest campaign-wide.
  async getPendingPrompts(
    campaignId: string,
    threadId: string,
  ): Promise<{ question: QuestionPrompt | null; plan: DecisionPrompt | null }> {
    const response = await this.requestNest<{ success: boolean; pendingActions?: any[] }>(
      `/api/agent/sessions/${campaignId}/pending-actions`,
    ).catch(() => null);
    const actions = (response?.pendingActions || [])
      .filter((action) => action?.status !== 'completed' && action?.status !== 'rejected')
      .sort((a, b) => {
        const threadPriority = Number(b?.threadId === threadId) - Number(a?.threadId === threadId);
        if (threadPriority !== 0) return threadPriority;
        return String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''));
      });

    const questionAction = actions.find((action) => action?.toolName === 'ask_seller_question');
    const questions = questionAction?.input?.questions;
    const question = questionAction && Array.isArray(questions) && questions.length > 0
      ? { pendingActionId: questionAction.id, threadId: questionAction.threadId, questions }
      : null;

    const planAction = actions.find((action) => action?.toolName === 'propose_plan' && action?.input?.title);
    const input = planAction?.input;
    const plan: DecisionPrompt | null = planAction
      ? {
          id: planAction.id,
          kind: 'approve',
          planId: planAction.id,
          title: String(input.title),
          summary: typeof input.summary === 'string' ? input.summary : undefined,
          description: typeof input.summary === 'string' ? input.summary : undefined,
          planType: typeof input.planType === 'string' ? input.planType : undefined,
          steps: Array.isArray(input.steps)
            ? input.steps
                .filter((step: any) => step && typeof step.title === 'string')
                .map((step: any) => ({
                  title: String(step.title),
                  detail: typeof step.detail === 'string' ? step.detail : undefined,
                }))
            : undefined,
          strategyId: typeof input.strategyId === 'string' ? input.strategyId : undefined,
          approveLabel: 'Approve',
          reviseLabel: 'Revise',
          followUpLabel: 'Follow-up',
        }
      : null;

    return { question, plan };
  }

  // Record a thumbs up/down on an assistant reply (null clears it). Fire-and-forget
  // from the caller's view — feedback is a signal, never worth blocking the UI on.
  async submitMessageFeedback(
    campaignId: string,
    messageId: string,
    vote: 'up' | 'down' | null,
    threadId?: string,
  ): Promise<void> {
    await this.requestNest(
      `/api/agent/sessions/${campaignId}/messages/${encodeURIComponent(messageId)}/feedback`,
      { method: 'POST', body: JSON.stringify({ vote, threadId }) },
    );
  }

  // Record the seller's answer (does NOT resume the turn — the controller sends
  // the chosen text as a normal message so Sprout replies with full streaming).
  async answerQuestion(
    campaignId: string,
    pendingActionId: string,
    answer: { answers?: Record<string, string[]>; other?: string; text?: string },
  ): Promise<void> {
    await this.requestNest(
      `/api/agent/sessions/${campaignId}/pending-actions/${pendingActionId}/answer`,
      { method: 'POST', body: JSON.stringify(answer) },
    );
  }

  async getCampaignConfig(campaignId: string): Promise<CampaignConfig> {
    const res = await this.requestNest<{ success: boolean; config: NestConfig }>(
      `/api/agent/sessions/${campaignId}/config`,
    );
    return {
      ...res.config,
      productIds: res.config.productIds || [],
    };
  }

  async updateCampaignConfig(campaignId: string, update: CampaignConfigUpdate): Promise<CampaignConfig> {
    const res = await this.requestNest<{ success: boolean; config: NestConfig }>(
      `/api/agent/sessions/${campaignId}/config`,
      {
        method: 'PATCH',
        body: JSON.stringify(update),
      },
    );
    return {
      ...res.config,
      productIds: res.config.productIds || [],
    };
  }

  async getCampaignOverview(campaignId: string): Promise<CampaignOverview> {
    const res = await this.requestNest<{ success: boolean; overview: CampaignOverview }>(
      `/api/agent/sessions/${campaignId}/overview`,
    );
    return res.overview;
  }

  async findSlowMovers(campaignId: string): Promise<{ count: number; items: Array<Record<string, unknown>> }> {
    const res = await this.requestNest<{ success: boolean; count: number; items: Array<Record<string, unknown>> }>(
      `/api/agent/sessions/${campaignId}/actions/find-slow-movers`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    return { count: res.count, items: res.items || [] };
  }

  async runFlashCampaign(campaignId: string, input: RunFlashCampaignInput): Promise<{ updated: number }> {
    const res = await this.requestNest<{ success: boolean; updated: number }>(
      `/api/agent/sessions/${campaignId}/actions/run-flash-campaign`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
    return { updated: res.updated || 0 };
  }

  async submitNegotiationDecision(
    campaignId: string,
    input: NegotiationDecisionInput,
  ): Promise<{ status: string }> {
    const res = await this.requestNest<{ success: boolean; status: string }>(
      `/api/agent/sessions/${campaignId}/actions/negotiation-decision`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
    return { status: res.status || 'ok' };
  }

  private async requestNest<T = any>(path: string, init?: RequestInit): Promise<T> {
    const token = await ensureSupabaseJwt();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new RequestError(
        data?.message || `Request failed (${response.status})`,
        { statusCode: response.status, payload: data },
      );
    }

    return response.json();
  }

  private async tryRequestNest<T = any>(path: string, init?: RequestInit): Promise<T | null> {
    try {
      return await this.requestNest<T>(path, init);
    } catch (error) {
      log.debug('[HybridAdapter] Nest request skipped:', path, error);
      return null;
    }
  }

  private isMissingStreamEndpointError(errorMessage: string) {
    return errorMessage.includes('Cannot POST') || errorMessage.includes('"statusCode":404') || errorMessage.includes('404');
  }

  /** iOS reuses pooled HTTP connections; the first request on a stale socket fails with
   *  -1005 "The network connection was lost." These are transient and worth one retry. */
  private isTransientConnectionError(errorMessage: string) {
    const m = (errorMessage || '').toLowerCase();
    return (
      m.includes('network connection was lost') ||
      m.includes('-1005') ||
      m.includes('connection failed') ||
      m.includes('network request failed') ||
      m.includes('timed out') ||
      m.includes('timeout')
    );
  }

  /** Recover a turn whose socket dropped after the server accepted it: poll the thread
   *  for the freshly-completed assistant reply (it may still be finishing as we poll) and
   *  emit it, without re-posting the turn. Throws only if nothing lands in time. */
  private async recoverCompletedTurn(
    input: StreamTurnInput,
    observer: StreamTurnObserver,
    resolvedThreadId: string,
  ): Promise<{ threadId: string }> {
    const threadId = resolvedThreadId || input.threadId || '';
    if (!threadId) throw new Error('Streaming connection was lost.');
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    for (let attempt = 0; attempt < 6; attempt++) {
      await delay(attempt === 0 ? 700 : 1300);
      const messages = await this.getMessages(input.campaignId, threadId).catch(() => [] as any[]);
      const latestAssistant = messages
        .slice()
        .reverse()
        .find(message => message.role === 'assistant' && (message.content || '').trim().length > 0);
      if (latestAssistant) {
        const rid = latestAssistant.threadId || threadId;
        // Re-emit under the server's message id so it lands on the same bubble the
        // partial stream created (no duplicate), then completes it.
        observer.onAssistantStarted?.({ messageId: latestAssistant.id, threadId: rid });
        observer.onAssistantCompleted?.({ messageId: latestAssistant.id, content: latestAssistant.content, threadId: rid });
        return { threadId: rid };
      }
    }
    throw new Error('Streaming connection was lost.');
  }

  private async streamTurnFallback(
    input: StreamTurnInput,
    observer: StreamTurnObserver,
    errorText?: string,
  ): Promise<{ threadId: string }> {
    if (input.kind === 'action') {
      return this.streamActionFallback(input, observer);
    }

    const response = await this.requestNest<any>(`/api/agent/sessions/${input.campaignId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: input.content,
        threadId: input.threadId,
        clientMessageId: input.clientMessageId,
        imageUrls: input.imageUrls,
      }),
    });

    const threadId = readString(response?.threadId) || input.threadId || '';
    if (threadId && threadId !== input.threadId) {
      observer.onThreadCreated?.(threadId);
    }
    observer.onMessageAck?.({
      clientMessageId: input.clientMessageId,
      serverMessageId: readString(response?.messageId) || readString(response?.userMessageId),
      threadId,
    });

    const assistantContent =
      readString(response?.response) ||
      readString(response?.assistantResponse) ||
      readString(response?.message) ||
      '';

    if (assistantContent) {
      const assistantId = createClientId('assistant-fallback');
      observer.onAssistantStarted?.({ messageId: assistantId, threadId });
      observer.onAssistantDelta?.({ delta: assistantContent, messageId: assistantId, threadId });
      observer.onAssistantCompleted?.({ messageId: assistantId, content: assistantContent, threadId });
      return { threadId };
    }

    const messages = await this.getMessages(input.campaignId, threadId || input.threadId || '');
    const latestAssistant = messages
      .slice()
      .reverse()
      .find(message => message.role === 'assistant');

    if (latestAssistant) {
      observer.onAssistantStarted?.({ messageId: latestAssistant.id, threadId: latestAssistant.threadId });
      observer.onAssistantDelta?.({
        delta: latestAssistant.content,
        messageId: latestAssistant.id,
        threadId: latestAssistant.threadId,
      });
      observer.onAssistantCompleted?.({
        messageId: latestAssistant.id,
        content: latestAssistant.content,
        threadId: latestAssistant.threadId,
      });
      return { threadId: latestAssistant.threadId };
    }

    if (errorText) {
      throw new Error(errorText);
    }
    return { threadId };
  }

  private async streamActionFallback(
    input: StreamTurnInput,
    observer: StreamTurnObserver,
  ): Promise<{ threadId: string }> {
    const threadId = input.threadId || '';
    let summary = input.content || 'Action completed';

    switch (input.actionType) {
      case 'find_slow_movers': {
        const result = await this.findSlowMovers(input.campaignId);
        summary = `Found ${result.count} slow movers ready for review.`;
        break;
      }
      case 'run_flash_campaign': {
        const result = await this.runFlashCampaign(input.campaignId, {
          discountPercent: Number(input.actionPayload?.discountPercent || 15),
          durationHours: Number(input.actionPayload?.durationHours || 24),
          reason: typeof input.actionPayload?.reason === 'string' ? input.actionPayload.reason : 'manual_run',
        });
        summary = `Flash campaign updated ${result.updated} items.`;
        break;
      }
      case 'negotiation_accept':
      case 'negotiation_counter':
      case 'negotiation_let_agent': {
        const action = String(input.actionPayload?.action || '').toLowerCase() as NegotiationDecisionInput['action'];
        const result = await this.submitNegotiationDecision(input.campaignId, {
          action: action || 'let_agent',
          threadId,
        });
        summary = `Negotiation action sent: ${result.status}.`;
        break;
      }
      default: {
        await this.requestNest(`/api/agent/sessions/${input.campaignId}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            content: input.content || input.actionType || 'Action requested',
            threadId,
            clientMessageId: input.clientMessageId,
          }),
        });
      }
    }

    observer.onActionCompleted?.({
      clientMessageId: input.clientMessageId,
      actionType: input.actionType,
      summary,
      threadId,
    });
    const assistantId = createClientId('assistant-fallback');
    observer.onAssistantStarted?.({ messageId: assistantId, threadId });
    observer.onAssistantDelta?.({ delta: summary, messageId: assistantId, threadId });
    observer.onAssistantCompleted?.({ messageId: assistantId, content: summary, threadId });
    return { threadId };
  }

  private mapCampaign(session: NestSession): CampaignSummary {
    const target = session.goal?.targetRevenue;
    const timeframe = session.goal?.timeframeDays;
    const title = target && timeframe
      ? `Liquidation $${target.toLocaleString()} / ${timeframe}d`
      : 'Liquidation campaign';

    return {
      id: session.id,
      title,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      primaryThreadId: session.primaryThreadId || `primary-${session.id}`,
      stateSummary: session.state?.phase ? `Phase: ${session.state.phase}` : undefined,
      timeframeDays: timeframe,
      imageUrl: session.thumbnailUrl,
      nextWakeAt: session.nextWakeAt,
      stats: session.stats,
    };
  }

  private mapCachedCampaign(row: any): CampaignSummary {
    const campaignId = String(row?.campaignId || row?.sessionId || '');
    const updatedAt = typeof row?.updatedAt === 'number' ? new Date(row.updatedAt).toISOString() : new Date().toISOString();
    const createdAt = typeof row?.createdAt === 'number' ? new Date(row.createdAt).toISOString() : updatedAt;

    return {
      id: campaignId,
      title: String(row?.title || 'Liquidation campaign'),
      status: String(row?.status || 'active') as CampaignSummary['status'],
      createdAt,
      updatedAt,
      primaryThreadId: String(row?.primaryThreadId || `primary-${campaignId}`),
      timeframeDays: typeof row?.metadata?.timeframeDays === 'number' ? row.metadata.timeframeDays : undefined,
    };
  }

  private mapThread(campaignId: string, thread: NestThread): CampaignThreadSummary {
    return {
      id: thread.id,
      campaignId,
      title: thread.title || (thread.isPrimary ? 'Primary' : 'New chat'),
      status: thread.status || 'active',
      isPrimary: thread.isPrimary,
      lastMessageAt: thread.updatedAt,
      updatedAt: thread.updatedAt,
      metadata: thread.metadata || {},
    };
  }

  private mapMessage(campaignId: string, threadId: string, message: NestMessage): ConversationMessage {
    const role = message.role === 'tool'
      ? 'assistant'
      : (message.role as ConversationMessage['role']);
    const createdAt = message.timestamp || message.createdAt || new Date().toISOString();
    const metadata = message.metadata || {};
    const kind = metadata.type === 'action' ? 'action' : 'text';
    const imageUrls = extractImageUrls(metadata);

    return {
      id: message.id,
      serverMessageId: message.id,
      clientMessageId: readString(metadata.clientMessageId) || readString(metadata.client_message_id),
      campaignId,
      threadId: typeof metadata.threadId === 'string' ? metadata.threadId : threadId,
      role,
      content: message.content || '',
      createdAt,
      deliveryState: 'sent',
      kind,
      ...(imageUrls.length ? { imageUrls } : {}),
      metadata,
      actionMeta: kind === 'action'
        ? {
            actionType: readString(metadata.actionType) || 'action',
            status: 'completed',
            summary: readString(metadata.summary),
          }
        : undefined,
      decisionPrompt: this.deriveDecisionPrompt(message),
    };
  }

  private deriveDecisionPrompt(message: NestMessage): DecisionPrompt | undefined {
    const metadata = message.metadata || {};
    const content = (message.content || '').toLowerCase();
    const metadataType = typeof metadata.type === 'string' ? metadata.type : '';
    const isDecision =
      metadataType === 'approval_request' ||
      content.includes('approve strategy') ||
      content.includes('say yes') ||
      content.includes('approve this plan');

    if (!isDecision || message.role !== 'assistant') {
      return undefined;
    }

    return {
      id: message.id,
      kind: 'approve',
      title: 'Decision needed',
      description: 'Approve execution now, request revisions, or ask follow-up questions.',
      approveLabel: 'Approve',
      reviseLabel: 'Revise',
      followUpLabel: 'Follow-up',
      strategyId: typeof metadata.strategyId === 'string' ? metadata.strategyId : undefined,
    };
  }

  private async safeConvexQuery<T>(path: string, args: Record<string, unknown>): Promise<T | null> {
    try {
      await this.setConvexAuth();
      return await this.convex.query(path as any, args);
    } catch (error) {
      log.debug('[HybridAdapter] Convex query skipped:', path, error);
      return null;
    }
  }

  private async safeConvexMutation(path: string, args: Record<string, unknown>): Promise<void> {
    try {
      await this.setConvexAuth();
      await this.convex.mutation(path as any, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const serialized = (() => {
        try {
          return JSON.stringify(error);
        } catch {
          return '';
        }
      })();
      if (
        message.includes('OptimisticConcurrencyControlFailure') ||
        serialized.includes('"OptimisticConcurrencyControlFailure"')
      ) {
        return;
      }
      log.debug('[HybridAdapter] Convex mutation skipped:', path, error);
    }
  }

  private async enqueueCacheUpsert(
    campaignId: string,
    threadId: string,
    messages: ConversationMessage[],
  ): Promise<void> {
    const key = `${campaignId}:${threadId}`;
    const payload = messages
      .filter(message => message.deliveryState === 'sent')
      .map(message => ({
        id: message.serverMessageId || message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        metadata: message.metadata || {},
      }));
    const fingerprint = JSON.stringify(payload);

    if (HybridConversationDataAdapter.lastCacheFingerprintByThread.get(key) === fingerprint) {
      return;
    }
    if (HybridConversationDataAdapter.inFlightCacheFingerprintByThread.get(key) === fingerprint) {
      return;
    }

    const previous = HybridConversationDataAdapter.cacheWriteLocks.get(key) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        HybridConversationDataAdapter.inFlightCacheFingerprintByThread.set(key, fingerprint);
        await this.safeConvexMutation('messages:cacheUpsertBatch', {
          campaignId,
          threadId,
          messages: payload,
        });
        HybridConversationDataAdapter.lastCacheFingerprintByThread.set(key, fingerprint);
      })
      .finally(() => {
        if (HybridConversationDataAdapter.inFlightCacheFingerprintByThread.get(key) === fingerprint) {
          HybridConversationDataAdapter.inFlightCacheFingerprintByThread.delete(key);
        }
      })
      .finally(() => {
        if (HybridConversationDataAdapter.cacheWriteLocks.get(key) === next) {
          HybridConversationDataAdapter.cacheWriteLocks.delete(key);
        }
      });

    HybridConversationDataAdapter.cacheWriteLocks.set(key, next);
    await next;
  }

  private async setConvexAuth(): Promise<void> {
    if (!this.getClerkToken) {
      this.convex.clearAuth();
      return;
    }
    const token = await this.getClerkToken();
    if (token) {
      this.convex.setAuth(token);
      return;
    }
    this.convex.clearAuth();
  }
}
