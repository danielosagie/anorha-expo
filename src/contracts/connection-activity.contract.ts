// @generated from sssync-bknd/src/contracts/connection-activity.contract.ts (sha256:16a1b6a12acc)
// DO NOT EDIT — change the backend copy, then run `npm run contracts:sync` there.
import { z } from 'zod';

export const zImportRunStatus = z.enum([
    'queued',
    'scanning',
    'awaiting_review',
    'committing',
    'succeeded',
    'failed',
    'canceled',
]);
export type ImportRunStatus = z.infer<typeof zImportRunStatus>;

export const zImportRun = z.object({
    id: z.string().uuid(),
    connectionId: z.string().uuid().nullable(),
    source: z.enum(['platform_scan', 'reconciliation', 'csv_upload', 'camera_scan']),
    status: zImportRunStatus,
    phase: z.string().nullable(),
    itemsProcessed: z.number().int().nonnegative(),
    itemsTotal: z.number().int().nonnegative(),
    itemsFailed: z.number().int().nonnegative(),
    jobId: z.string().nullable(),
    leaseExpiresAt: z.string().nullable(),
    error: z.record(z.string(), z.unknown()).nullable(),
    idempotencyKey: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().nullable(),
    canceledAt: z.string().nullable(),
});
export type ImportRun = z.infer<typeof zImportRun>;

export const zStartImportRequest = z.object({
    idempotencyKey: z.string().trim().min(1).max(255).optional(),
});
export type StartImportRequest = z.infer<typeof zStartImportRequest>;

export const zStartImportResponse = z.object({
    run: zImportRun,
    reused: z.boolean(),
});
export type StartImportResponse = z.infer<typeof zStartImportResponse>;

export const zConnectionActivityCapability = z.enum(['realtime', 'scheduled', 'browser']);
export type ConnectionActivityCapability = z.infer<typeof zConnectionActivityCapability>;

export const zConnectionActivityButton = z.object({
    kind: z.enum(['connect', 'importing', 'review', 'synced', 'reconnect', 'retry', 'resume', 'cancel']),
    label: z.string(),
    count: z.number().int().nonnegative().optional(),
    phase: z.string().optional(),
    processed: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
});
export type ConnectionActivityButton = z.infer<typeof zConnectionActivityButton>;

export const zConnectionActivity = z.object({
    connection: z.object({
        id: z.string().uuid(),
        platformType: z.string(),
        displayName: z.string(),
        enabled: z.boolean(),
        needsReauth: z.boolean(),
        reauthReason: z.string().nullable(),
    }),
    capability: zConnectionActivityCapability,
    activeRun: zImportRun.nullable(),
    lastRun: zImportRun.nullable(),
    attentionCount: z.number().int().nonnegative(),
    button: zConnectionActivityButton,
});
export type ConnectionActivity = z.infer<typeof zConnectionActivity>;

export const zConnectionActivityList = z.object({
    activities: z.array(zConnectionActivity),
});
export type ConnectionActivityList = z.infer<typeof zConnectionActivityList>;
