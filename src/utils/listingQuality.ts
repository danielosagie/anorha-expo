/**
 * listingQuality — a pure, advisory pre-publish heuristic.
 *
 * Given the canonical platform data + a photo count, it scores a small set of
 * "will this sell" signals and reports which are weak. It NEVER blocks publish —
 * it just surfaces a couple of quick wins. Keep it pure (no side effects, no
 * network); the proxies below are intentionally lenient so a real listing is
 * rarely flagged for everything at once.
 */

export type QualityRow = {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
};

export interface ListingQualityInput {
  canonical: any;
  photoCount: number;
  /** When known (e.g. real eBay aspect schema), the required item-specifics count. */
  requiredAspects?: number;
  /** How many of the required item specifics are filled. */
  filledAspects?: number;
}

export interface ListingQualityResult {
  rows: QualityRow[];
  weakCount: number;
  isStrong: boolean;
}

export function getListingQuality(input: ListingQualityInput): ListingQualityResult {
  const { canonical, photoCount, requiredAspects, filledAspects } = input;
  const c = canonical || {};

  const title = (c.title || '').toString();
  const titleWords = title.trim().length ? title.trim().split(/\s+/).length : 0;

  const aspectsOk =
    typeof requiredAspects === 'number'
      ? (filledAspects ?? 0) >= requiredAspects
      : Object.keys(c.itemSpecifics || {}).length >= 3;

  const rows: QualityRow[] = [
    {
      key: 'photos',
      label: 'Photos',
      ok: photoCount >= 3,
      hint: 'Add 1–2 more photos',
    },
    {
      key: 'title',
      label: 'Title keywords',
      ok: titleWords >= 4 || title.length >= 20,
      hint: 'Make the title more specific',
    },
    {
      key: 'category',
      label: 'Category',
      ok: !!(c.productCategoryId || c.categoryId),
      hint: 'Pick a category',
    },
    {
      key: 'itemSpecifics',
      label: 'Item specifics',
      ok: aspectsOk,
      hint: 'Fill required item specifics',
    },
    {
      // SOFT signal — never the only blocker. Always last so weak-first sorting
      // keeps the harder signals above it.
      key: 'price',
      label: 'Price vs market',
      ok: !!(c.aiPriceRecommendation || c.aiRecommendedPrice),
      hint: 'Check it against recent sales',
    },
  ];

  const weakCount = rows.filter((r) => !r.ok).length;
  const isStrong = weakCount === 0;

  return { rows, weakCount, isStrong };
}
