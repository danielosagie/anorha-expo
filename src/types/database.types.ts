/**
 * Database types — SINGLE SOURCE OF TRUTH for the data model.
 *
 * The mobile app, the backend (Drizzle), and Supabase realtime all read the SAME
 * Postgres database. This file mirrors that schema so the frontend stops hand-maintaining
 * divergent copies (previously: SupaLegend.ts interfaces + product.types.ts + the backend's
 * own copies, kept "in sync" by hand).
 *
 * ⚠️ REGENERATE — do not hand-edit long-term. Run `npm run db:types`, i.e.:
 *   supabase gen types typescript --project-id <PROJECT_ID> --schema public > src/types/database.types.ts
 *
 * Authored from the introspected Drizzle schema (sssync-bknd/drizzle/schema.ts) with EXACT
 * Postgres column casing — note the deliberate exceptions: ProductVariants."status" is
 * lowercase, PlatformConnections."pool_id" is snake_case. Money columns are Postgres
 * `numeric` surfaced as `number` (precision caveat).
 *
 * NOTE: Row shapes are declared as named interfaces (not inline) so consumers can `extend`
 * them without TS hitting "excessively deep" instantiation through Legend State's generics.
 */

// NOTE: jsonb columns below are typed as `Record<string, any>` rather than this recursive
// `Json` type — the recursive form trips Legend State's deep observable generics (TS2589).
// If you regenerate via `supabase gen types`, re-apply that substitution for Legend-managed rows.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface ProductsRow {
  Id: string;
  UserId: string;
  IsArchived: boolean;
  CreatedAt: string;
  UpdatedAt: string;
  OrgId: string | null;
}

export interface ProductVariantsRow {
  Id: string;
  ProductId: string;
  UserId: string;
  Sku: string;
  Barcode: string | null;
  Title: string;
  Description: string | null;
  Price: number; // numeric
  CompareAtPrice: number | null; // numeric
  Weight: number | null; // numeric
  WeightUnit: string | null;
  Options: Record<string, any> | null; // jsonb { "Size": "S", "Color": "Red" }
  CreatedAt: string;
  UpdatedAt: string;
  status: string | null; // NB: lowercase column in Postgres
  Cost: number | null; // real
  RequiresShipping: boolean | null;
  IsTaxable: boolean | null;
  TaxCode: string | null;
  ImageId: string | null;
  OnShopify: boolean;
  OnSquare: boolean;
  OnClover: boolean;
  OnAmazon: boolean;
  OnEbay: boolean;
  OnFacebook: boolean;
  Metadata: Record<string, any> | null; // jsonb
  IsArchived: boolean | null;
  PrimaryImageUrl: string | null;
  Tags: string[] | null;
  VariantType: 'flat' | 'base' | 'option' | null;
  SourceVariantId: string | null;
  SourceOrgId: string | null;
  ForkedAt: string | null;
  RevisionVersion: number; // optimistic concurrency
}

export interface InventoryLevelsRow {
  Id: string;
  ProductVariantId: string;
  PlatformConnectionId: string | null;
  PlatformLocationId: string | null;
  Quantity: number; // integer
  UpdatedAt: string;
  Price: number | null; // numeric
  CompareAtPrice: number | null; // numeric
  Currency: string | null; // default 'USD'
  LastDeltaAt: string | null;
  Reason: string | null;
  SourceId: string | null;
  OrgId: string;
  PoolId: string | null;
  LastPlatformUpdateAt: string | null;
  Version: number; // optimistic concurrency, default 1
}

export interface PlatformProductMappingsRow {
  Id: string;
  PlatformConnectionId: string;
  ProductVariantId: string;
  PlatformProductId: string;
  PlatformVariantId: string | null;
  PlatformSku: string | null;
  PlatformSpecificData: Record<string, any> | null;
  LastSyncedAt: string | null;
  SyncStatus: string; // default 'Pending'
  SyncErrorMessage: string | null;
  IsEnabled: boolean;
  CreatedAt: string;
  UpdatedAt: string;
  ConnectionPrice: number | null;
  ConnectionCompareAtPrice: number | null;
  Currency: string | null;
  LastSyncedBy: 'anorha' | 'platform' | 'webhook' | null;
  SyncMetadata: Record<string, any>;
  PlatformInventoryItemId: string | null;
}

export interface PlatformConnectionsRow {
  Id: string;
  UserId: string;
  PlatformType: string;
  DisplayName: string;
  Credentials: Record<string, any>;
  Status: string;
  IsEnabled: boolean;
  LastSyncAttemptAt: string | null;
  LastSyncSuccessAt: string | null;
  CreatedAt: string;
  UpdatedAt: string;
  PlatformSpecificData: Record<string, any> | null;
  SyncRules: Record<string, any> | null;
  OrgId: string | null;
  pool_id: string | null; // NB: snake_case column in Postgres
  NeedsReauth: boolean | null;
  RecommendedAction: string | null;
}

export interface ProductImagesRow {
  Id: string;
  ProductVariantId: string;
  ImageUrl: string;
  AltText: string | null;
  Position: number;
  PlatformMappingId: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

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

/** Convenience row-type aliases derived from the generated schema. */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
