/**
 * useAccountStage — where the seller is in their journey, derived cheaply from
 * signals we already fetch (connections, inventory count, campaigns, sales). No
 * new query, no milestone table. Drives the home CTA, the chat composer
 * placeholder, and (mirrored server-side in llm-nudges) the stage-aware insight.
 *
 * cold      → no platform connected
 * connected → ≥1 connection, no inventory
 * stocked   → has inventory, no clearout running
 * clearing  → a clearout running, no sales yet
 * active    → selling (any orders / a campaign with sales)
 */
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { useProfileProductCount } from './useProfileProductCount';

export type AccountStage = 'cold' | 'connected' | 'stocked' | 'clearing' | 'active';

export interface NextAction {
  key: 'connect' | 'add' | 'clearout' | 'ask';
  /** Short label for a CTA / staged card. */
  label: string;
  /** Navigation target when the action is a screen jump. */
  screen?: 'Connections' | 'AddProduct';
  /** When the action is best answered by Sprout, the prompt to pre-fill in chat. */
  prompt?: string;
  /** Composer placeholder that fits this stage. */
  placeholder: string;
}

export function classifyAccountStage(input: {
  connections: number;
  inventory: number;
  campaigns: number;
  anySales: boolean;
}): AccountStage {
  if (input.connections <= 0) return 'cold';
  if (input.inventory <= 0) return 'connected';
  if (input.campaigns <= 0) return input.anySales ? 'active' : 'stocked';
  return input.anySales ? 'active' : 'clearing';
}

export const NEXT_ACTION: Record<AccountStage, NextAction> = {
  cold: { key: 'connect', label: 'Connect a platform', screen: 'Connections', placeholder: 'What should I sell first?' },
  connected: { key: 'add', label: 'Add your first items', screen: 'AddProduct', placeholder: 'What should I list first?' },
  stocked: { key: 'clearout', label: 'Start a clearout', placeholder: 'What should I clear out first?' },
  clearing: { key: 'ask', label: 'Ask Sprout for the first move', prompt: 'What should I do to get my first sale?', placeholder: 'Steer this clearout…' },
  active: { key: 'ask', label: 'Ask Sprout what needs you', prompt: 'What needs my attention right now?', placeholder: 'Steer this clearout…' },
};

/**
 * @param opts campaign signals from the caller's controller (the shared hooks can't
 *             see the liquidation controller). Home passes campaigns + anySales; a
 *             surface without campaign context can omit them.
 */
export function useAccountStage(opts?: { campaigns?: number; anySales?: boolean }): {
  stage: AccountStage;
  nextAction: NextAction;
} {
  const { liveConnections } = usePlatformConnections();
  const { productCount } = useProfileProductCount();
  const stage = classifyAccountStage({
    connections: liveConnections?.length || 0,
    inventory: productCount || 0,
    campaigns: opts?.campaigns ?? 0,
    anySales: opts?.anySales ?? false,
  });
  return { stage, nextAction: NEXT_ACTION[stage] };
}
