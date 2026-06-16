import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getValidGrant } from './grants';

/**
 * Editor-lane presence — who is viewing/editing a listing and which field they
 * have focused. Drives "Dani is editing Price" avatars/carets. Intentionally
 * tiny so a heartbeat is near-free. Stale rows are swept opportunistically on
 * each heartbeat (and by the crons.ts reaper). With true field-level LWW,
 * presence is a soft hint, not a lock.
 *
 * Access is gated by the same draftGrants used by the editor (see grants.ts):
 * org is derived from the grant, never trusted from a client arg.
 */

// A seat is "present" if it heartbeat within this window. Clients should
// heartbeat at roughly TTL/3 (~5s) while a listing is focused.
const PRESENCE_TTL_MS = 15_000;

const ensureIdentity = async (ctx: any) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Unauthorized');
  }
  return identity;
};

/**
 * Live list of seats currently present on a product (stale entries filtered
 * out). Returns [] when the grant is absent/expired so the subscription
 * degrades gracefully rather than throwing.
 */
export const listByProduct = query({
  args: { productId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    const grant = await getValidGrant(ctx, identity.subject, args.productId);
    if (!grant) {
      return [];
    }
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const rows = await ctx.db
      .query('listingPresence')
      .withIndex('by_product', q => q.eq('productId', args.productId))
      .collect();
    return rows
      .filter(r => r.lastSeen >= cutoff)
      .map(r => ({
        userId: r.userId,
        displayName: r.displayName,
        activeField: r.activeField,
        lastSeen: r.lastSeen,
      }));
  },
});

/**
 * Upsert this seat's presence (call on focus + on an interval). Also sweeps
 * stale rows for the same product so the table stays small without a cron.
 * Requires a live grant; org is taken from the grant.
 */
export const heartbeat = mutation({
  args: {
    productId: v.string(),
    displayName: v.optional(v.string()),
    activeField: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    const grant = await getValidGrant(ctx, identity.subject, args.productId);
    if (!grant) {
      throw new Error('No draft-access grant for this product');
    }
    const userId = identity.subject as string;
    const now = Date.now();

    const rows = await ctx.db
      .query('listingPresence')
      .withIndex('by_product', q => q.eq('productId', args.productId))
      .collect();

    // Opportunistic stale sweep (bounded by the seat count on this product) +
    // dedupe of my own rows (a same-user multi-device race can insert two).
    // mineRows and the stale-delete set are disjoint by construction; keep's
    // patch must stay last.
    const cutoff = now - PRESENCE_TTL_MS;
    const mineRows: typeof rows = [];
    for (const row of rows) {
      if (row.userId === userId) {
        mineRows.push(row);
      } else if (row.lastSeen < cutoff) {
        await ctx.db.delete(row._id);
      }
    }

    if (mineRows.length > 0) {
      const [keep, ...extras] = mineRows;
      for (const extra of extras) {
        await ctx.db.delete(extra._id);
      }
      await ctx.db.patch(keep._id, {
        displayName: args.displayName ?? keep.displayName,
        activeField: args.activeField,
        lastSeen: now,
      });
      return keep._id;
    }

    return ctx.db.insert('listingPresence', {
      productId: args.productId,
      orgId: grant.orgId,
      userId,
      displayName: args.displayName,
      activeField: args.activeField,
      lastSeen: now,
    });
  },
});

/**
 * Drop this seat's presence (call on blur/unmount). Identity-only — a user can
 * always remove their own presence even after their grant has expired.
 */
export const leave = mutation({
  args: { productId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    const userId = identity.subject as string;
    // Delete all my rows (not .unique() — a multi-device race can leave dupes).
    const mineRows = await ctx.db
      .query('listingPresence')
      .withIndex('by_product_user', q =>
        q.eq('productId', args.productId).eq('userId', userId),
      )
      .collect();
    for (const row of mineRows) {
      await ctx.db.delete(row._id);
    }
    return { left: mineRows.length };
  },
});
