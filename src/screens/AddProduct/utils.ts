// Shared helpers for the AddProduct feature (extracted from AddProductScreen.tsx).

// Strip "scanned product/item" prefixes and dataset/quick_scan suffixes from match titles.
export const cleanMatchText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/^(scanned product|scanned item|product scan)[:\s-]*/i, '')
    .replace(/\s*\((quick_scan|.*dataset|custom_.*)\)/gi, '')
    .trim();
};
