import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const ensureIdentity = async (ctx: any) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Unauthorized');
  }
  return identity;
};

export const create = mutation({
  args: {
    campaignId: v.string(),
    threadId: v.string(),
    title: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
    status: v.optional(v.union(v.literal('active'), v.literal('archived'))),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ensureIdentity(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query('threads')
      .withIndex('by_thread_id', q => q.eq('threadId', args.threadId))
      .unique();

    if (args.isPrimary) {
      const campaignThreads = await ctx.db
        .query('threads')
        .withIndex('by_campaign', q => q.eq('campaignId', args.campaignId))
        .collect();
      await Promise.all(
        campaignThreads
          .filter(thread => thread.isPrimary)
          .map(thread => ctx.db.patch(thread._id, { isPrimary: false, updatedAt: now })),
      );
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title ?? existing.title,
        isPrimary: args.isPrimary ?? existing.isPrimary,
        status: args.status ?? existing.status,
        metadata: args.metadata ?? existing.metadata,
        updatedAt: now,
      });
      return ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert('threads', {
      campaignId: args.campaignId,
      threadId: args.threadId,
      title: args.title || 'New chat',
      status: args.status || 'active',
      isPrimary: args.isPrimary === true,
      lastMessageAt: now,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    });

    return ctx.db.get(id);
  },
});

export const listByCampaign = query({
  args: {
    campaignId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    // The threads table has no userId of its own; resolve ownership through the
    // parent campaign so one account can't read another's cached threads.
    const campaign = await ctx.db
      .query('campaigns')
      .withIndex('by_campaign_id', q => q.eq('campaignId', args.campaignId))
      .unique();
    if (!campaign || campaign.userId !== identity.subject) return [];

    const rows = await ctx.db
      .query('threads')
      .withIndex('by_campaign', q => q.eq('campaignId', args.campaignId))
      .collect();

    return rows.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  },
});

export const updateMeta = mutation({
  args: {
    threadId: v.string(),
    title: v.optional(v.string()),
    status: v.optional(v.union(v.literal('active'), v.literal('archived'))),
    isPrimary: v.optional(v.boolean()),
    metadata: v.optional(v.any()),
    lastMessageAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureIdentity(ctx);
    const existing = await ctx.db
      .query('threads')
      .withIndex('by_thread_id', q => q.eq('threadId', args.threadId))
      .unique();

    if (!existing) {
      throw new Error('Thread not found');
    }

    const now = Date.now();

    if (args.isPrimary) {
      const campaignThreads = await ctx.db
        .query('threads')
        .withIndex('by_campaign', q => q.eq('campaignId', existing.campaignId))
        .collect();
      await Promise.all(
        campaignThreads
          .filter(thread => thread.isPrimary && thread.threadId !== existing.threadId)
          .map(thread => ctx.db.patch(thread._id, { isPrimary: false, updatedAt: now })),
      );
    }

    await ctx.db.patch(existing._id, {
      title: args.title ?? existing.title,
      status: args.status ?? existing.status,
      isPrimary: args.isPrimary ?? existing.isPrimary,
      metadata: args.metadata ?? existing.metadata,
      lastMessageAt: args.lastMessageAt ?? existing.lastMessageAt,
      updatedAt: now,
    });

    return ctx.db.get(existing._id);
  },
});

export const remove = mutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureIdentity(ctx);
    const existing = await ctx.db
      .query('threads')
      .withIndex('by_thread_id', q => q.eq('threadId', args.threadId))
      .unique();

    if (!existing) {
      return { removed: false };
    }

    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});

export const removeByCampaign = mutation({
  args: {
    campaignId: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureIdentity(ctx);
    const rows = await ctx.db
      .query('threads')
      .withIndex('by_campaign', q => q.eq('campaignId', args.campaignId))
      .collect();

    await Promise.all(rows.map(row => ctx.db.delete(row._id)));
    return { removed: rows.length };
  },
});
