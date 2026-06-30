import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const ensureIdentity = async (ctx: any) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Unauthorized');
  }
  return identity;
};

const MESSAGE_FIELDS = v.object({
  id: v.string(),
  role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
  content: v.string(),
  createdAt: v.string(),
  metadata: v.optional(v.any()),
});

/**
 * Reactive message list for a thread. The chat subscribes to this via useQuery,
 * so any message written to the cache (the seller's own turns, agent replies, and
 * proactive digests written by the backend) appears live with no poll or refresh.
 */
export const listByThread = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    const rows = await ctx.db
      .query('thread_messages_cache')
      .withIndex('by_thread', q => q.eq('threadId', args.threadId))
      .collect();
    if (rows.length === 0) return [];
    // Only the owner of the parent campaign may read its cached messages.
    const campaign = await ctx.db
      .query('campaigns')
      .withIndex('by_campaign_id', q => q.eq('campaignId', rows[0].campaignId))
      .unique();
    if (!campaign || campaign.userId !== identity.subject) return [];
    rows.sort((a, b) => a.createdAt - b.createdAt);
    return rows.map(r => ({
      id: r.messageId,
      role: r.role,
      content: r.content,
      createdAt: new Date(r.createdAt).toISOString(),
      metadata: r.metadata ?? {},
    }));
  },
});

/**
 * Server-to-Convex write path. The NestJS backend has a Convex HTTP client but no
 * Clerk identity, so it calls this instead of cacheUpsertBatch. Upserts (patches an
 * existing row) so a streamed/placeholder assistant message can be finalized in
 * place. Guarded by BACKEND_INGEST_SECRET when that env var is set on the Convex
 * deployment (enforce-if-present so it ships working, hardenable by setting it).
 */
export const upsertFromBackend = mutation({
  args: {
    secret: v.optional(v.string()),
    campaignId: v.string(),
    threadId: v.string(),
    message: MESSAGE_FIELDS,
  },
  handler: async (ctx, args) => {
    const required = process.env.BACKEND_INGEST_SECRET;
    if (required && args.secret !== required) {
      throw new Error('Unauthorized backend ingest');
    }
    const m = args.message;
    const createdAtMs = new Date(m.createdAt).getTime() || Date.now();
    const now = Date.now();

    const existing = await ctx.db
      .query('thread_messages_cache')
      .withIndex('by_thread_message', q => q.eq('threadId', args.threadId).eq('messageId', m.id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        role: m.role,
        content: m.content,
        metadata: m.metadata,
        updatedAt: now,
      });
      return { updated: 1 };
    }

    await ctx.db.insert('thread_messages_cache', {
      campaignId: args.campaignId,
      threadId: args.threadId,
      messageId: m.id,
      role: m.role,
      content: m.content,
      createdAt: createdAtMs,
      metadata: m.metadata,
      updatedAt: now,
    });
    return { inserted: 1 };
  },
});

export const cacheUpsertBatch = mutation({
  args: {
    campaignId: v.string(),
    threadId: v.string(),
    messages: v.array(
      v.object({
        id: v.string(),
        role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
        content: v.string(),
        createdAt: v.string(),
        metadata: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ensureIdentity(ctx);
    const now = Date.now();
    let inserted = 0;

    for (const message of args.messages) {
      const createdAtMs = new Date(message.createdAt).getTime() || now;

      const existing = await ctx.db
        .query('thread_messages_cache')
        .withIndex('by_thread_message', q => q.eq('threadId', args.threadId).eq('messageId', message.id))
        .unique();

      if (existing) {
        continue;
      }

      await ctx.db.insert('thread_messages_cache', {
        campaignId: args.campaignId,
        threadId: args.threadId,
        messageId: message.id,
        role: message.role,
        content: message.content,
        createdAt: createdAtMs,
        metadata: message.metadata,
        updatedAt: now,
      });
      inserted += 1;
    }

    return { inserted };
  },
});
