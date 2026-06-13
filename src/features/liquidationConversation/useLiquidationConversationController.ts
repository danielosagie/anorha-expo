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
  appendAssistantReasoning,
  appendAssistantToolStep,
  appendMessage,
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
  CampaignStatus,
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
    () => (activeThreadState?.messages || [])
      .filter(message => {
        // Keep user + still-streaming bubbles always. Drop phantom EMPTY agent
        // bubbles (no text, no tool steps, no decision, not an action) — those were
        // rendering as blank space and leaving a gap above the real reply.
        if (message.role === 'user' || message.deliveryState === 'streaming') return true;
        const hasText = !!(message.content && message.content.trim());
        const steps = (message.metadata as any)?.toolSteps;
        const hasSteps = Array.isArray(steps) && steps.length > 0;
        const hasJobCard = !!(message.metadata as any)?.jobCard?.sessionId;
        return hasText || hasSteps || hasJobCard || !!message.decisionPrompt || message.kind === 'action';
      })
      .map(message => ({
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

    // One stable assistant-message id PER TURN. The backend doesn't send a message
    // id in the stream, so we derive it from this turn's clientMessageId. Every
    // delta / reasoning / tool step / completion for THIS run targets this id, so a
    // new run always opens its own bubble + activity card.
    const assistantId = `assistant-${item.clientMessageId}`;

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
          imageUrls: item.imageUrls,
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
              messageId || assistantId,
            ).state);
          },
          onAssistantDelta: ({ delta, messageId }) => {
            setThreadStateFor(threadId, current => appendAssistantDelta(
              current,
              item.campaignId,
              threadId,
              delta,
              messageId || assistantId,
            ));
          },
          onReasoning: ({ reasoning, messageId }) => {
            setThreadStateFor(threadId, current => appendAssistantReasoning(
              current,
              item.campaignId,
              threadId,
              reasoning,
              messageId || assistantId,
            ));
          },
          onAssistantCompleted: ({ content, messageId }) => {
            setThreadStateFor(threadId, current => completeAssistantMessage(current, content, messageId || assistantId), { immediate: true });
          },
          // Completed tool steps attach to THIS run's assistant bubble as compact
          // items (label + status only; arguments never reach the client).
          onToolCompleted: ({ tool, label, status, durationMs }) => {
            setThreadStateFor(threadId, current => appendAssistantToolStep(
              current,
              item.campaignId,
              threadId,
              { tool, label, status, durationMs },
              assistantId,
            ));
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
      // A text turn's assistant message is already complete from the stream (content
      // + tool steps). Re-fetching and replacing it swaps in a server-id copy with a
      // different React key, which unmounts/remounts the bubble — that's the activity
      // card "flash". Only ACTION turns refetch, since they can surface approval
      // prompts that the stream doesn't carry. (Server already persists everything;
      // it reconciles on the next natural thread load.)
      // Action turns can surface approval prompts the stream doesn't carry; PHOTO turns
      // post a separate job-card message mid-turn (skipped by the live bridge while the
      // turn is in flight). Both need a one-shot server reconcile so the card / prompt
      // actually lands instead of waiting for the next natural thread load.
      if (item.kind === 'action' || (item.imageUrls && item.imageUrls.length > 0)) {
        const remoteMessages = await adapter.getMessages(item.campaignId, threadId).catch(() => null);
        if (remoteMessages) {
          setThreadStateFor(threadId, current => ({
            ...current,
            messages: remoteMessages,
          }), { immediate: true });
        }
      }
      // Pull fresh thread metadata so the backend's topic auto-title replaces
      // "New chat" in the drawer once the first turn lands.
      void loadThreads(item.campaignId).catch(() => undefined);
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
  }, [adapter, loadThreads, setThreadStateFor]);

  const ensureChatThread = useCallback(async (forceFreshThread: boolean) => {
    const campaignId = activeCampaignIdRef.current;
    if (!campaignId) {
      throw new Error('Select a campaign first');
    }

    if (!forceFreshThread && activeThreadIdRef.current) {
      return activeThreadIdRef.current;
    }

    // Create as "New chat" so the backend auto-titles the thread from the first
    // message's topic. Passing a custom title here (e.g. "Chat 3") makes the
    // backend titler skip it, which is why threads were never named by topic.
    const created = await adapter.createThread(campaignId, {
      title: 'New chat',
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

  const queueTextMessage = useCallback(async (content: string, imageUrls?: string[]) => {
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
      imageUrls,
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

  // Pause/resume a campaign (e.g. from the home long-press selection). Optimistic;
  // reloads from the server if the write fails so the card never lies.
  const setCampaignStatus = useCallback(async (campaignId: string, status: CampaignStatus) => {
    setCampaigns(prev => prev.map(campaign => (campaign.id === campaignId ? { ...campaign, status } : campaign)));
    try {
      await adapter.setCampaignStatus(campaignId, status);
    } catch (statusError) {
      await loadCampaigns().catch(() => undefined);
      throw statusError;
    }
  }, [adapter, loadCampaigns]);

  const sendComposer = useCallback(async (photos?: string[]) => {
    const content = composerText.trim();
    if (photos && photos.length) {
      // Hand the photos to the AGENT and let it decide what to do (identify + price,
      // or build draft listings via analyze_photos / analyze_shelf). We just upload
      // them and send a normal turn carrying the urls — no more fork to /analyze.
      setComposerValue('');
      setNotice(`Adding ${photos.length} photo${photos.length === 1 ? '' : 's'}…`);
      try {
        const urls = (await Promise.all(
          photos.slice(0, 8).map(uri => uploadProductImage(uri, createClientId('photo')).catch(() => null)),
        )).filter((u): u is string => !!u);
        setNotice(null);
        if (!urls.length) {
          setNotice('Could not upload those photos. Try again.');
          return;
        }
        const displayText = content || `added ${urls.length} photo${urls.length === 1 ? '' : 's'}`;
        await queueTextMessage(displayText, urls);
      } catch {
        setNotice('Could not process photos. Please try again.');
      }
      return;
    }
    if (!content) return;
    await queueTextMessage(content);
  }, [composerText, queueTextMessage, setComposerValue, setNotice]);

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

  // Live Convex messages (fed by the ConvexLiveMessages bridge). Agent-INITIATED
  // posts (digests, proactive updates) appear in the open thread the moment the
  // backend writes them — no tap, no poll. Append-by-id only, and skipped while
  // the thread is mid-turn (the send flow + refetch own that). Convex carries no
  // clientMessageId, so we never reconcile the seller's optimistic message here.
  const ingestLiveMessages = useCallback((rawMessages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>) => {
    const campaignId = activeCampaignIdRef.current;
    const threadId = activeThreadIdRef.current;
    if (!campaignId || !threadId) return;
    if (processingByThreadRef.current[threadId]) return;
    setThreadStateFor(threadId, current => {
      let next = current;
      let changed = false;
      for (const rm of rawMessages) {
        const rmThread = rm.metadata?.threadId;
        if (typeof rmThread === 'string' && rmThread && rmThread !== threadId) continue;
        const role = rm.role === 'tool' ? 'assistant' : rm.role;
        if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
        if (next.messages.some(m => m.id === rm.id || m.serverMessageId === rm.id)) continue;
        next = appendMessage(next, {
          id: rm.id,
          serverMessageId: rm.id,
          campaignId,
          threadId,
          role: role as ConversationMessage['role'],
          content: rm.content || '',
          createdAt: rm.createdAt,
          deliveryState: 'sent',
          kind: (rm.metadata as any)?.type === 'action' ? 'action' : 'text',
          metadata: rm.metadata || {},
        });
        changed = true;
      }
      return changed ? next : current;
    });
  }, [setThreadStateFor]);

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
    setCampaignStatus,
    sendComposer,
    dispatchAction,
    retryMessage,
    onRefresh,
    loadCampaignDetails,
    loadThreads,
    queueTextMessage,
    submitDecision,
    ingestLiveMessages,
  };
};
