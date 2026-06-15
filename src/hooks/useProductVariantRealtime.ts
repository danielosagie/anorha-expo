import { useEffect, useRef, useState } from 'react';
import { getLegendStateObservables } from '../utils/SupaLegend';

/**
 * Re-render signal for screens that read Legend State observables imperatively
 * (i.e. call `.get()` in render rather than wrapping in `observer()`).
 *
 * IMPORTANT — why this no longer opens its own Supabase channel:
 * Legend State already maintains the realtime subscriptions for these tables,
 * scoped to the current user (see `SupaLegend.ts`):
 *   - ProductVariants: `realtime: { filter: 'UserId=eq.<id>' }`
 *   - InventoryLevels: `realtime: true` (RLS-scoped via ProductVariantId join)
 * The previous implementation opened a SECOND, UNFILTERED `*-all` channel
 * (all rows / all users) and was mounted in three tab screens simultaneously,
 * which was the primary driver of Supabase realtime CPU/egress. We now derive
 * the update counter from the canonical observables' `onChange` and open no
 * additional channels.
 */
function useObservableChangeCounter(
  // Returns a Legend State observable; typed loosely because its `onChange` signature
  // varies by observable kind and we only need the change notification.
  pick: (observables: ReturnType<typeof getLegendStateObservables>) => any,
): { updateCounter: number } {
  const [updateCounter, setUpdateCounter] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    const bump = () => {
      // Debounce to coalesce bursts (e.g. initial sync) into a single re-render,
      // preserving the ~100ms batching the previous channel-based impl used.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setUpdateCounter((c) => c + 1), 100);
    };

    try {
      const target = pick(getLegendStateObservables());
      const ret = target?.onChange?.(bump);
      if (typeof ret === 'function') dispose = ret as () => void;
    } catch {
      // Observables not initialized yet (degraded/fallback bootstrap) — no-op.
      // Screens still render; they just won't receive the extra re-render nudge
      // until Legend State is ready, at which point they re-mount/re-render anyway.
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try { dispose?.(); } catch { /* no-op */ }
    };
  }, []);

  return { updateCounter };
}

/**
 * Re-render signal that fires when ANY of the current user's ProductVariants change.
 * Backed by Legend State's existing user-scoped realtime subscription — no new channel.
 *
 * Usage:
 * ```
 * const MyScreen = () => {
 *   const { updateCounter } = useProductVariantRealtime();
 *   // include updateCounter in useMemo deps that read productVariants$
 * };
 * ```
 */
export function useProductVariantRealtime(): { updateCounter: number } {
  return useObservableChangeCounter((o) => o.productVariants$);
}

/**
 * Re-render signal that fires when the current user's InventoryLevels change.
 * Backed by Legend State's existing realtime subscription — no new channel.
 */
export function useInventoryLevelsRealtime(): { updateCounter: number } {
  return useObservableChangeCounter((o) => o.inventoryLevels$);
}
