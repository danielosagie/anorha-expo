import {
  PRODUCT_EDITABILITY_MANIFEST,
  PRODUCT_PARENT_PATCH_FIELDS,
  PRODUCT_VARIANT_PATCH_FIELDS,
  type ProductParentPatch,
  type ProductParentPatchField,
  type ProductVariantPatch,
  type ProductVariantPatchField,
} from '../contracts/product-patch.contract.ts';

type EditorContractBinding =
  | { scope: 'parent'; field: ProductParentPatchField }
  | { scope: 'variant'; field: ProductVariantPatchField }
  | { scope: 'images'; field: 'ProductImages' };

// These are only the canonical fields the existing ListingEditorForm already
// renders. Platform-only taxonomy, shipping, and marketplace metadata remain
// platform payload fields and are intentionally not reclassified here.
const PRODUCT_EDITOR_CONTRACT_BINDINGS = {
  title: { scope: 'parent', field: 'Title' },
  description: { scope: 'parent', field: 'Description' },
  vendor: { scope: 'parent', field: 'Vendor' },
  brand: { scope: 'parent', field: 'Brand' },
  tags: { scope: 'parent', field: 'Tags' },
  productType: { scope: 'parent', field: 'ProductType' },
  seoTitle: { scope: 'parent', field: 'SeoTitle' },
  seoDescription: { scope: 'parent', field: 'SeoDescription' },
  sku: { scope: 'variant', field: 'Sku' },
  barcode: { scope: 'variant', field: 'Barcode' },
  price: { scope: 'variant', field: 'Price' },
  compareAtPrice: { scope: 'variant', field: 'CompareAtPrice' },
  weight: { scope: 'variant', field: 'Weight' },
  weightUnit: { scope: 'variant', field: 'WeightUnit' },
  condition: { scope: 'variant', field: 'Condition' },
  images: { scope: 'images', field: 'ProductImages' },
  imageUris: { scope: 'images', field: 'ProductImages' },
  imageUrls: { scope: 'images', field: 'ProductImages' },
  photos: { scope: 'images', field: 'ProductImages' },
} as const satisfies Record<string, EditorContractBinding>;

export type ProductEditorContractField = keyof typeof PRODUCT_EDITOR_CONTRACT_BINDINGS;

export function isContractProductEditorField(field: string): field is ProductEditorContractField {
  return Object.prototype.hasOwnProperty.call(PRODUCT_EDITOR_CONTRACT_BINDINGS, field);
}

export function isProductEditorFieldEditable(field: string): boolean {
  if (!isContractProductEditorField(field)) return false;
  const binding = PRODUCT_EDITOR_CONTRACT_BINDINGS[field];
  if (binding.scope === 'images') {
    return PRODUCT_EDITABILITY_MANIFEST.images.ProductImages.editability === 'set';
  }
  if (binding.scope === 'parent') {
    return PRODUCT_PARENT_PATCH_FIELDS.includes(binding.field)
      && Object.prototype.hasOwnProperty.call(PRODUCT_EDITABILITY_MANIFEST.parent, binding.field);
  }
  return PRODUCT_VARIANT_PATCH_FIELDS.includes(binding.field)
    && Object.prototype.hasOwnProperty.call(PRODUCT_EDITABILITY_MANIFEST.variant, binding.field);
}

export const PRODUCT_EDITOR_FIELD_KEYS = Object.freeze(
  (Object.keys(PRODUCT_EDITOR_CONTRACT_BINDINGS) as ProductEditorContractField[])
    .filter(isProductEditorFieldEditable),
);

export function pickEditableProductPatch(
  parentSource: Partial<Record<ProductParentPatchField, unknown>>,
  variantSource: Partial<Record<ProductVariantPatchField, unknown>>,
): { parent: ProductParentPatch; variant: ProductVariantPatch; flat: Record<string, unknown> } {
  const parent: Record<string, unknown> = {};
  const variant: Record<string, unknown> = {};

  for (const field of PRODUCT_PARENT_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(PRODUCT_EDITABILITY_MANIFEST.parent, field)
      && Object.prototype.hasOwnProperty.call(parentSource, field)
      && parentSource[field] !== undefined) {
      parent[field] = parentSource[field];
    }
  }
  for (const field of PRODUCT_VARIANT_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(PRODUCT_EDITABILITY_MANIFEST.variant, field)
      && Object.prototype.hasOwnProperty.call(variantSource, field)
      && variantSource[field] !== undefined) {
      variant[field] = variantSource[field];
    }
  }

  return {
    parent: parent as ProductParentPatch,
    variant: variant as ProductVariantPatch,
    // The existing mobile PUT endpoint accepts the canonical fields flattened;
    // the backend separates them into ProductPatch.parent / ProductPatch.variant.
    flat: { ...parent, ...variant },
  };
}
