/**
 * Database types for the typed Supabase client (`createClient<Database>`).
 *
 * SINGLE SOURCE OF TRUTH is `src/types/schema.ts` (Zod). The row types below are
 * `z.infer`'d from those schemas — define a column once, in Zod, and get both the
 * compile-time type (here) AND runtime validation (schema.ts) with no drift.
 *
 * PascalCase matches the Postgres columns + Supabase wire exactly (note the deliberate
 * exceptions: ProductVariants."status" lowercase, PlatformConnections."pool_id" snake_case).
 * Money columns are Postgres `numeric` surfaced as `number` (precision caveat).
 *
 * ⚠️ To regenerate from the live DB: `npm run db:types` (supabase gen types), then mirror
 * any column changes into schema.ts (or run ts-to-zod). A CI drift-check should diff this
 * against a fresh `supabase gen types` so it can never silently fall behind the schema
 * Drizzle migrates.
 */
import type { z } from 'zod';
import type {
  ProductsRowSchema,
  ProductVariantsRowSchema,
  InventoryLevelsRowSchema,
  PlatformProductMappingsRowSchema,
  PlatformConnectionsRowSchema,
  ProductImagesRowSchema,
} from './schema';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProductsRow = z.infer<typeof ProductsRowSchema>;
export type ProductVariantsRow = z.infer<typeof ProductVariantsRowSchema>;
export type InventoryLevelsRow = z.infer<typeof InventoryLevelsRowSchema>;
export type PlatformProductMappingsRow = z.infer<typeof PlatformProductMappingsRowSchema>;
export type PlatformConnectionsRow = z.infer<typeof PlatformConnectionsRowSchema>;
export type ProductImagesRow = z.infer<typeof ProductImagesRowSchema>;

export interface Database {
  public: {
    Tables: {
      Products: {
        Row: ProductsRow;
        Insert: Partial<ProductsRow> & Pick<ProductsRow, 'UserId'>;
        Update: Partial<ProductsRow>;
        Relationships: [];
      };
      ProductVariants: {
        Row: ProductVariantsRow;
        Insert: Partial<ProductVariantsRow> & Pick<ProductVariantsRow, 'ProductId' | 'UserId' | 'Sku' | 'Title' | 'Price'>;
        Update: Partial<ProductVariantsRow>;
        Relationships: [];
      };
      InventoryLevels: {
        Row: InventoryLevelsRow;
        Insert: Partial<InventoryLevelsRow> & Pick<InventoryLevelsRow, 'ProductVariantId' | 'OrgId'>;
        Update: Partial<InventoryLevelsRow>;
        Relationships: [];
      };
      PlatformProductMappings: {
        Row: PlatformProductMappingsRow;
        Insert: Partial<PlatformProductMappingsRow> &
          Pick<PlatformProductMappingsRow, 'PlatformConnectionId' | 'ProductVariantId' | 'PlatformProductId'>;
        Update: Partial<PlatformProductMappingsRow>;
        Relationships: [];
      };
      PlatformConnections: {
        Row: PlatformConnectionsRow;
        Insert: Partial<PlatformConnectionsRow> &
          Pick<PlatformConnectionsRow, 'UserId' | 'PlatformType' | 'DisplayName' | 'Credentials' | 'Status'>;
        Update: Partial<PlatformConnectionsRow>;
        Relationships: [];
      };
      ProductImages: {
        Row: ProductImagesRow;
        Insert: Partial<ProductImagesRow> & Pick<ProductImagesRow, 'ProductVariantId' | 'ImageUrl'>;
        Update: Partial<ProductImagesRow>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

/** Convenience row-type aliases derived from the schema. */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
