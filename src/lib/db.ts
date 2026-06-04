/**
 * Data-layer safety helpers for the direct Supabase-client path.
 *
 * Because the app reads/writes Supabase directly (no REST DTO in between), the "contract"
 * is the DB schema itself, enforced here at runtime via the Zod schemas in src/types/schema.ts
 * (the single source of truth) plus optimistic-concurrency on writes. The DB's RLS +
 * CHECK/NOT NULL/FK constraints remain the ultimate backstop.
 */
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { rowSchemas } from '../types/schema';
import type { Tables } from '../types/database.types';

type TableName = keyof typeof rowSchemas;

/** Validate one untrusted row (e.g. a realtime payload). Throws on mismatch. */
export function parseRow<T extends TableName>(table: T, data: unknown): Tables<T> {
  return (rowSchemas[table] as z.ZodTypeAny).parse(data) as Tables<T>;
}

/**
 * Validate an array of rows tolerantly: returns the valid ones and logs the rest, so a
 * single malformed row never blanks the whole list. Use at read boundaries.
 */
export function safeRows<T extends TableName>(table: T, rows: unknown[]): Tables<T>[] {
  const schema = rowSchemas[table] as z.ZodTypeAny;
  const out: Tables<T>[] = [];
  for (const r of rows) {
    const res = schema.safeParse(r);
    if (res.success) out.push(res.data as Tables<T>);
    else console.warn(`[db] ${table} row failed validation:`, res.error.issues?.[0]);
  }
  return out;
}

const VERSION_COLUMN = {
  InventoryLevels: 'Version',
  ProductVariants: 'RevisionVersion',
} as const;

/**
 * Optimistic-concurrency update: writes only if the row's version column still equals
 * `expectedVersion`, then bumps it. Returns the updated (validated) row, or `null` on
 * conflict — the caller should refetch and retry/merge rather than clobber. This is the
 * fix for the lost-update risk when two devices write the same row directly.
 */
export async function guardedUpdate<T extends keyof typeof VERSION_COLUMN>(
  table: T,
  id: string,
  expectedVersion: number,
  patch: Partial<Tables<T>>,
): Promise<Tables<T> | null> {
  const col = VERSION_COLUMN[table];
  const { data, error } = await (supabase as any)
    .from(table)
    .update({ ...patch, [col]: expectedVersion + 1 })
    .eq('Id', id)
    .eq(col, expectedVersion)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) return null; // version moved on us -> conflict
  return parseRow(table, data);
}
