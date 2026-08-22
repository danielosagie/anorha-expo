import { z } from 'zod';

export const zCancelImportReceipt = z.object({
  importId: z.string(),
  status: z.literal('canceled'),
  itemsCommitted: z.number().int().nonnegative(),
  itemsSkipped: z.number().int().nonnegative(),
  alreadyTerminal: z.boolean(),
});

export type CancelImportReceipt = z.infer<typeof zCancelImportReceipt>;

export function parseCancelImportReceipt(payload: unknown): CancelImportReceipt {
  return zCancelImportReceipt.parse(payload);
}

export function alreadyTerminalCancelCopy(receipt: CancelImportReceipt): {
  title: string;
  message: string;
} {
  return {
    title: 'Import already ended',
    message: `No changes made. ${receipt.itemsCommitted} imported. ${receipt.itemsSkipped} skipped.`,
  };
}
