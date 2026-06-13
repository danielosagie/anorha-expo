import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Lets any screen temporarily suppress the global left-swipe-back ring — e.g. while a left
 * sheet/drawer is open, or a horizontal pager owns the left-edge gesture. Ref-counted so
 * multiple suppressors stack safely.
 *
 * Mount <SwipeBackProvider> above the navigator. In a screen:
 *   useSuppressSwipeBackWhen(isLeftSheetOpen)
 */
type Ctx = { suppressed: boolean; addSuppressor: () => () => void };

const SwipeBackCtx = createContext<Ctx | null>(null);

export const SwipeBackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [count, setCount] = useState(0);
  const value = useMemo<Ctx>(
    () => ({
      suppressed: count > 0,
      addSuppressor: () => {
        setCount((c) => c + 1);
        return () => setCount((c) => Math.max(0, c - 1));
      },
    }),
    [count],
  );
  return <SwipeBackCtx.Provider value={value}>{children}</SwipeBackCtx.Provider>;
};

/** True when something has asked to suppress the swipe-back ring. */
export const useSwipeBackSuppressed = (): boolean => useContext(SwipeBackCtx)?.suppressed ?? false;

/** While `active` is true, suppress the swipe-back ring. Auto-cleans up. */
export const useSuppressSwipeBackWhen = (active: boolean): void => {
  const ctx = useContext(SwipeBackCtx);
  useEffect(() => {
    if (!active || !ctx) return;
    return ctx.addSuppressor();
  }, [active, ctx]);
};
