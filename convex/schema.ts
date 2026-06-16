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

  // ── Editor lane: live multi-seat co-editing of a listing ──────────────────
  // Convex is the live DRAFT overlay. Supabase ProductVariants stays the
  // system-of-record; NestJS `PUT /products/:id` is the sole commit boundary.
  // One row per product; each editable scalar/array field is an independent
  // last-write-wins (LWW) cell so two seats editing DIFFERENT fields never
  // clobber each other (Convex serializes mutations, so same-field edits
  // resolve to the later writer). NO CRDT / prosemirror — cheap + native-RN.
  listingDrafts: defineTable({
    // Supabase ProductVariants.Id — the key PUT /products/:id uses. NOTE: this
    // is the VARIANT id, not Products.Id (the documented :id trap).
    productId: v.string(),
    // Supabase OrgId — every read/write is scoped to this. Authorization that
    // the caller belongs to this org is enforced via a NestJS-minted capability
    // token (see ensureOrgAccess TODO in listing.ts), NOT trusted from args.
    orgId: v.string(),
    fields: v.record(
      v.string(),
      v.object({
        value: v.any(),
        editedBy: v.string(), // Clerk subject (user_xxx); → Users.Id at commit
        editedByName: v.optional(v.string()),
        editedAt: v.number(), // server ms; LWW tiebreaker + "edited Ns ago"
      }),
    ),
    // ProductVariants.RevisionVersion (migration 20260513) captured at draft
    // open; the commit boundary 409s if the live row moved past this.
    baseRevision: v.optional(v.number()),
    committedRevision: v.optional(v.number()),
    committedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_product', ['productId'])
    .index('by_org', ['orgId']),

  // Capability grants — the REAL authorization for the editor lane. Convex has
  // no RLS and the Clerk token carries no org membership (org lives in Supabase
  // OrgMemberships). NestJS verifies the caller's membership for a product, then
  // writes a short-lived grant here (via grantDraftAccess, backend-secret). Every
  // editor read/write requires a non-expired grant for (clerkSubject, productId)
  // and derives orgId FROM the grant — a client-supplied orgId is never trusted.
  draftGrants: defineTable({
    userId: v.string(), // Clerk subject (identity.subject)
    productId: v.string(),
    orgId: v.string(),
    role: v.optional(v.string()), // org role, for future field-level perms
    expiresAt: v.number(),
  }).index('by_user_product', ['userId', 'productId']),

  // Ephemeral presence: who is viewing/editing a listing and which field they
  // have focused. Kept tiny (no payload) so a heartbeat costs almost nothing.
  // Stale rows (lastSeen older than the TTL) are swept opportunistically.
  listingPresence: defineTable({
    productId: v.string(),
    orgId: v.string(),
    userId: v.string(), // Clerk subject
    displayName: v.optional(v.string()),
    activeField: v.optional(v.string()),
    lastSeen: v.number(), // server ms heartbeat
  })
    .index('by_product', ['productId'])
    .index('by_product_user', ['productId', 'userId'])
    // For the periodic reaper (crons.ts) that deletes presence rows abandoned
    // without a clean leave() — bounds the table for products no one revisits.
    .index('by_last_seen', ['lastSeen']),
});
