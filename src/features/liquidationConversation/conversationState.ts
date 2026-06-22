import type {
  ConversationMessage,
  ConversationQueueItem,
  ConversationThreadState,
  ConversationMessageKind,
} from './types';

export const HOME_DRAFT_SCOPE = '__home__';

const randomSuffix = () => Math.random().toString(36).slice(2, 10);

export const createClientId = (prefix: string) => `${prefix}-${Date.now()}-${randomSuffix()}`;

export const createEmptyThreadState = (campaignId: string, threadId: string): ConversationThreadState => ({
  campaignId,
  threadId,
  messages: [],
  pendingQueue: [],
  draft: '',
  partialAssistantText: '',
  updatedAt: new Date().toISOString(),
});

export const sortMessages = (messages: ConversationMessage[]) =>
  messages.slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

const withUpdatedAt = (state: ConversationThreadState): ConversationThreadState => ({
  ...state,
  updatedAt: new Date().toISOString(),
});

export const appendMessage = (
  state: ConversationThreadState,
  message: ConversationMessage,
): ConversationThreadState => {
  const next = sortMessages([...state.messages.filter(item => item.id !== message.id), message]);
  return withUpdatedAt({
    ...state,
    messages: next,
  });
};

export const updateMessage = (
  state: ConversationThreadState,
  messageId: string,
  updater: (message: ConversationMessage) => ConversationMessage,
): ConversationThreadState => {
  let changed = false;
  const next = state.messages.map(message => {
    if (message.id !== messageId) return message;
    changed = true;
    return updater(message);
  });
  return changed ? withUpdatedAt({ ...state, messages: sortMessages(next) }) : state;
};

export const enqueueTurn = (
  state: ConversationThreadState,
  queueItem: ConversationQueueItem,
  message: ConversationMessage,
): ConversationThreadState => withUpdatedAt({
  ...state,
  messages: sortMessages([...state.messages, message]),
  pendingQueue: [...state.pendingQueue, queueItem],
  draft: '',
});

export const markQueueItemSending = (
  state: ConversationThreadState,
  clientMessageId: string,
): ConversationThreadState => {
  const nextState = updateMessage(state, clientMessageId, message => ({
    ...message,
    deliveryState: 'sending',
  }));
  return withUpdatedAt(nextState);
};

export const acknowledgeMessage = (
  state: ConversationThreadState,
  clientMessageId: string,
  serverMessageId?: string,
): ConversationThreadState =>
  withUpdatedAt(
    updateMessage(state, clientMessageId, message => ({
      ...message,
      deliveryState: 'sent',
      serverMessageId: serverMessageId || message.serverMessageId,
    })),
  );

export const dequeueTurn = (
  state: ConversationThreadState,
  clientMessageId: string,
): ConversationThreadState => withUpdatedAt({
  ...state,
  pendingQueue: state.pendingQueue.filter(item => item.clientMessageId !== clientMessageId),
});

export const failTurn = (
  state: ConversationThreadState,
  clientMessageId: string,
  errorMessage?: string,
): ConversationThreadState => {
  const withFailure = updateMessage(state, clientMessageId, message => ({
    ...message,
    deliveryState: 'failed',
    metadata: {
      ...(message.metadata || {}),
      errorMessage,
    },
    actionMeta: message.actionMeta
      ? {
          ...message.actionMeta,
          status: 'failed',
          summary: errorMessage || message.actionMeta.summary,
        }
      : undefined,
  }));
  return withUpdatedAt({
    ...withFailure,
    pendingQueue: withFailure.pendingQueue.filter(item => item.clientMessageId !== clientMessageId),
  });
};

