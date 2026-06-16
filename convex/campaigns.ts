import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const ensureIdentity = async (ctx: any) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Unauthorized');
  }
  return identity;
};

export const upsertFromSession = mutation({
  args: {
    campaignId: v.string(),
    sessionId: v.string(),
    title: v.optional(v.string()),
    status: v.string(),
    primaryThreadId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query('campaigns')
      .withIndex('by_campaign_id', q => q.eq('campaignId', args.campaignId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionId: args.sessionId,
        title: args.title,
        status: args.status,
        primaryThreadId: args.primaryThreadId,
        metadata: args.metadata,
        updatedAt: now,
      });
      return {
        ...existing,
        sessionId: args.sessionId,
        title: args.title,
        status: args.status,
        primaryThreadId: args.primaryThreadId,
        metadata: args.metadata,
        updatedAt: now,
      };
    }

    const insertedId = await ctx.db.insert('campaigns', {
      campaignId: args.campaignId,
      sessionId: args.sessionId,
      userId: identity.subject,
      title: args.title,
      status: args.status,
      primaryThreadId: args.primaryThreadId,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    });

    return ctx.db.get(insertedId);
  },
});

export const listCampaigns = query({
  args: {},
  handler: async (ctx) => {
    await ensureIdentity(ctx);
    const campaigns = await ctx.db.query('campaigns').collect();
    return campaigns.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const rename = mutation({
  args: {
    campaignId: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureIdentity(ctx);
    const existing = await ctx.db
      .query('campaigns')
      .withIndex('by_campaign_id', q => q.eq('campaignId', args.campaignId))
      .unique();

    if (!existing) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      title: args.title,
      updatedAt: now,
    });
    return ctx.db.get(existing._id);
  },
});

export const remove = mutation({
  args: {
    campaignId: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureIdentity(ctx);
    const existing = await ctx.db
      .query('campaigns')
      .withIndex('by_campaign_id', q => q.eq('campaignId', args.campaignId))
      .unique();

    if (!existing) {
      return { removed: false };
    }

    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});
