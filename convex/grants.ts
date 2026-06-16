import { mutation } from './_generated/server';
import { v } from 'convex/values';

/**
 * Editor-lane authorization grants.
 *
 * Convex cannot verify org membership itself (no RLS; the Clerk token carries no
 * org claim — org lives in Supabase OrgMemberships). So NestJS is the authority:
 * it checks the caller's membership for a product and then writes a short-lived
 * grant here. Editor functions enforce access purely off these grants and derive
 * the org from the grant — never from a client-supplied arg.
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour; client refreshes before expiry

/**
 * Plain helper (not a Convex function). Returns a non-expired grant for this
 * (user, product) or null. Used by listing.ts / presence.ts.
 */
export const getValidGrant = async (ctx: any, userId: string, productId: string) => {
  const grant = await ctx.db
    .query('draftGrants')
    .withIndex('by_user_product', (q: any) =>
      q.eq('userId', userId).eq('productId', productId),
    )
    .first();
  if (!grant) {
    return null;
  }
  if (grant.expiresAt <= Date.now()) {
    return null;
  }
  return grant;
};

/**
 * Backend-only. NestJS calls this AFTER verifying the user's Supabase
 * OrgMembership for the product, to mint/refresh a draft-access grant. Fails
 * closed (throws when BACKEND_INGEST_SECRET is unset).
 */
export const grantDraftAccess = mutation({
  args: {
    secret: v.optional(v.string()),
    userId: v.string(),
    productId: v.string(),
    orgId: v.string(),
    role: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const required = process.env.BACKEND_INGEST_SECRET;
    if (!required) {
      throw new Error('BACKEND_INGEST_SECRET not configured');
    }
    if (args.secret !== required) {
      throw new Error('Unauthorized backend ingest');
    }

    const expiresAt = Date.now() + (args.ttlMs ?? DEFAULT_TTL_MS);
    const existing = await ctx.db
      .query('draftGrants')
      .withIndex('by_user_product', q =>
        q.eq('userId', args.userId).eq('productId', args.productId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        orgId: args.orgId,
        role: args.role,
        expiresAt,
      });
      return existing._id;
    }

    return ctx.db.insert('draftGrants', {
      userId: args.userId,
      productId: args.productId,
      orgId: args.orgId,
      role: args.role,
      expiresAt,
    });
  },
});

/** Backend-only. Revoke a user's draft access (e.g. removed from org). Fails closed. */
export const revokeDraftAccess = mutation({
  args: {
    secret: v.optional(v.string()),
    userId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    const required = process.env.BACKEND_INGEST_SECRET;
    if (!required) {
      throw new Error('BACKEND_INGEST_SECRET not configured');
    }
    if (args.secret !== required) {
      throw new Error('Unauthorized backend ingest');
    }
    const rows = await ctx.db
      .query('draftGrants')
      .withIndex('by_user_product', q =>
        q.eq('userId', args.userId).eq('productId', args.productId),
      )
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { revoked: rows.length };
  },
});