export const retryFailedTurn = (
  state: ConversationThreadState,
  clientMessageId: string,
): ConversationThreadState => {
  const target = state.messages.find(message => message.clientMessageId === clientMessageId || message.id === clientMessageId);
  if (!target) return state;
  const queueItem: ConversationQueueItem = {
    id: createClientId('queue'),
    campaignId: target.campaignId,
    threadId: target.threadId,
    clientMessageId,
    kind: target.kind === 'action' ? 'action' : 'message',
    content: target.content,
    actionType: target.actionMeta?.actionType,
    actionPayload: target.metadata?.actionPayload as Record<string, unknown> | undefined,
    createdAt: new Date().toISOString(),
  };
  const alreadyQueued = state.pendingQueue.some(item => item.clientMessageId === clientMessageId);
  const next = updateMessage(state, clientMessageId, message => ({
    ...message,
    deliveryState: 'queued',
    metadata: {
      ...(message.metadata || {}),
      errorMessage: undefined,
    },
    actionMeta: message.actionMeta
      ? {
          ...message.actionMeta,
          status: 'pending',
        }
      : undefined,
  }));
  return withUpdatedAt({
    ...next,
    pendingQueue: alreadyQueued ? next.pendingQueue : [...next.pendingQueue, queueItem],
  });
};

export const ensureAssistantPlaceholder = (
  state: ConversationThreadState,
  campaignId: string,
  threadId: string,
  assistantMessageId?: string,
): { state: ConversationThreadState; assistantMessageId: string } => {
  const makeMessage = (id: string): ConversationMessage => ({
    id,
    campaignId,
    threadId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    deliveryState: 'streaming',
    kind: 'text',
  });

  // With an explicit (turn-scoped) id, ALWAYS bind to that message. Each agent run
  // gets its own bubble + activity card instead of piling steps onto the previous
  // run's card (the "it just updates the original one" bug). Reusing whatever
  // message happened to still be 'streaming' is what caused that.
  if (assistantMessageId) {
    const byId = state.messages.find(message => message.id === assistantMessageId);
    if (byId) {
      return { state, assistantMessageId };
    }
    return { state: appendMessage(state, makeMessage(assistantMessageId)), assistantMessageId };
  }

  const existing = state.messages.find(
    message => message.role === 'assistant' && message.deliveryState === 'streaming',
  );
  if (existing) {
    return { state, assistantMessageId: existing.id };
  }
  const nextId = createClientId('assistant');
  return { state: appendMessage(state, makeMessage(nextId)), assistantMessageId: nextId };
};

export const appendAssistantDelta = (
  state: ConversationThreadState,
  campaignId: string,
  threadId: string,
  delta: string,
  assistantMessageId?: string,
): ConversationThreadState => {
  const ensured = ensureAssistantPlaceholder(state, campaignId, threadId, assistantMessageId);
  return withUpdatedAt(
    updateMessage(ensured.state, ensured.assistantMessageId, message => ({
      ...message,
      content: `${message.content}${delta}`,
      deliveryState: 'streaming',
    })),
  );
};

/** Attach a completed tool step to the streaming assistant message's metadata. */
export const appendAssistantToolStep = (
  state: ConversationThreadState,
  campaignId: string,
  threadId: string,
  step: { tool: string; label: string; status?: string; durationMs?: number; resultSummary?: string },
  assistantMessageId?: string,
): ConversationThreadState => {
  const ensured = ensureAssistantPlaceholder(state, campaignId, threadId, assistantMessageId);
  return withUpdatedAt(
    updateMessage(ensured.state, ensured.assistantMessageId, message => ({
      ...message,
      metadata: {
        ...(message.metadata || {}),
        toolSteps: [
          ...((message.metadata?.toolSteps as any[]) || []),
          step,
        ],
      },
    })),
  );
};

/** Accumulate streamed reasoning/thinking text into the streaming assistant message. */
export const appendAssistantReasoning = (
  state: ConversationThreadState,
  campaignId: string,
  threadId: string,
  reasoning: string,
  assistantMessageId?: string,
): ConversationThreadState => {
  if (!reasoning) return state;
  const ensured = ensureAssistantPlaceholder(state, campaignId, threadId, assistantMessageId);
  return withUpdatedAt(
    updateMessage(ensured.state, ensured.assistantMessageId, message => ({
      ...message,
      metadata: {
        ...(message.metadata || {}),
        reasoning: `${(message.metadata?.reasoning as string) || ''}${reasoning}`,
      },
    })),
  );
};

export const completeAssistantMessage = (
  state: ConversationThreadState,
  content?: string,
  assistantMessageId?: string,
): ConversationThreadState => {
  const target =
    (assistantMessageId && state.messages.find(message => message.id === assistantMessageId)) ||
    state.messages.find(message => message.role === 'assistant' && message.deliveryState === 'streaming');
  if (!target) return state;
  return withUpdatedAt(
    updateMessage(state, target.id, message => ({
      ...message,
      content: typeof content === 'string' && content.length ? content : message.content,
      deliveryState: 'sent',
    })),
  );
};

