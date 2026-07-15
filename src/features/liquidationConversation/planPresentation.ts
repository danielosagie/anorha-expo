import type { CampaignItem, PlanPayload } from './types';
import { sanitizeDisplayText } from './displayText';

const ITEM_AT_PRICE = /^(.+?)\s+(?:at|to)\s+(\$\d+(?:,\d{3})*(?:\.\d{1,2})?)/i;
const BEFORE_PRICE = /\b(?:was|from|currently(?:\s+at)?|already\s+at)\s+(\$\d+(?:,\d{3})*(?:\.\d{1,2})?)/i;
const APPROACH = /\b(conservative|balanced|aggressive)(?:\s+sell-off)?\b/i;

export type PlanPricePreview = {
  name: string;
  before?: string;
  after: string;
  approach: string;
};

export function getPlanPricePreviews(plan: PlanPayload): PlanPricePreview[] {
  const rows: PlanPricePreview[] = [];
  for (const step of plan.steps ?? []) {
    const title = sanitizeDisplayText(step.title);
    const detail = sanitizeDisplayText(step.detail);
    const match = detail.match(ITEM_AT_PRICE);
    if (!match) continue;
    const after = match[2];
    const approach = detail.match(APPROACH)?.[1];
    rows.push({
      name: sanitizeDisplayText(match[1]),
      before: detail.match(BEFORE_PRICE)?.[1] || (/^keep\b/i.test(title) ? after : undefined),
      after,
      approach: approach ? `${approach[0].toUpperCase()}${approach.slice(1).toLowerCase()}` : 'Set price',
    });
  }
  return rows;
}

export function getPlanDisplayTitle(plan: PlanPayload): string {
  const prices = getPlanPricePreviews(plan);
  if (prices.length) return `Price ${prices.length} items for launch`;

  const firstStep = plan.steps?.find(step => sanitizeDisplayText(step.title).length > 0);
  if (firstStep) return sanitizeDisplayText(firstStep.title);
  return sanitizeDisplayText(plan.title || 'Proposed changes');
}

function normalizedName(value: string) {
  return sanitizeDisplayText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchPlanItem(name: string, items: CampaignItem[]) {
  const target = normalizedName(name);
  if (!target) return undefined;
  const direct = items.find(item => normalizedName(item.name) === target)
    ?? items.find((item) => {
      const candidate = normalizedName(item.name);
      return candidate.length > 4 && (candidate.includes(target) || target.includes(candidate));
    });
  if (direct) return direct;

  const targetTokens = new Set(target.split(' ').filter(token => token.length >= 3));
  let best: { item: CampaignItem; score: number; shared: number } | undefined;
  for (const item of items) {
    const candidateTokens = new Set(normalizedName(item.name).split(' ').filter(token => token.length >= 3));
    const shared = [...targetTokens].filter(token => candidateTokens.has(token)).length;
    const score = shared / Math.max(Math.min(targetTokens.size, candidateTokens.size), 1);
    if (!best || score > best.score || (score === best.score && shared > best.shared)) {
      best = { item, score, shared };
    }
  }
  return best && best.shared >= 1 && best.score >= 0.5 ? best.item : undefined;
}

export function campaignItemPrice(item?: CampaignItem) {
  if (!item || !Number.isFinite(item.currentPrice)) return undefined;
  return `$${Number.isInteger(item.currentPrice) ? item.currentPrice.toFixed(0) : item.currentPrice.toFixed(2)}`;
}
