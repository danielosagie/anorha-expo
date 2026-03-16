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
}

export interface StreamTurnObserver {
  onThreadCreated?: (threadId: string) => void;
  onMessageAck?: (payload: { clientMessageId: string; serverMessageId?: string; threadId?: string }) => void;
  onAssistantStarted?: (payload: { messageId?: string; threadId?: string }) => void;
  onAssistantDelta?: (payload: { delta: string; messageId?: string; threadId?: string }) => void;
  onAssistantCompleted?: (payload: { messageId?: string; content?: string; threadId?: string }) => void;
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