export const completeActionMessage = (
  state: ConversationThreadState,
  clientMessageId: string,
  summary?: string,
): ConversationThreadState =>
  withUpdatedAt(
    updateMessage(state, clientMessageId, message => ({
      ...message,
      deliveryState: 'sent',
      actionMeta: message.actionMeta
        ? {
            ...message.actionMeta,
            status: 'completed',
            summary: summary || message.actionMeta.summary,
          }
        : undefined,
    })),
  );

const messageMatchesRemote = (localMessage: ConversationMessage, remoteMessage: ConversationMessage) => {
  if (localMessage.serverMessageId && localMessage.serverMessageId === remoteMessage.id) return true;
  if (localMessage.id === remoteMessage.id) return true;
  if (localMessage.clientMessageId && localMessage.clientMessageId === remoteMessage.clientMessageId) return true;
  return false;
};

export const mergeRemoteMessages = (
  localMessages: ConversationMessage[],
  remoteMessages: ConversationMessage[],
): ConversationMessage[] => {
  const merged = [...remoteMessages];

  for (const localMessage of localMessages) {
    const index = merged.findIndex(remoteMessage => messageMatchesRemote(localMessage, remoteMessage));
    if (index >= 0) {
      merged[index] = {
        ...remoteMessages[index],
        clientMessageId: localMessage.clientMessageId || remoteMessages[index].clientMessageId,
        actionMeta: localMessage.actionMeta || remoteMessages[index].actionMeta,
      };
      continue;
    }

    if (localMessage.deliveryState !== 'sent' || localMessage.kind !== 'text') {
      merged.push(localMessage);
    }
  }

  return sortMessages(merged);
};

export const createTextMessage = ({
  campaignId,
  threadId,
  clientMessageId,
  role,
  content,
  deliveryState,
  imageUrls,
}: {
  campaignId: string;
  threadId: string;
  clientMessageId: string;
  role: ConversationMessage['role'];
  content: string;
  deliveryState: ConversationMessage['deliveryState'];
  imageUrls?: string[];
}): ConversationMessage => ({
  id: clientMessageId,
  clientMessageId,
  campaignId,
  threadId,
  role,
  content,
  createdAt: new Date().toISOString(),
  deliveryState,
  kind: 'text',
  ...(imageUrls && imageUrls.length ? { imageUrls } : {}),
});

export const createActionMessage = ({
  campaignId,
  threadId,
  clientMessageId,
  title,
  actionType,
  actionPayload,
}: {
  campaignId: string;
  threadId: string;
  clientMessageId: string;
  title: string;
  actionType: string;
  actionPayload?: Record<string, unknown>;
}): ConversationMessage => ({
  id: clientMessageId,
  clientMessageId,
  campaignId,
  threadId,
  role: 'user',
  content: title,
  createdAt: new Date().toISOString(),
  deliveryState: 'queued',
  kind: 'action',
  metadata: {
    actionPayload,
  },
  actionMeta: {
    actionType,
    status: 'pending',
  },
});

export const toQueueItem = ({
  campaignId,
  threadId,
  clientMessageId,
  kind,
  content,
  actionType,
  actionPayload,
  imageUrls,
}: {
  campaignId: string;
  threadId: string;
  clientMessageId: string;
  kind: 'message' | 'action';
  content?: string;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
  imageUrls?: string[];
}): ConversationQueueItem => ({
  id: createClientId('queue'),
  campaignId,
  threadId,
  clientMessageId,
  kind,
  content,
  actionType,
  actionPayload,
  imageUrls,
  createdAt: new Date().toISOString(),
});

export const getMessagePreview = (message: ConversationMessage, fallback = 'Conversation event') => {
  if (message.kind === 'action') {
    return message.actionMeta?.summary || message.content || fallback;
  }
  return message.content || fallback;
};

export const getMessageKindLabel = (kind: ConversationMessageKind) => {
  if (kind === 'action') return 'Action';
  if (kind === 'status') return 'Status';
  return 'Message';
};
