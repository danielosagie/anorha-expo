export type ConversationRole = 'user' | 'assistant' | 'system';
export type ConversationDeliveryState = 'queued' | 'sending' | 'streaming' | 'sent' | 'failed';
export type ConversationMessageKind = 'text' | 'action' | 'status';
export type ConversationSurfaceState = 'home_overview' | 'chat_active' | 'chat_streaming';

export type CampaignStatus = 'active' | 'paused' | 'waiting_user' | 'completed' | 'failed';

export type ThreadStatus = 'active' | 'archived';

export interface CampaignSummary {
  id: string;
  title: string;
  status: CampaignStatus;
  updatedAt: string;
  createdAt: string;
  primaryThreadId: string;
  stateSummary?: string;
  inventoryScope?: 'all' | 'pool' | 'specific';
  timeframeDays?: number;
  /** First campaign item's image — the home card thumbnail. */
  imageUrl?: string;
  /** When the agent's next autonomous check is scheduled (ISO) — shown on the card. */
  nextWakeAt?: string;
  stats?: {
    soldToday?: number;
    totalCount?: number;
    soldCount?: number;
    reprices?: number;
    negotiating?: number;
  };
}

export interface AutonomyGuardrails {
  minAcceptableOfferPercent: number;
  maxAutoPriceDropPercent: number;
  maxAutoCounterCountPerDay: number;
  autoExecuteWithinGuardrails: boolean;
}

export interface CampaignConfig {
  sessionId: string;
  orgId: string;
  targetRevenue: number;
  timeframeDays: number;
  aggressiveness: 'conservative' | 'balanced' | 'aggressive';
  inventoryScope: 'all' | 'pool' | 'specific';
  poolId?: string;
  productIds: string[];
  guardrails: AutonomyGuardrails;
  updatedAt: string;
}

