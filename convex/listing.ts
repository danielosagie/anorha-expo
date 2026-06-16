import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getValidGrant } from './grants';

/**
 * Editor lane — live multi-seat co-editing of a listing draft.
 *
 * Convex holds the live DRAFT only. Supabase ProductVariants is the
 * system-of-record and NestJS `PUT /products/:id` is the sole commit boundary.
 * Each editable field is an independent last-write-wins cell (see schema.ts).
 *
 * Authorization is enforced purely off draftGrants (see grants.ts): NestJS
 * verifies the caller's Supabase OrgMembership for the product and writes a
 * short-lived grant; here we require that grant and derive orgId FROM it. A
 * client-supplied orgId is never trusted.
 */

const ensureIdentity = async (ctx: any) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Unauthorized');
  }
  return identity;
};

/** Mutations require a live grant; throws if absent/expired. Returns the grant. */
const requireGrant = async (ctx: any, identity: any, productId: string) => {
  const grant = await getValidGrant(ctx, identity.subject, productId);
  if (!grant) {
    throw new Error('No draft-access grant for this product');
  }
  return grant;
};

/**
 * Returns the single canonical draft for a product, creating it if absent.
 *
 * Create-safe (#B1): two seats opening the same product can race two INSERTs
 * (Convex has no unique index on productId). After an insert we re-scan the
 * `by_product` range with `.collect()` — this widens the read set over the range
 * so a racing inserter conflicts and Convex OCC retries it (on retry it sees the
 * committed row and takes the existing branch). If a duplicate still slipped
 * through, we fold every dupe's field cells into the earliest-created canonical
 * row via per-cell LWW (newer `editedAt` wins) and delete the dupes, so no
 * orphaned keystroke is ever lost.
 */
const ensureCanonicalDraft = async (
  ctx: any,
  productId: string,
  orgId: string,
  baseRevision?: number,
) => {
  const existing = await ctx.db
    .query('listingDrafts')
    .withIndex('by_product', (q: any) => q.eq('productId', productId))
    .first();
  if (existing) {
    return existing;
  }

  const now = Date.now();
  await ctx.db.insert('listingDrafts', {
    productId,
    orgId,
    fields: {},
    baseRevision,
    createdAt: now,
    updatedAt: now,
  });

  const all = await ctx.db
    .query('listingDrafts')
    .withIndex('by_product', (q: any) => q.eq('productId', productId))
    .collect();
  all.sort((a: any, b: any) => a._creationTime - b._creationTime);
  const canonical = all[0];

  if (all.length > 1) {
    const mergedFields: Record<string, any> = { ...canonical.fields };
    for (let i = 1; i < all.length; i++) {
      const dupe = all[i];
      for (const [field, cell] of Object.entries(dupe.fields as Record<string, any>)) {
        const cur = mergedFields[field];
        if (!cur || cell.editedAt > cur.editedAt) {
          mergedFields[field] = cell;
        }
      }
      await ctx.db.delete(dupe._id);
    }
    await ctx.db.patch(canonical._id, { fields: mergedFields, updatedAt: now });
    return { ...canonical, fields: mergedFields };
  }

  return canonical;
};

/**
 * Reactive read of a product's live draft. Subscribers re-render on any cell
 * change. Returns null (rather than throwing) when the grant is absent/expired
 * so the subscription degrades gracefully while the client refreshes its grant.
 */
export const getDraft = query({
  args: { productId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    const grant = await getValidGrant(ctx, identity.subject, args.productId);
    if (!grant) {
      return null;
    }
    const draft = await ctx.db
      .query('listingDrafts')
      .withIndex('by_product', q => q.eq('productId', args.productId))
      // .first() (not .unique()): a concurrent-open race can briefly leave a
      // duplicate before the fold in ensureCanonicalDraft collapses it.
      .first();
    if (!draft || draft.orgId !== grant.orgId) {
      return null;
    }
    return draft;
  },
});

/**
 * Open (or converge on) a draft, stamping the base RevisionVersion captured from
 * Supabase at open time so the commit boundary can detect drift (409).
 */
export const openDraft = mutation({
  args: {
    productId: v.string(),
    baseRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    const grant = await requireGrant(ctx, identity, args.productId);
    const canonical = await ensureCanonicalDraft(ctx, args.productId, grant.orgId, args.baseRevision);

    // #B5: RevisionVersion is monotonic — only ever move the drift baseline
    // FORWARD. A re-open with a stale/cached lower revision must not weaken the
    // commit-time 409 guard.
    if (
      args.baseRevision !== undefined &&
      (canonical.baseRevision === undefined || args.baseRevision > canonical.baseRevision)
    ) {
      await ctx.db.patch(canonical._id, { baseRevision: args.baseRevision, updatedAt: Date.now() });
    }
    return canonical._id;
  },
});

/**
 * Write one field as a last-write-wins cell. Routes creation through
 * ensureCanonicalDraft so a first-edit race can't split the product into two
 * drafts (#B1). Convex serializes mutations, so the later writer wins for the
 * same field and concurrent edits to DIFFERENT fields both survive (the OCC
 * retry re-reads and re-merges the fields record). `editedAt` is server time —
 * no client clock skew. `editedBy` is the server-side Clerk subject — unspoofable.
 */
export const setField = mutation({
  args: {
    productId: v.string(),
    field: v.string(),
    value: v.any(),
    editedByName: v.optional(v.string()),
    baseRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ensureIdentity(ctx);
    const grant = await requireGrant(ctx, identity, args.productId);
    const canonical = await ensureCanonicalDraft(ctx, args.productId, grant.orgId, args.baseRevision);

    const now = Date.now();
    const cell = {
      value: args.value,
      editedBy: identity.subject as string,
      editedByName: args.editedByName,
      editedAt: now,
    };
    await ctx.db.patch(canonical._id, {
      fields: { ...canonical.fields, [args.field]: cell },
      updatedAt: now,
    });
    return canonical._id;
  },
});

/**
 * Backend-only. After NestJS commits the draft to Supabase ProductVariants it
 * calls this to stamp the committed revision so clients can show "saved" and
 * detect their edits-since-commit. Fails CLOSED (throws when
 * BACKEND_INGEST_SECRET is unset). Keyed to the exact draftId NestJS committed
 * (#B4) — not "first by product" — so it can't stamp the wrong (orphan) draft,
 * and asserts product+org match so the secret holder can't stamp across tenants.
 */
export const markCommitted = mutation({
  args: {
    secret: v.optional(v.string()),
    draftId: v.id('listingDrafts'),
    productId: v.string(),
    orgId: v.string(),
    committedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const required = process.env.BACKEND_INGEST_SECRET;
    if (!required) {
      throw new Error('BACKEND_INGEST_SECRET not configured');
    }
    if (args.secret !== required) {
      throw new Error('Unauthorized backend ingest');
    }

    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      return { updated: 0 };
    }
    if (draft.productId !== args.productId || draft.orgId !== args.orgId) {
      throw new Error('Draft does not match product/org');
    }
    const now = Date.now();
    await ctx.db.patch(args.draftId, {
      committedRevision: args.committedRevision,
      committedAt: now,
      updatedAt: now,
    });
    return { updated: 1 };
  },
});
