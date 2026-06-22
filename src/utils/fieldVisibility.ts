// fieldVisibility.ts
// Drives which listing fields appear as top-level rows vs. behind "More details".
// Rule (per product decision): the seller only sees what the connected/selected
// platforms actually need in order to publish on ALL of them — money-movers are
// always on, each platform's required fields union in, and everything else is the
// long-tail expander. This reuses the existing requirements registry verbatim so
// the rows and the publish gate can never diverge.

import { getPlatformRequirements } from './platformRequirements';
import { getPlatform } from '../config/platforms';
import { PLATFORM_FIELD_SCHEMA } from './platformSchemas';

/**
 * Money-movers — always shown regardless of platform.
 * title + price come from every platform's registry requiredFields; sku is added
 * because isPlatformReady()/getMissingPlatformFields() force it even though it is
 * absent from the registry arrays. Unioning reqMap alone would wrongly drop SKU.
 */
export const MONEY_MOVER_FIELDS = ['title', 'price', 'sku'] as const;

export interface RequiredFieldUnion {
  /** Always-on rows (money-movers). */
  always: string[];
  /** Full set of rows to show up top = money-movers ∪ each selected platform's required fields. */
  required: string[];
  /** Concrete category field key(s) to render/write (productCategoryId | categoryId), empty if no taxonomy platform selected. */
  categoryFields: string[];
  /** Whether a Category row should be shown at all (any selected platform supportsTaxonomy). */
  showCategory: boolean;
  /** Long-tail schema fields for the "More details" expander (not in `required`). */
  optional: string[];
}

/**
 * Compute the field-visibility plan for a set of selected/connected platform keys.
 * Pass the keys the seller is actually publishing to (e.g. Object.keys(platforms)
 * filtered to enabled/publishable platforms).
 */
export function getRequiredFieldUnion(selectedKeys: string[]): RequiredFieldUnion {
  const reqMap = getPlatformRequirements(); // Record<key, string[]>
  const keys = (selectedKeys || []).filter(Boolean);

  // (a) money-movers — always on.
  const always = [...MONEY_MOVER_FIELDS];

  // (b) union of registry-required fields across the selected platforms.
  const requiredSet = new Set<string>(always);
  for (const key of keys) {
    const fields = reqMap[key] ?? [];
    for (const f of fields) requiredSet.add(f);
  }
  // 'category' is rendered via its concrete per-platform key, not the generic token.
  requiredSet.delete('category');

  // (c) category is special: required only when a selected platform supportsTaxonomy,
  //     and its data key differs per platform (productCategoryId vs categoryId).
  const categoryFields = Array.from(
    new Set(
      keys
        .map((k) => getPlatform(k)?.capabilities)
        .filter((c: any) => c?.supportsTaxonomy && c?.categoryField)
        .map((c: any) => c.categoryField as string),
    ),
  );
  const showCategory = categoryFields.length > 0;

  // (d) long-tail / "More details" = every schema field for the selected platforms
  //     that is NOT already a required/money-mover row.
  const optionalSet = new Set<string>();
  for (const key of keys) {
    const schema: Record<string, any> = (PLATFORM_FIELD_SCHEMA as any)[key] ?? {};
    for (const [fieldKey, def] of Object.entries<any>(schema)) {
      if (!def?.required && !requiredSet.has(fieldKey)) optionalSet.add(fieldKey);
    }
  }
  // Never surface nested-group containers or category-as-schema-field in the expander.
  for (const drop of ['variants', 'seo', 'listingDetails', 'images', 'category', 'productCategory']) {
    optionalSet.delete(drop);
  }

  return {
    always,
    required: Array.from(requiredSet),
    categoryFields,
    showCategory,
    optional: Array.from(optionalSet),
  };
}
