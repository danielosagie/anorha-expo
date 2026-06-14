/**
 * Zod schema — SINGLE SOURCE OF TRUTH for the data model (T3-style: one schema,
 * types are z.infer'd from it, the same schema validates at runtime).
 *
 * PascalCase to match the Postgres columns + the Supabase wire exactly (zero mapping on
 * the read/write path). `database.types.ts` derives its Row types from these schemas, so
 * there is ONE definition feeding both the typed Supabase client AND runtime validation.
 *
 * ⚠️ Long-term this should be GENERATED from the DB so it can't drift:
 *   supabase gen types typescript ... > database.types.ts   # then ts-to-zod, OR
 *   drizzle-zod on the backend (camelCase) -> mapped to PascalCase here.
 * Until that pipeline runs, keep these aligned with src/types/database.types.ts.
 *
 * jsonb columns use z.record(z.any()) (non-recursive) — a recursive Json schema trips
 * Legend State's deep observable generics (TS2589).
 */
import { z } from 'zod';

const json = () => z.record(z.any());

export const ProductsRowSchema = z.object({
  Id: z.string(),
  UserId: z.string(),
  IsArchived: z.boolean(),
  CreatedAt: z.string(),
  UpdatedAt: z.string(),
  OrgId: z.string().nullable(),
});

export const ProductVariantsRowSchema = z.object({
  Id: z.string(),
  ProductId: z.string(),
  UserId: z.string(),
  Sku: z.string(),
  Barcode: z.string().nullable(),
  Title: z.string(),
  Description: z.string().nullable(),
  Price: z.number(),
  CompareAtPrice: z.number().nullable(),
  Weight: z.number().nullable(),
  WeightUnit: z.string().nullable(),
  Options: json().nullable(),
  CreatedAt: z.string(),
  UpdatedAt: z.string(),
  status: z.string().nullable(),
  Cost: z.number().nullable(),
  RequiresShipping: z.boolean().nullable(),
  IsTaxable: z.boolean().nullable(),
  TaxCode: z.string().nullable(),
  ImageId: z.string().nullable(),
  OnShopify: z.boolean(),
  OnSquare: z.boolean(),
  OnClover: z.boolean(),
  OnAmazon: z.boolean(),
  OnEbay: z.boolean(),
  OnFacebook: z.boolean(),
  Metadata: json().nullable(),
  IsArchived: z.boolean().nullable(),
  PrimaryImageUrl: z.string().nullable(),
  Tags: z.array(z.string()).nullable(),
  VariantType: z.enum(['flat', 'base', 'option']).nullable(),
  SourceVariantId: z.string().nullable(),
  SourceOrgId: z.string().nullable(),
  ForkedAt: z.string().nullable(),
  RevisionVersion: z.number(),
});

export const InventoryLevelsRowSchema = z.object({
  Id: z.string(),
  ProductVariantId: z.string(),
  PlatformConnectionId: z.string().nullable(),
  PlatformLocationId: z.string().nullable(),
  Quantity: z.number(),
  UpdatedAt: z.string(),
  Price: z.number().nullable(),
  CompareAtPrice: z.number().nullable(),
  Currency: z.string().nullable(),
  LastDeltaAt: z.string().nullable(),
  Reason: z.string().nullable(),
  SourceId: z.string().nullable(),
  OrgId: z.string(),
  PoolId: z.string().nullable(),
  LastPlatformUpdateAt: z.string().nullable(),
  Version: z.number(),
});

export const PlatformProductMappingsRowSchema = z.object({
  Id: z.string(),
  PlatformConnectionId: z.string(),
  ProductVariantId: z.string(),
  PlatformProductId: z.string(),
  PlatformVariantId: z.string().nullable(),
  PlatformSku: z.string().nullable(),
  PlatformSpecificData: json().nullable(),
  LastSyncedAt: z.string().nullable(),
  SyncStatus: z.string(),
  SyncErrorMessage: z.string().nullable(),
  IsEnabled: z.boolean(),
  CreatedAt: z.string(),
  UpdatedAt: z.string(),
  ConnectionPrice: z.number().nullable(),
  ConnectionCompareAtPrice: z.number().nullable(),
  Currency: z.string().nullable(),
  LastSyncedBy: z.enum(['anorha', 'platform', 'webhook']).nullable(),
  SyncMetadata: json(),
  PlatformInventoryItemId: z.string().nullable(),
});

export const PlatformConnectionsRowSchema = z.object({
  Id: z.string(),
  UserId: z.string(),
  PlatformType: z.string(),
  DisplayName: z.string(),
  Credentials: json(),
  Status: z.string(),
  IsEnabled: z.boolean(),
  LastSyncAttemptAt: z.string().nullable(),
  LastSyncSuccessAt: z.string().nullable(),
  CreatedAt: z.string(),
  UpdatedAt: z.string(),
  PlatformSpecificData: json().nullable(),
  SyncRules: json().nullable(),
  OrgId: z.string().nullable(),
  pool_id: z.string().nullable(),
  NeedsReauth: z.boolean().nullable(),
  RecommendedAction: z.string().nullable(),
});

export const ProductImagesRowSchema = z.object({
  Id: z.string(),
  ProductVariantId: z.string(),
  ImageUrl: z.string(),
  AltText: z.string().nullable(),
  Position: z.number(),
  PlatformMappingId: z.string().nullable(),
  CreatedAt: z.string(),
  UpdatedAt: z.string(),
});

/** Map of table name -> row schema, for generic validation helpers. */
export const rowSchemas = {
  Products: ProductsRowSchema,
  ProductVariants: ProductVariantsRowSchema,
  InventoryLevels: InventoryLevelsRowSchema,
  PlatformProductMappings: PlatformProductMappingsRowSchema,
  PlatformConnections: PlatformConnectionsRowSchema,
  ProductImages: ProductImagesRowSchema,
} as const;

export type RowSchemas = typeof rowSchemas;
