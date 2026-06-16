import { cronJobs } from 'convex/server';
import { internalMutation } from './_generated/server';
import { internal } from './_generated/api';

// Presence rows are normally cleared by leave() or the opportunistic sweep in
// presence.heartbeat. But if every seat abandons a product without a clean leave
// (app killed / network drop / unmount race), nobody heartbeats it again and its
// stale rows would linger forever. This reaper bounds the listingPresence table
// regardless. Grace is well beyond the 15s heartbeat TTL so it never races a
// live editor; the inline heartbeat sweep still handles hot products instantly.
const PRESENCE_REAP_AFTER_MS = 60_000;
const REAP_BATCH = 200;

export const reapStalePresence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PRESENCE_REAP_AFTER_MS;
    const stale = await ctx.db
      .query('listingPresence')
      .withIndex('by_last_seen', q => q.lt('lastSeen', cutoff))
      .take(REAP_BATCH);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    return { deleted: stale.length };
  },
});

const crons = cronJobs();
crons.interval('reap stale listing presence', { minutes: 5 }, internal.crons.reapStalePresence, {});
export default crons;