export interface CampaignActionItem {
  id: string;
  type: 'needs_input' | 'negotiation' | 'opportunity';
  title: string;
  description: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CampaignOverview {
  sessionId: string;
  summary24h: {
    listed: number;
    repriced: number;
    negotiating: number;
    sold: number;
    revenue: number;
  };
  needsInput: CampaignActionItem[];
  opportunities: CampaignActionItem[];
  recentActions: Array<{
    id: string;
    actionType: string;
    outcome: string;
    revenueImpact?: number;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
  /** Most recent scheduled 12h Sprout digest, if the backend has produced one. */
  latestDigest?: {
    text: string;
    createdAt: string;
    nextReportAt?: string;
  };
}

export type ConversationTarget = { mode: 'home' } | { mode: 'thread'; threadId: string };

export interface CampaignThreadSummary {
  id: string;
  campaignId: string;
  title: string;
  status: ThreadStatus;
  isPrimary: boolean;
  lastMessageAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface DecisionPrompt {
  id: string;
  kind: 'approve' | 'revise' | 'follow_up';
  title: string;
  description?: string;
  approveLabel?: string;
  reviseLabel?: string;
  followUpLabel?: string;
  strategyId?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface QuestionItem {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

// A Sprout ask_seller_question pending action, hydrated for the question card.
export interface QuestionPrompt {
  pendingActionId: string;
  threadId?: string;
  questions: QuestionItem[];
}

export interface ConversationMessage {
  id: string;
  campaignId: string;
  threadId: string;
  role: ConversationRole;
  content: string;
  createdAt: string;
  deliveryState: ConversationDeliveryState;
  kind: ConversationMessageKind;
  clientMessageId?: string;
  serverMessageId?: string;
  metadata?: Record<string, unknown>;
  actionMeta?: {
    actionType: string;
    status: 'pending' | 'completed' | 'failed';
    summary?: string;
  };
  decisionPrompt?: DecisionPrompt;
}

export interface ConversationQueueItem {
  id: string;
  campaignId: string;
  threadId: string;
  clientMessageId: string;
  kind: 'message' | 'action';
  content?: string;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
  /** Public urls of photos the seller attached — the agent decides what to do with them. */
  imageUrls?: string[];
  createdAt: string;
}

export interface ConversationThreadState {
  campaignId: string;
  threadId: string;
  messages: ConversationMessage[];
  pendingQueue: ConversationQueueItem[];
  draft: string;
  partialAssistantText?: string;
  updatedAt: string;
}

export interface StreamTurnInput {
  campaignId: string;
  threadId?: string | null;
  clientMessageId: string;
  kind: 'message' | 'action';
  content?: string;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
  /** Public urls of photos attached to this turn (already uploaded). */
  imageUrls?: string[];
}

/** Payload the agent attaches (message.metadata.jobCard) for a tappable cart card. */
export interface ChatJobCardMeta {
  /** quick-scan-session id the AddProduct cart hydrates from. */
  sessionId: string;
  itemCount: number;
  coverImageUrl?: string;
  title?: string;
  status?: string;
}

/**
 * Compact, arg-free record of one executed agent tool. Streamed only AFTER the
 * tool finishes (tool.completed) and persisted in the assistant message's
 * metadata.toolSteps — the chat renders these as step items; raw arguments,
 * SQL, and tool syntax never reach the client.
 */
export interface ConversationToolStep {
  tool: string;
  label: string;
  status?: string;
  durationMs?: number;
}

export interface StreamTurnObserver {
  onThreadCreated?: (threadId: string) => void;
  onMessageAck?: (payload: { clientMessageId: string; serverMessageId?: string; threadId?: string }) => void;
  onAssistantStarted?: (payload: { messageId?: string; threadId?: string }) => void;
  onAssistantDelta?: (payload: { delta: string; messageId?: string; threadId?: string }) => void;
  onReasoning?: (payload: { reasoning: string; messageId?: string; threadId?: string }) => void;
  onAssistantCompleted?: (payload: { messageId?: string; content?: string; threadId?: string }) => void;
  onToolCompleted?: (payload: ConversationToolStep & { threadId?: string }) => void;
  onActionCompleted?: (payload: {
    clientMessageId?: string;
    actionType?: string;
    summary?: string;
    threadId?: string;
  }) => void;
  onError?: (error: Error) => void;
}

export interface CreateCampaignInput {
  title?: string;
  targetRevenue: number;
  timeframeDays: number;
  productIds?: string[];
  inventoryScope?: 'all' | 'pool' | 'specific';
  poolId?: string;
  aggressiveness?: 'conservative' | 'balanced' | 'aggressive';
}

export interface CreateThreadInput {
  title?: string;
}

export interface DecisionSubmission {
  decisionId: string;
  action: 'approve' | 'revise' | 'follow_up';
  strategyId?: string;
  content?: string;
}

export interface CampaignConfigUpdate {
  targetRevenue?: number;
  timeframeDays?: number;
  aggressiveness?: 'conservative' | 'balanced' | 'aggressive';
  inventoryScope?: 'all' | 'pool' | 'specific';
  poolId?: string;
  productIds?: string[];
  guardrails?: Partial<AutonomyGuardrails>;
}

export interface RunFlashCampaignInput {
  discountPercent: number;
  durationHours: number;
  reason?: string;
}

export interface NegotiationDecisionInput {
  action: 'accept' | 'counter' | 'let_agent' | 'decline';
  offerAmount?: number;
  counterAmount?: number;
  threadId?: string;
  note?: string;
}

// ── Sprout types ──────────────────────────────────────────────────────

export type CampaignStage = 'seedling' | 'growing' | 'thriving' | 'dormant' | 'complete';
export type CampaignType = 'static' | 'dynamic';
export type FeedEventKind = 'info' | 'confirm' | 'ask' | 'action';
export type ItemStatus = 'negotiating' | 'listed' | 'sold' | 'at_floor' | 'paused';

export interface CampaignCriteria {
  slow_movers?: boolean;
  dead_stock?: boolean;
  overstock?: { threshold: number };
  by_category?: string[];
  by_age?: { days: number };
  custom_tag?: string[];
}

export interface FeedEventAction {
  label: string;
  actionType: string;
  variant: 'primary' | 'neutral' | 'destructive';
}

export interface FeedEvent {
  id: string;
  campaignId: string;
  kind: FeedEventKind;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  actions?: FeedEventAction[];
  createdAt: number;
  resolvedAt?: number;
}

export interface CampaignItem {
  id: string;
  productId: string;
  name: string;
  channels: string;
  currentPrice: number;
  status: ItemStatus;
  imageUrl?: string;
  emoji?: string;
  floorPrice?: number;
  priceHistory?: Array<{ date: string; price: number; reason: string }>;
}
