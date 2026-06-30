import { internalMutation, mutation, query } from './_generated/server';
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
        // Backfill ownership so older rows (inserted before userId existed) become
        // visible to their owner — and only their owner — via the by_user_id index.
        userId: existing.userId || identity.subject,
        title: args.title,
        status: args.status,
        primaryThreadId: args.primaryThreadId,
        metadata: args.metadata,
        updatedAt: now,
      });
      return {
        ...existing,
        sessionId: args.sessionId,
        userId: existing.userId || identity.subject,
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
    const identity = await ensureIdentity(ctx);
    // Scope to the signed-in user. Previously this returned EVERY user's cached
    // campaigns to anyone logged in (it only checked that *some* identity existed),
    // so a freshly signed-in account saw the previous account's campaigns — a
    // cross-account data leak. The owner is recorded as userId on insert/upsert.
    const campaigns = await ctx.db
      .query('campaigns')
      .withIndex('by_user_id', q => q.eq('userId', identity.subject))
      .collect();
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

// One-time maintenance: re-claim campaign cache rows that predate the userId field
// (or were inserted without one) so the owner-scoped listCampaigns shows them again
// after the cross-account-leak fix. INTERNAL — only callable via the Convex CLI /
// dashboard, never from a client. Ownership is resolved OFF Convex (each campaign's
// session → AgentSessions.OrgId → owner) and passed in. Only fills rows whose userId
// is currently empty; never reassigns an existing owner.
export const backfillOwners = internalMutation({
  args: {
    assignments: v.array(v.object({ campaignId: v.string(), userId: v.string() })),
  },
  handler: async (ctx, args) => {
    let patched = 0;
    const skipped: string[] = [];
    for (const a of args.assignments) {
      const row = await ctx.db
        .query('campaigns')
        .withIndex('by_campaign_id', q => q.eq('campaignId', a.campaignId))
        .unique();
      if (row && !row.userId) {
        await ctx.db.patch(row._id, { userId: a.userId });
        patched += 1;
      } else {
        skipped.push(a.campaignId);
      }
    }
    return { patched, skipped };
  },
});
