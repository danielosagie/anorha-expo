import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const ensureIdentity = async (ctx: any) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Unauthorized');
  }
  return identity;
};

/**
 * Threads carry no userId of their own, so ownership lives on the parent
 * campaign. `listByCampaign` already resolved it that way; the mutations did
 * not, which meant any signed-in user holding someone else's campaign or thread
 * id could rename, archive, delete, or reparent their threads.
 *
 * A campaign row that is missing or unowned is not yet anyone's, so it stays
 * writable: threads are sometimes cached before the campaign upsert lands, and
 * refusing those would break the normal flow without protecting anything.
 */
const assertCampaignWritable = async (ctx: any, campaignId: string, identity: any) => {
  const campaign = await ctx.db
    .query('campaigns')
    .withIndex('by_campaign_id', (q: any) => q.eq('campaignId', campaignId))
    .unique();

  if (campaign?.userId && campaign.userId !== identity.subject) {
    throw new Error('Unauthorized');
  }
  return campaign;
};

const assertThreadWritable = async (ctx: any, thread: any, identity: any) => {
  await assertCampaignWritable(ctx, thread.campaignId, identity);
  return thread;
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
    const identity = await ensureIdentity(ctx);
    await assertCampaignWritable(ctx, args.campaignId, identity);
    const now = Date.now();

    const existing = await ctx.db
      .query('threads')
      .withIndex('by_thread_id', q => q.eq('threadId', args.threadId))
      .unique();

    // An existing thread under a different campaign must clear that campaign too,
    // otherwise this reparents someone else's thread into the caller's campaign.
    if (existing && existing.campaignId !== args.campaignId) {
      await assertCampaignWritable(ctx, existing.campaignId, identity);
    }

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
    const identity = await ensureIdentity(ctx);
    const existing = await ctx.db
      .query('threads')
      .withIndex('by_thread_id', q => q.eq('threadId', args.threadId))
      .unique();

    if (!existing) {
      throw new Error('Thread not found');
    }

    await assertThreadWritable(ctx, existing, identity);

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
    const identity = await ensureIdentity(ctx);
    const existing = await ctx.db
      .query('threads')
      .withIndex('by_thread_id', q => q.eq('threadId', args.threadId))
      .unique();

    if (!existing) {
      return { removed: false };
    }

    await assertThreadWritable(ctx, existing, identity);

    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});

export const removeByCampaign = mutation({
  args: {
    campaignId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    await assertCampaignWritable(ctx, args.campaignId, identity);

    const rows = await ctx.db
      .query('threads')
      .withIndex('by_campaign', q => q.eq('campaignId', args.campaignId))
      .collect();

    await Promise.all(rows.map(row => ctx.db.delete(row._id)));
    return { removed: rows.length };
  },
});
