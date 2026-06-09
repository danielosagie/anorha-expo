import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationDataAdapter } from './ConversationDataAdapter';
import { loadThreadState, persistThreadState } from './LocalConversationStore';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../../config/env';
import { uploadProductImage } from '../../utils/uploadProductImage';
import {
  HOME_DRAFT_SCOPE,
  acknowledgeMessage,
  appendAssistantDelta,
  completeActionMessage,
  completeAssistantMessage,
  createActionMessage,
  createClientId,
  createEmptyThreadState,
  createTextMessage,
  dequeueTurn,
  enqueueTurn,
  ensureAssistantPlaceholder,
  failTurn,
  markQueueItemSending,
  toQueueItem,
} from './conversationState';
import type {
  CampaignConfig,
  CampaignOverview,
  CampaignSummary,
  CampaignThreadSummary,
  ConversationMessage,
  ConversationSurfaceState,
  ConversationThreadState,
  DecisionPrompt,
} from './types';

type DispatchActionInput = {
  actionType: string;
  title: string;
  payload?: Record<string, unknown>;
};

type ControllerOptions = {
  adapter: ConversationDataAdapter;
  initialCampaignId?: string;
};

type ThreadStateMap = Record<string, ConversationThreadState>;

export const useLiquidationConversationController = ({
  adapter,
  initialCampaignId,
}: ControllerOptions) => {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [threads, setThreads] = useState<CampaignThreadSummary[]>([]);
  const [campaignOverview, setCampaignOverview] = useState<CampaignOverview | null>(null);
  const [campaignConfig, setCampaignConfig] = useState<CampaignConfig | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(initialCampaignId || null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [surfaceState, setSurfaceState] = useState<ConversationSurfaceState>('home_overview');
  const [threadStates, setThreadStates] = useState<ThreadStateMap>({});
  const [homeDrafts, setHomeDrafts] = useState<Record<string, string>>({});
  const [streamingByThread, setStreamingByThread] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeCampaignIdRef = useRef<string | null>(activeCampaignId);
  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  const threadStatesRef = useRef<ThreadStateMap>(threadStates);
  const processingByThreadRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    activeCampaignIdRef.current = activeCampaignId;
  }, [activeCampaignId]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    threadStatesRef.current = threadStates;
  }, [threadStates]);

  const activeCampaign = useMemo(
    () => campaigns.find(campaign => campaign.id === activeCampaignId) || null,
    [campaigns, activeCampaignId],
  );

  const activeThreadState = activeThreadId ? threadStates[activeThreadId] : undefined;

  const composerText = useMemo(() => {
    if (!activeCampaignId) return '';
    if (surfaceState === 'home_overview') {
      return homeDrafts[activeCampaignId] || '';
    }
    return activeThreadState?.draft || '';
  }, [activeCampaignId, activeThreadState?.draft, homeDrafts, surfaceState]);

  const activeMessages = useMemo(
    () => (activeThreadState?.messages || []).map(message => ({
      ...message,
      time: new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    })),
    [activeThreadState?.messages],
  );

  const queuedCount = activeThreadState?.pendingQueue.length || 0;
  const isStreaming = !!(activeThreadId && streamingByThread[activeThreadId]);

  const setThreadStateFor = useCallback((
    threadId: string,
    updater: (state: ConversationThreadState) => ConversationThreadState,
    options?: { immediate?: boolean },
  ) => {
    const currentCampaignId = activeCampaignIdRef.current;
    const current = threadStatesRef.current[threadId] || createEmptyThreadState(currentCampaignId || '', threadId);
    const next = updater(current);
    threadStatesRef.current = {
      ...threadStatesRef.current,
      [threadId]: next,
    };
    setThreadStates(prev => ({
      ...prev,
      [threadId]: next,
    }));
    if (next.campaignId) {
      void persistThreadState(next, { immediate: !!options?.immediate });
    }
    return next;
  }, []);

  const setHomeDraft = useCallback(async (campaignId: string, draft: string) => {
    setHomeDrafts(prev => ({
      ...prev,
      [campaignId]: draft,
    }));
    const nextState = {
      ...(await loadThreadState(campaignId, HOME_DRAFT_SCOPE)),
      campaignId,
      threadId: HOME_DRAFT_SCOPE,
      draft,
    };
    await persistThreadState(nextState).catch(() => undefined);
  }, []);

  const loadCampaigns = useCallback(async () => {
    const list = await adapter.listCampaigns();
    setCampaigns(list);
    if (!list.length) {
      setActiveCampaignId(null);
      setActiveThreadId(null);
      setThreads([]);
      setCampaignOverview(null);
      setCampaignConfig(null);
      return;
    }
    setActiveCampaignId(prev => {
      const candidate =
        (initialCampaignId && list.some(campaign => campaign.id === initialCampaignId) && initialCampaignId) ||
        (prev && list.some(campaign => campaign.id === prev) ? prev : null) ||
        list[0].id;
      return candidate;
    });
  }, [adapter, initialCampaignId]);

  const loadThreadIntoMemory = useCallback(async (campaignId: string, threadId: string) => {
    setIsLoadingMessages(true);
    const stored = await loadThreadState(campaignId, threadId);
    threadStatesRef.current = {
      ...threadStatesRef.current,
      [threadId]: stored,
    };
    setThreadStates(prev => ({
      ...prev,
      [threadId]: stored,
    }));

    const localMessages = await adapter.hydrateThread(campaignId, threadId).catch(() => stored.messages);
    threadStatesRef.current = {
      ...threadStatesRef.current,
      [threadId]: {
        ...stored,
        messages: localMessages,
      },
    };
    setThreadStates(prev => ({
      ...prev,
      [threadId]: {
        ...stored,
        messages: localMessages,
      },
    }));

    adapter.getMessages(campaignId, threadId)
      .then(remoteMessages => {
        setThreadStateFor(threadId, state => ({
          ...state,
          campaignId,
          threadId,
          messages: remoteMessages,
        }), { immediate: true });
      })
      .catch((fetchError: any) => {
        setError(fetchError?.message || 'Failed to refresh thread');
      })
      .finally(() => setIsLoadingMessages(false));
  }, [adapter, setThreadStateFor]);

  const loadThreads = useCallback(async (campaignId: string) => {
    setIsLoadingThreads(true);
    try {
      const list = await adapter.listThreads(campaignId);
      setThreads(list);
      setActiveThreadId(prev => {
        if (prev && list.some(thread => thread.id === prev)) {
          return prev;
        }
        return list.find(thread => thread.isPrimary)?.id || list[0]?.id || null;
      });
    } finally {
      setIsLoadingThreads(false);
    }
  }, [adapter]);

  const loadCampaignDetails = useCallback(async (campaignId: string) => {
    const [overview, config] = await Promise.all([
      adapter.getCampaignOverview(campaignId).catch(() => null),
      adapter.getCampaignConfig(campaignId).catch(() => null),
    ]);
    setCampaignOverview(overview);
    setCampaignConfig(config);
  }, [adapter]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadCampaigns();
    } catch (bootstrapError: any) {
      setError(bootstrapError?.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadCampaigns]);

  useEffect(() => {
    bootstrap().catch(() => undefined);
  }, [bootstrap]);

  useEffect(() => {
    if (!activeCampaignId) return;
    setSurfaceState('home_overview');
    loadThreads(activeCampaignId)
      .then(() => loadCampaignDetails(activeCampaignId))
      .catch((loadError: any) => setError(loadError?.message || 'Failed to load campaign'));
    loadThreadState(activeCampaignId, HOME_DRAFT_SCOPE)
      .then(homeState => {
        setHomeDrafts(prev => ({
          ...prev,
          [activeCampaignId]: homeState.draft || '',
        }));
      })
      .catch(() => undefined);
  }, [activeCampaignId, loadCampaignDetails, loadThreads]);

  useEffect(() => {
    if (!activeCampaignId || !activeThreadId || surfaceState === 'home_overview') return;
    loadThreadIntoMemory(activeCampaignId, activeThreadId).catch((loadError: any) => {
      setError(loadError?.message || 'Failed to load thread');
    });
  }, [activeCampaignId, activeThreadId, loadThreadIntoMemory, surfaceState]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadCampaigns();
      const campaignId = activeCampaignIdRef.current;
      const threadId = activeThreadIdRef.current;
      if (campaignId) {
        await loadThreads(campaignId);
        await loadCampaignDetails(campaignId);
      }
      if (campaignId && threadId && surfaceState !== 'home_overview') {
        await loadThreadIntoMemory(campaignId, threadId);
      }
    } catch (refreshError: any) {
      setError(refreshError?.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [loadCampaignDetails, loadCampaigns, loadThreadIntoMemory, loadThreads, surfaceState]);

  const processQueue = useCallback(async (threadId: string) => {
    const state = threadStatesRef.current[threadId];
    if (!state?.pendingQueue.length || processingByThreadRef.current[threadId]) {
      if (!threadStatesRef.current[threadId]?.pendingQueue.length) {
        setStreamingByThread(prev => ({ ...prev, [threadId]: false }));
        if (activeThreadIdRef.current === threadId) {
          setSurfaceState('chat_active');
        }
      }
      return;
    }

    const item = state.pendingQueue[0];
    processingByThreadRef.current[threadId] = true;
    setStreamingByThread(prev => ({ ...prev, [threadId]: true }));
    if (activeThreadIdRef.current === threadId) {
      setSurfaceState('chat_streaming');
    }

    setThreadStateFor(threadId, current => markQueueItemSending(current, item.clientMessageId));
    setError(null);

    try {
      await adapter.streamTurn(
        {
          campaignId: item.campaignId,
          threadId,
          clientMessageId: item.clientMessageId,
          kind: item.kind,
          content: item.content,
          actionType: item.actionType,
          actionPayload: item.actionPayload,
        },
        {
          onMessageAck: ({ clientMessageId, serverMessageId }) => {
            setThreadStateFor(threadId, current => acknowledgeMessage(current, clientMessageId, serverMessageId));
          },
          onAssistantStarted: ({ messageId }) => {
            setThreadStateFor(threadId, current => ensureAssistantPlaceholder(
              current,
              item.campaignId,
              threadId,
              messageId,
            ).state);
          },
          onAssistantDelta: ({ delta, messageId }) => {
            setThreadStateFor(threadId, current => appendAssistantDelta(
              current,
              item.campaignId,
              threadId,
              delta,
              messageId,
            ));
          },
          onAssistantCompleted: ({ content, messageId }) => {
            setThreadStateFor(threadId, current => completeAssistantMessage(current, content, messageId), { immediate: true });
          },
          onActionCompleted: ({ clientMessageId, summary }) => {
            setThreadStateFor(
              threadId,
              current => completeActionMessage(current, clientMessageId || item.clientMessageId, summary),
              { immediate: true },
            );
          },
        },
      );

      setThreadStateFor(threadId, current => dequeueTurn(current, item.clientMessageId), { immediate: true });
      const remoteMessages = await adapter.getMessages(item.campaignId, threadId).catch(() => null);
      if (remoteMessages) {
        setThreadStateFor(threadId, current => ({
          ...current,
          messages: remoteMessages,
        }), { immediate: true });
      }
    } catch (streamError: any) {
      setThreadStateFor(
        threadId,
        current => failTurn(current, item.clientMessageId, streamError?.message || 'Failed to stream response'),
        { immediate: true },
      );
      setError(streamError?.message || 'Failed to stream response');
    } finally {
      processingByThreadRef.current[threadId] = false;
      const nextState = threadStatesRef.current[threadId];
      if (nextState?.pendingQueue.length) {
        void processQueue(threadId);
      } else {
        setStreamingByThread(prev => ({ ...prev, [threadId]: false }));
        if (activeThreadIdRef.current === threadId) {
          setSurfaceState('chat_active');
        }
      }
    }
  }, [adapter, setThreadStateFor]);

  const ensureChatThread = useCallback(async (forceFreshThread: boolean) => {
    const campaignId = activeCampaignIdRef.current;
    if (!campaignId) {
      throw new Error('Select a campaign first');
    }

    if (!forceFreshThread && activeThreadIdRef.current) {
      return activeThreadIdRef.current;
    }

    const created = await adapter.createThread(campaignId, {
      title: `Chat ${threads.length + 1}`,
    });
    setThreads(prev => [created, ...prev.filter(thread => thread.id !== created.id)]);
    setActiveThreadId(created.id);
    setThreadStateFor(created.id, () => createEmptyThreadState(campaignId, created.id), { immediate: true });
    return created.id;
  }, [adapter, setThreadStateFor, threads.length]);

  const setComposerValue = useCallback((value: string) => {
    const campaignId = activeCampaignIdRef.current;
    if (!campaignId) return;
    if (surfaceState === 'home_overview') {
      void setHomeDraft(campaignId, value);
      return;
    }
    const threadId = activeThreadIdRef.current;
    if (!threadId) return;
    setThreadStateFor(threadId, current => ({
      ...current,
      draft: value,
    }));
    void adapter.persistDraft(campaignId, threadId, value).catch(() => undefined);
  }, [adapter, setHomeDraft, setThreadStateFor, surfaceState]);

  const queueTextMessage = useCallback(async (content: string) => {
    const campaignId = activeCampaignIdRef.current;
    if (!campaignId) {
      throw new Error('Select a campaign first');
    }
    const fromHome = surfaceState === 'home_overview';
    const threadId = await ensureChatThread(fromHome);
    const clientMessageId = createClientId('msg');
    const message = createTextMessage({
      campaignId,
      threadId,
      clientMessageId,
      role: 'user',
      content,
      deliveryState: isStreaming ? 'queued' : 'sending',
    });
    const queueItem = toQueueItem({
      campaignId,
      threadId,
      clientMessageId,
      kind: 'message',
      content,
    });

    setThreadStateFor(threadId, current => enqueueTurn(current, queueItem, message), { immediate: true });
    if (fromHome) {
      await setHomeDraft(campaignId, '');
    } else {
      setThreadStateFor(threadId, current => ({
        ...current,
        draft: '',
      }), { immediate: true });
    }
    setActiveThreadId(threadId);
    setSurfaceState('chat_active');
    setNotice(null);
    void processQueue(threadId);
  }, [ensureChatThread, isStreaming, processQueue, setHomeDraft, setThreadStateFor, surfaceState]);

  const dispatchAction = useCallback(async ({ actionType, title, payload }: DispatchActionInput) => {
    const campaignId = activeCampaignIdRef.current;
    if (!campaignId) {
      throw new Error('Select a campaign first');
    }
    const fromHome = surfaceState === 'home_overview';
    const threadId = await ensureChatThread(fromHome);
    const clientMessageId = createClientId('action');
    const message = createActionMessage({
      campaignId,
      threadId,
      clientMessageId,
      title,
      actionType,
      actionPayload: payload,
    });
    const queueItem = toQueueItem({
      campaignId,
      threadId,
      clientMessageId,
      kind: 'action',
      content: title,
      actionType,
      actionPayload: payload,
    });

    setThreadStateFor(threadId, current => enqueueTurn(current, queueItem, message), { immediate: true });
    setActiveThreadId(threadId);
    setSurfaceState('chat_active');
    void processQueue(threadId);
  }, [ensureChatThread, processQueue, setThreadStateFor, surfaceState]);

  const retryMessage = useCallback(async (clientMessageId: string) => {
    const campaignId = activeCampaignIdRef.current;
    const threadId = activeThreadIdRef.current;
    if (!campaignId || !threadId) return;
    await adapter.retryFailedMessage(campaignId, threadId, clientMessageId);
    const stored = await loadThreadState(campaignId, threadId);
    threadStatesRef.current = {
      ...threadStatesRef.current,
      [threadId]: stored,
    };
    setThreadStates(prev => ({
      ...prev,
      [threadId]: stored,
    }));
    void processQueue(threadId);
  }, [adapter, processQueue]);

  const openHome = useCallback(() => {
    setSurfaceState('home_overview');
  }, []);

  const openThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    setSurfaceState(streamingByThread[threadId] ? 'chat_streaming' : 'chat_active');
  }, [streamingByThread]);

  const createNewThread = useCallback(async () => {
    const threadId = await ensureChatThread(true);
    setActiveThreadId(threadId);
    setSurfaceState(streamingByThread[threadId] ? 'chat_streaming' : 'chat_active');
  }, [ensureChatThread, streamingByThread]);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    const campaignId = activeCampaignIdRef.current;
    if (!campaignId) return;
    const updated = await adapter.renameThread(campaignId, threadId, title);
    setThreads(prev => prev.map(thread => (thread.id === threadId ? updated : thread)));
  }, [adapter]);

  const deleteThread = useCallback(async (threadId: string) => {
    const campaignId = activeCampaignIdRef.current;
    if (!campaignId) return;
    await adapter.deleteThread(campaignId, threadId);
    threadStatesRef.current = Object.fromEntries(
      Object.entries(threadStatesRef.current).filter(([id]) => id !== threadId),
    );
    setThreadStates(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== threadId)));
    setThreads(prev => prev.filter(thread => thread.id !== threadId));
    if (activeThreadIdRef.current === threadId) {
      setActiveThreadId(null);
      setSurfaceState('home_overview');
    }
  }, [adapter]);

  const renameCampaign = useCallback(async (campaignId: string, title: string) => {
    const updated = await adapter.renameCampaign(campaignId, title);
    setCampaigns(prev => prev.map(campaign => (campaign.id === campaignId ? updated : campaign)));
  }, [adapter]);

  const deleteCampaign = useCallback(async (campaignId: string) => {
    await adapter.deleteCampaign(campaignId);
    setCampaigns(prev => {
      const next = prev.filter(campaign => campaign.id !== campaignId);
      if (activeCampaignIdRef.current === campaignId) {
        const nextCampaignId = next[0]?.id || null;
        setActiveCampaignId(nextCampaignId);
        setActiveThreadId(null);
        setThreads([]);
        setCampaignOverview(null);
        setCampaignConfig(null);
        setSurfaceState('home_overview');
      }
      return next;
    });
  }, [adapter]);

  // Dump photos into the chat: upload them, identify + draft each via the
  // existing /api/products/analyze pipeline, add the new drafts to this clearout,
  // then tell Sprout what landed so it can react (research / liquidate / hold).
  const ingestPhotos = useCallback(async (photos: string[], text: string) => {
    const campaignId = activeCampaignIdRef.current;
    if (!campaignId || !photos.length) return;
    setNotice(`Reviewing ${photos.length} photo${photos.length === 1 ? '' : 's'}…`);
    try {
      const token = await ensureSupabaseJwt();
      const drafts: Array<{ id: string; productId?: string; title: string; price?: number; imageUrl: string }> = [];
      await Promise.all(
        photos.slice(0, 8).map(async uri => {
          try {
            const url = await uploadProductImage(uri, createClientId('photo'));
            const resp = await fetch(`${API_BASE_URL}/api/products/analyze`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ imageUris: [url], selectedPlatforms: ['ebay'] }),
            });
            if (resp.ok) {
              const json = await resp.json();
              const v = json?.variant;
              if (v?.Id) drafts.push({ id: v.Id, productId: json?.product?.Id, title: v.Title || 'Unidentified item', price: v.Price, imageUrl: url });
            }
          } catch {
            /* skip this photo */
          }
        }),
      );
      if (!drafts.length) {
        setNotice('Could not read those photos. Try clearer shots.');
        return;
      }
      // Add the new drafts to this clearout
      try { await (adapter as any).addCampaignItems?.(campaignId, drafts.map(d => d.id)); } catch { /* ignore add failure */ }
      // Kick off the full per-platform listing generation (async, same job the add-product flow uses)
      try {
        await fetch(`${API_BASE_URL}/api/products/generate/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            products: drafts.map((d, i) => ({ productIndex: i, productId: d.productId, variantId: d.id, imageUrls: [d.imageUrl], coverImageIndex: 0 })),
            selectedPlatforms: ['ebay'],
          }),
        });
      } catch { /* generation is best-effort */ }
      setNotice(null);
      const list = drafts.map(d => (d.price ? `${d.title} (~$${Math.round(d.price)})` : d.title)).join(', ');
      const summary = `${text ? text + '\n\n' : ''}I dropped ${drafts.length} item${drafts.length === 1 ? '' : 's'} from photos into this clearout and you're drafting the full listings: ${list}. What's the play — research pricing, push them aggressively, or hold?`;
      await queueTextMessage(summary);
    } catch {
      setNotice('Could not process photos. Please try again.');
    }
  }, [adapter, queueTextMessage]);

  const sendComposer = useCallback(async (photos?: string[]) => {
    const content = composerText.trim();
    if (photos && photos.length) {
      setComposerValue('');
      await ingestPhotos(photos, content);
      return;
    }
    if (!content) return;
    await queueTextMessage(content);
  }, [composerText, queueTextMessage, ingestPhotos, setComposerValue]);

  const submitDecision = useCallback(async (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => {
    const campaignId = activeCampaignIdRef.current;
    const threadId = activeThreadIdRef.current;
    if (!campaignId || !threadId) return;
    // Local photo-ingest decision card → send a follow-up instruction to Sprout.
    if (prompt.id.startsWith('photo-')) {
      const instr =
        action === 'approve'
          ? 'Research current resale pricing for the items I just added from photos and suggest a start and floor price for each.'
          : action === 'revise'
            ? 'List the items I just added from photos aggressively to move them fast — set competitive prices and a tight deadline.'
            : 'Hold the items I just added from photos in this clearout for now; I will decide later.';
      await queueTextMessage(instr);
      return;
    }
    try {
      await adapter.submitDecision(campaignId, threadId, {
        decisionId: prompt.id,
        action,
        strategyId: prompt.strategyId,
      });
      const remoteMessages = await adapter.getMessages(campaignId, threadId);
      setThreadStateFor(threadId, current => ({
        ...current,
        messages: remoteMessages,
      }), { immediate: true });
      await loadCampaignDetails(campaignId);
    } catch (decisionError: any) {
      setError(decisionError?.message || 'Failed to submit decision');
    }
  }, [adapter, loadCampaignDetails, setThreadStateFor, queueTextMessage]);

  return {
    campaigns,
    activeCampaign,
    activeCampaignId,
    setActiveCampaignId,
    threads,
    activeThreadId,
    surfaceState,
    campaignOverview,
    campaignConfig,
    setCampaignConfig,
    loading,
    refreshing,
    isLoadingThreads,
    isLoadingMessages,
    error,
    notice,
    setNotice,
    composerText,
    setComposerText: setComposerValue,
    activeMessages,
    queuedCount,
    isStreaming,
    openHome,
    openThread,
    createNewThread,
    renameThread,
    deleteThread,
    renameCampaign,
    deleteCampaign,
    sendComposer,
    dispatchAction,
    retryMessage,
    onRefresh,
    loadCampaignDetails,
    loadThreads,
    queueTextMessage,
    submitDecision,
  };
};
