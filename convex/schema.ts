import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  campaigns: defineTable({
    campaignId: v.string(),
    sessionId: v.string(),
    userId: v.optional(v.string()),
    title: v.optional(v.string()),
    status: v.string(),
    primaryThreadId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_campaign_id', ['campaignId'])
    .index('by_session_id', ['sessionId'])
    .index('by_updated_at', ['updatedAt']),

  threads: defineTable({
    threadId: v.string(),
    campaignId: v.string(),
    title: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('archived')),
    isPrimary: v.boolean(),
    lastMessageAt: v.number(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_thread_id', ['threadId'])
    .index('by_campaign', ['campaignId'])
    .index('by_campaign_last_message', ['campaignId', 'lastMessageAt']),

  thread_messages_cache: defineTable({
    campaignId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    createdAt: v.number(),
    metadata: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index('by_thread', ['threadId'])
    .index('by_thread_message', ['threadId', 'messageId'])
    .index('by_campaign_thread', ['campaignId', 'threadId']),
});
