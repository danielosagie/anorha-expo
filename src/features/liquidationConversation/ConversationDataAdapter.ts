import type {
  CampaignConfig,
  CampaignConfigUpdate,
  CampaignItem,
  CampaignOverview,
  CampaignSummary,
  CampaignThreadSummary,
  ConversationMessage,
  StreamTurnInput,
  StreamTurnObserver,
  CreateCampaignInput,
  CreateThreadInput,
  DecisionPrompt,
  DecisionSubmission,
  NegotiationDecisionInput,
  QuestionPrompt,
  RunFlashCampaignInput,
} from './types';

export interface ConversationDataAdapter {
  listCampaigns(): Promise<CampaignSummary[]>;
  listThreads(campaignId: string): Promise<CampaignThreadSummary[]>;
  getMessages(campaignId: string, threadId: string): Promise<ConversationMessage[]>;
  hydrateThread(campaignId: string, threadId: string): Promise<ConversationMessage[]>;
  streamTurn(input: StreamTurnInput, observer: StreamTurnObserver): Promise<{ threadId: string }>;
  persistDraft(campaignId: string, threadId: string, draft: string): Promise<void>;
  retryFailedMessage(campaignId: string, threadId: string, clientMessageId: string): Promise<void>;
  createCampaign(input: CreateCampaignInput): Promise<CampaignSummary>;
  createThread(campaignId: string, input: CreateThreadInput): Promise<CampaignThreadSummary>;
  renameCampaign(campaignId: string, title: string): Promise<CampaignSummary>;
  deleteCampaign(campaignId: string): Promise<void>;
  setCampaignStatus(campaignId: string, status: CampaignSummary['status']): Promise<void>;
  renameThread(campaignId: string, threadId: string, title: string): Promise<CampaignThreadSummary>;
  deleteThread(campaignId: string, threadId: string): Promise<void>;
  submitDecision(campaignId: string, threadId: string, decision: DecisionSubmission): Promise<void>;
  getPendingPrompts(
    campaignId: string,
    threadId: string,
  ): Promise<{ question: QuestionPrompt | null; plan: DecisionPrompt | null }>;
  answerQuestion(campaignId: string, pendingActionId: string, answer: { answers?: Record<string, string[]>; other?: string; text?: string }): Promise<void>;
  submitMessageFeedback(campaignId: string, messageId: string, vote: 'up' | 'down' | null, threadId?: string): Promise<void>;
  getCampaignConfig(campaignId: string): Promise<CampaignConfig>;
  updateCampaignConfig(campaignId: string, update: CampaignConfigUpdate): Promise<CampaignConfig>;
  getCampaignOverview(campaignId: string): Promise<CampaignOverview>;
  findSlowMovers(campaignId: string): Promise<{ count: number; items: Array<Record<string, unknown>> }>;
  getCampaignItems(campaignId: string): Promise<CampaignItem[]>;
  addCampaignItems(campaignId: string, variantIds: string[]): Promise<{ added: number; skipped: number }>;
  removeCampaignItems(campaignId: string, itemIds: string[]): Promise<{ removed: number }>;
  updateCampaignItems(
    campaignId: string,
    itemIds: string[],
    changes: { price?: number; floorPrice?: number; status?: string },
  ): Promise<{ updated: number }>;
  runFlashCampaign(campaignId: string, input: RunFlashCampaignInput): Promise<{ updated: number }>;
  submitNegotiationDecision(campaignId: string, input: NegotiationDecisionInput): Promise<{ status: string }>;
}
