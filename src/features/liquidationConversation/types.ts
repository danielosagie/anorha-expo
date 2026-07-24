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

export interface GlobalConversationTarget {
  sessionId: string;
  threadId: string;
  title: string;
}

export interface PlanStep {
  title: string;
  detail?: string;
}

/** A plan the agent proposed (propose_plan), carried on the tool step so it renders
 *  as an approvable card in the conversation. pendingActionId is what Approve/Revise hit. */
export interface PlanPayload {
  pendingActionId?: string;
  title: string;
  summary?: string;
  planType?: string;
  steps?: PlanStep[];
  strategyId?: string;
  inventoryAction?: InventoryBulkAction;
}

export type InventoryBulkAction = {
  action: 'archive' | 'delete' | 'add_tag';
  count: number;
  tag?: string;
};

export type InventorySelectionProposal = {
  query: string;
  operation: 'add' | 'replace' | 'remove';
};

export type ConversationContextAttachment = {
  kind: 'inventory_bulk_select' | 'inventory_bulk_edit';
  label: string;
  payload: Record<string, unknown>;
};

export interface DecisionPrompt {
  id: string;
  threadId?: string;
  kind: 'approve' | 'revise' | 'follow_up';
  title: string;
  description?: string;
  approveLabel?: string;
  reviseLabel?: string;
  followUpLabel?: string;
  strategyId?: string;
  // Generic plan (propose_plan pending action) — present when this card came from a plan
  // proposal rather than a strategy approval. planId is the pending-action id approval hits.
  planId?: string;
  planType?: string;
  summary?: string;
  steps?: PlanStep[];
  inventoryAction?: InventoryBulkAction;
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
  /** Public urls of photos attached to this message — shown as thumbnails in the bubble. */
  imageUrls?: string[];
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
  contextAttachment?: ConversationContextAttachment;
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
  contextAttachment?: ConversationContextAttachment;
  /** Sprout opens the thread itself — no user message is sent. Guarded server-side. */
  kickoff?: boolean;
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

// ── Activity model ─────────────────────────────────────────────────────
// The structured payloads that drive the inline activity cards + the review
// tray. All additive/optional: a message carrying only the legacy toolSteps +
// resultSummary still renders exactly as before (deriveActivities synthesizes a
// single {kind:'tool-run'} payload). Color in the UI encodes OLD-vs-NEW
// (red = superseded, green = current), NEVER good-vs-bad.

/**
 * One value change — the diff atom. `label` is user-facing and pre-humanized
 * server-side; `field` is an internal key and must NEVER be rendered.
 */
export interface ValueChange {
  /** Internal key, never shown to the seller ('price', 'quantity', 'status'). */
  field: string;
  /** User-facing field name shown in the diff ('Price', 'In stock', 'Status'). */
  label: string;
  /** Old value. null/undefined => set for the first time (no strike, no arrow). */
  from?: string | number | null;
  /** New value. null => the field was cleared. */
  to: string | number | null;
  /** Unit appended once after the new value ('left', 'in stock'). */
  unit?: string;
  kind?: 'price' | 'inventory' | 'status' | 'text';
  /** Drives the sheet-only delta-chip tint; NEVER the feed token color. */
  direction?: 'up' | 'down' | 'neutral';
  /** Identity for an "Open item" target, when the change is about one product. */
  itemId?: string;
  itemName?: string;
  itemImageUrl?: string;
  productId?: string;
}

/** One outcome-only justification row ("Found 6 similar sold nearby"). */
export interface EvidenceItem {
  label: string;
  value?: string;
  sub?: string;
  imageUrl?: string;
}

/** A reversible action — presence of this on a change shows the Undo affordance. */
export interface UndoRef {
  actionType: string;
  payload: Record<string, unknown>;
  /** Confirm copy on the in-place undo ("Put the price back to $1,200?"). */
  revertLabel?: string;
}

/** Identity of the product a change/publish refers to (for "Open item"). */
export interface ActivityItemRef {
  productId: string;
  name?: string;
  imageUrl?: string;
  listingCount?: number;
}

/** A standing routine / watch — the Buoy-style recurring card + routine tray. */
export interface Routine {
  id: string;
  /** Outcome language, never a tool/cron name ("Check Studio Display listings"). */
  title: string;
  cadence: {
    type: 'daily' | 'weekly' | 'hourly' | 'interval';
    /** Local time-of-day for daily/weekly ("9:00 AM"). */
    atLocal?: string;
    /** 0–6 (Sun–Sat) for weekly. */
    weekday?: number;
    /** Interval length for hourly/interval. */
    everyHours?: number;
  };
  nextRunAt?: string;
  lastRunAt?: string;
  /** Plain outcome of the last run ("nothing needed doing"). */
  lastRunOutcome?: string;
  scopeLabel?: string;
  watchLabel?: string;
  paused?: boolean;
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
  /** Short, user-safe outcome shown under the step label ("12 found", "$650 median"). */
  resultSummary?: string;
  /** A richer, still-safe result for the step-detail page: scalar lines + sample rows. */
  resultDetail?: { lines?: string[]; items?: Array<{ label: string; value?: string; sub?: string }> };
  // ── Optional structured fields (light up the diff / review tray) ──
  /** Value changes this step made — drives the diff row + reprice/restock cards. */
  changes?: ValueChange[];
  /** Plain-language "why" banner shown in the review tray. */
  reason?: string;
  /** What the step was based on — the "see what it's based on" sub-page. */
  evidence?: { headline: string; items: EvidenceItem[] };
  /** The product this step acted on, for the "Open item" affordance. */
  itemRef?: ActivityItemRef;
  /** Presence => an Undo pill is offered for this step's change. */
  undo?: UndoRef;
  /** A report the agent authored in this step — promoted to a {kind:'document'} card. */
  document?: ReportDocument;
  /** A plan the agent proposed in this step — promoted to a {kind:'plan'} approvable card. */
  plan?: PlanPayload;
  /** An inventory selection proposal that stays inert until the seller taps Apply. */
  selection?: InventorySelectionProposal;
  /** Length of the assistant text streamed so far when this step completed. Lets the
   *  bubble drop the card inline at the point the reply "brought it up" (client-stamped
   *  during streaming; absent on history reload → the card falls beneath the text). */
  textAnchor?: number;
}

/** Shared fields on every inline activity card payload. */
export interface ActivityBase {
  id: string;
  /** Humanized outcome title shown on the card ("Lowered the price"). */
  title: string;
  status?: 'ok' | 'failed' | 'pending' | 'syncing';
  /** Character offset into the assistant text where this card should sit inline.
   *  Derived from the source step's textAnchor; undefined → render beneath the reply. */
  anchor?: number;
}

/** One section of an agent-authored report. Whitelisted to three safe shapes,
 *  matching the backend AgentReportSection. */
export type DocumentSection =
  | { kind: 'prose'; heading?: string; text: string }
  | { kind: 'table'; heading?: string; columns: string[]; rows: string[][] }
  | { kind: 'metrics'; heading?: string; metrics: Array<{ label: string; value: string; sub?: string }> };

/** A report the agent authored — rendered as a tappable card that opens a full,
 *  editable, shareable business sheet. documentId is stable across revisions. */
export interface ReportDocument {
  documentId: string;
  title: string;
  summary: string;
  format?: 'report';
  sections: DocumentSection[];
}

/**
 * The discriminated union ActivityCard switches on. Lives in
 * message.metadata.activities[] (rendered in order under the assistant text).
 */
export type ActivityPayload =
  | (ActivityBase & { kind: 'tool-run'; steps: ConversationToolStep[]; reasoning?: string })
  | (ActivityBase & {
      kind: 'value-change';
      changes: ValueChange[];
      reason?: string;
      evidence?: { headline: string; items: EvidenceItem[] };
      itemRef?: ActivityItemRef;
      undo?: UndoRef;
    })
  | (ActivityBase & { kind: 'publish'; changes: ValueChange[]; channels?: string[]; itemRef?: ActivityItemRef })
  | (ActivityBase & { kind: 'routine'; routine: Routine })
  | (ActivityBase & { kind: 'reminder'; whenAtLabel: string; what: string; nextRunAt?: string })
  | (ActivityBase & { kind: 'document'; document: ReportDocument })
  | (ActivityBase & { kind: 'plan'; plan: PlanPayload })
  | (ActivityBase & { kind: 'selection'; selection: InventorySelectionProposal });

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
  planId?: string;
  content?: string;
  /** Re-run a failed, idempotent inventory plan. Ignored for other decisions. */
  retry?: boolean;
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
  // Inventory fields for the InventoryListCard (populated by the backend items endpoint).
  sku?: string;
  totalQuantity?: number;
  lastSyncedAt?: string | null;
  isStale?: boolean;
}
