/**
 * Client-side natural language filter parsing for inventory.
 * Maps phrases like "under 50 dollars", "low stock", "on ebay" to filter state.
 */

export interface ParsedFilterState {
  priceMax?: number | null;
  lowStockOnly?: boolean;
  platform?: string | null;
  triggerSlowMovers?: boolean;
}

const PLATFORMS = ['shopify', 'square', 'clover', 'amazon', 'ebay', 'facebook'];

function extractPriceMax(text: string): number | null {
  const lower = text.toLowerCase();
  // "under 50", "under $50", "under 50 dollars", "below 100", "cheaper than 25"
  const underMatch = lower.match(/(?:under|below|less than|cheaper than)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:dollars?|bucks?)?/i);
  if (underMatch) return parseFloat(underMatch[1]);
  const maxMatch = lower.match(/\$?\s*(\d+(?:\.\d+)?)\s*(?:and under|or less)/i);
  if (maxMatch) return parseFloat(maxMatch[1]);
  return null;
}

function hasLowStockIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(?:low\s*stock|low\s*quantity|running\s*low|few\s*left)\b/i.test(lower);
}

function hasSlowMoversIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(?:slow\s*movers?|not\s*sold|hasn't\s*sold|hasn\'t\s*sold|no\s*sales?\s*(?:in|for)|idle|stale)\b/i.test(lower)
    || /\b(?:not\s*sold\s*in\s*\d+\s*days?|no\s*sales?\s*(?:in|for)\s*\d+\s*days?)\b/i.test(lower);
}

function extractPlatform(text: string): string | null {
  const lower = text.toLowerCase();
  for (const platform of PLATFORMS) {
    if (new RegExp(`\\b(?:on\\s+)?${platform}\\b`, 'i').test(lower)) return platform;
  }
  return null;
}

/**
 * Parse a natural language filter query and return suggested filter state updates.
 * Does not apply state; caller should merge result into filter state.
 */
export function parseFilterQuery(query: string): ParsedFilterState {
  const trimmed = query.trim();
  if (!trimmed) return {};

  const result: ParsedFilterState = {};
  const price = extractPriceMax(trimmed);
  if (price != null) result.priceMax = price;
  if (hasLowStockIntent(trimmed)) result.lowStockOnly = true;
  if (hasSlowMoversIntent(trimmed)) result.triggerSlowMovers = true;
  const platform = extractPlatform(trimmed);
  if (platform) result.platform = platform;

  return result;
}
