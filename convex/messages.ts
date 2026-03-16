import { mutation } from './_generated/server';
import { v } from 'convex/values';

const ensureIdentity = (ctx: any) => {
  const identity = ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Unauthorized');
  }
};

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
    ensureIdentity(ctx);
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
