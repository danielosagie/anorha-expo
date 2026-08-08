type ProductTitleJoin =
  | { Title?: string | null }
  | Array<{ Title?: string | null }>
  | null;

type VariantTitleSource = {
  Title?: string | null;
  VariantType?: string | null;
  Options?: Record<string, unknown> | null;
  Products?: ProductTitleJoin;
};

export function getProductVariantDisplayTitle(variant: VariantTitleSource | null | undefined): string | null | undefined {
  if (!variant) return undefined;
  const parent = Array.isArray(variant.Products) ? variant.Products[0] : variant.Products;
  const hasOptions = variant.Options
    && typeof variant.Options === 'object'
    && Object.keys(variant.Options).length > 0;
  const isOptionVariant = variant.VariantType === 'option' || hasOptions;
  return isOptionVariant ? variant.Title : parent?.Title ?? variant.Title;
}

export function projectProductVariantTitle<T extends VariantTitleSource>(variant: T): T {
  return {
    ...variant,
    Title: getProductVariantDisplayTitle(variant),
  };
}
