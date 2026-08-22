// @generated from sssync-bknd/src/contracts/import-status.contract.ts (sha256:3d00af22097d)
// DO NOT EDIT — change the backend copy, then run `npm run contracts:sync` there.
import { z } from 'zod';

export const zInboxConnectionState = z.enum([
  'scanning',
  'syncing',
  'live',
  'needs-attention',
  'error',
]);
export type InboxConnectionState = z.infer<typeof zInboxConnectionState>;

export const zLegacyImportStatus = z.enum([
  'in_progress',
  'complete',
  'failed',
  'canceled',
]);
export type LegacyImportStatus = z.infer<typeof zLegacyImportStatus>;

export const zLegacyImportSource = z.enum([
  'platform_scan',
  'csv_upload',
  'camera_scan',
]);
export type LegacyImportSource = z.infer<typeof zLegacyImportSource>;

export const zRecentImport = z.object({
  importId: z.string(),
  connectionId: z.string().nullable(),
  source: zLegacyImportSource,
  status: zLegacyImportStatus,
  itemsTotal: z.number().int().nonnegative(),
  itemsCommitted: z.number().int().nonnegative(),
  itemsFailed: z.number().int().nonnegative(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  jobId: z.string().nullable(),
  phase: z.string().nullable(),
});
export type RecentImport = z.infer<typeof zRecentImport>;

export const zInboxConnectionSummary = z.object({
  connectionId: z.string(),
  platformType: z.string(),
  displayName: z.string(),
  state: zInboxConnectionState,
  needsAttention: z.number().int().nonnegative(),
  attentionCount: z.number().int().nonnegative(),
  reviewRunId: z.string().nullable(),
  jobId: z.string().nullable(),
  phase: z.string().nullable(),
  itemsSoFar: z.number().int().nonnegative(),
  itemsTotal: z.number().int().nonnegative(),
  startedAt: z.string().nullable(),
});
export type InboxConnectionSummary = z.infer<
  typeof zInboxConnectionSummary
>;

export const zInboxSummary = z.object({
  totalNeedsAttention: z.number().int().nonnegative(),
  byReason: z.record(z.string(), z.number().int().nonnegative()),
  connections: z.array(zInboxConnectionSummary),
  recentImports: z.array(zRecentImport),
});
export type InboxSummary = z.infer<typeof zInboxSummary>;
