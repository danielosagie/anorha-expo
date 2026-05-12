/**
 * Convex Liquidation Agent Hook
 *
 * Connects your mobile app to the Convex liquidation agent.
 * Authentication is handled by Convex + Clerk - no tokens passed from client.
 *
 * **Note:** For production liquidation campaigns, use the Nest API from
 * LiquidationCampaignScreen (POST /api/agent/sessions, .../messages,
 * /api/liquidation/strategies/:id/approve, .../execute). Convex agent tools
 * call Nest without auth and get 401. Liquidation is Nest-only.
 *
 * Setup required (if using Convex path):
 * 1. In Clerk Dashboard: Create JWT Template for "convex"
 * 2. In Convex Dashboard: Set CLERK_JWT_ISSUER_DOMAIN env var
 * 3. Wrap app with ConvexProviderWithClerk (see ConvexProvider.tsx)
 *
 * Usage:
 * ```tsx
 * const { startCampaign, chat, isLoading } = useLiquidationAgent();
 * const result = await startCampaign({
 *   targetRevenue: 4000,
 *   timeframeDays: 4,
 *   aggressiveness: 'balanced',
 * });
 * ```
 */

import { useState, useCallback } from 'react';
import { useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';

interface StartCampaignParams {
    targetRevenue: number;
    timeframeDays: number;
    productIds?: string[];
    aggressiveness?: 'conservative' | 'balanced' | 'aggressive';
}

interface StartCampaignResult {
    threadId: string;
    response: string;
    userId: string;
    orgId: string;
}

interface ChatResult {
    response: string;
}

export function useLiquidationAgent() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

    // Convex actions - auth is automatic via ConvexProviderWithClerk
    const startCampaignAction = useAction(api.agentActions.startCampaign);
    const chatAction = useAction(api.agentActions.chat);

    /**
     * Start a new liquidation campaign
     */
    const startCampaign = useCallback(async (params: StartCampaignParams): Promise<StartCampaignResult | null> => {
        setIsLoading(true);
        setError(null);
        setMessages([]);

        try {
            // Convex handles auth automatically - no token needed
            const result = await startCampaignAction(params);

            setActiveThreadId(result.threadId);
            setMessages([
                { role: 'user', content: `Start liquidation: $${params.targetRevenue} in ${params.timeframeDays} days` },
                { role: 'assistant', content: result.response },
            ]);

            return result;
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            setError(error);
            console.error('[LiquidationAgent] Start campaign failed:', error);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [startCampaignAction]);

    /**
     * Send a message to the active campaign
     */
    const chat = useCallback(async (message: string, threadId?: string): Promise<ChatResult | null> => {
        const targetThreadId = threadId || activeThreadId;
        if (!targetThreadId) {
            setError(new Error('No active campaign thread'));
            return null;
        }

        setIsLoading(true);
        setError(null);

        // Optimistically add user message
        setMessages(prev => [...prev, { role: 'user', content: message }]);

        try {
            const result = await chatAction({
                threadId: targetThreadId,
                message,
            });

            // Add assistant response
            setMessages(prev => [...prev, { role: 'assistant', content: result.response }]);

            return result;
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            setError(error);
            console.error('[LiquidationAgent] Chat failed:', error);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [activeThreadId, chatAction]);

    return {
        startCampaign,
        chat,
        isLoading,
        error,
        activeThreadId,
        messages,
    };
}
