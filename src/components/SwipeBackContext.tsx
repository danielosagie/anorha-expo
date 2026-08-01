import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
  // The ref-count lives in a ref and only the derived boolean is state, so registering or
  // releasing a suppressor never changes this context's identity unless `suppressed` itself
  // flips.
  //
  // It used to be `useMemo(..., [count])`, which rebuilt the value on every count tick. That
  // changed the context identity, which re-ran every consumer's effect — cleanup, then re-add —
  // so suppression thrashed between true and false while a sheet was open. A flip to true makes
  // SwipeBackRing return bare children, which unmounts the view holding the PanResponder: a
  // swipe already in flight lost its release handler and simply never navigated. That is the
  // intermittent "the ring fills but it doesn't go back" on Add Product.
  const [suppressed, setSuppressed] = useState(false);
  const countRef = useRef(0);

  const addSuppressor = useCallback(() => {
    countRef.current += 1;
    setSuppressed(countRef.current > 0);
    // Each release is idempotent. Without this, a cleanup invoked twice (StrictMode, or the
    // identity churn above) decremented the count a second time and silently took someone
    // else's suppressor with it — the mirror bug, where the ring stays live under an open sheet.
    let released = false;
    return () => {
      if (released) return;
      released = true;
      countRef.current = Math.max(0, countRef.current - 1);
      setSuppressed(countRef.current > 0);
    };
  }, []);

  const value = useMemo<Ctx>(() => ({ suppressed, addSuppressor }), [suppressed, addSuppressor]);
  return <SwipeBackCtx.Provider value={value}>{children}</SwipeBackCtx.Provider>;
};

/** True when something has asked to suppress the swipe-back ring. */
export const useSwipeBackSuppressed = (): boolean => useContext(SwipeBackCtx)?.suppressed ?? false;

/** While `active` is true, suppress the swipe-back ring. Auto-cleans up. */
export const useSuppressSwipeBackWhen = (active: boolean): void => {
  // Depend on the (now stable) addSuppressor, never the whole context — otherwise every
  // suppression change anywhere in the app re-runs this effect for every consumer.
  const addSuppressor = useContext(SwipeBackCtx)?.addSuppressor;
  useEffect(() => {
    if (!active || !addSuppressor) return;
    return addSuppressor();
  }, [active, addSuppressor]);
};

// ── Back-button anchor ──────────────────────────────────────────────────────
// A pin-mode ring must sit on the screen's REAL back button on any device, not at a
// guessed pinTop/pinLeft. A screen publishes its back button's measured WINDOW rect
// here (via measureInWindow); the ring reads it and positions itself exactly there.
// Module-level pub/sub so only the ring re-renders, never the whole app.
export type BackButtonRect = { x: number; y: number; width: number; height: number };

let currentBackRect: BackButtonRect | null = null;
const backRectListeners = new Set<(r: BackButtonRect | null) => void>();

/** Screens call this (from the back button's measureInWindow) to anchor the ring. */
export const publishBackButtonRect = (rect: BackButtonRect | null): void => {
  currentBackRect = rect;
  backRectListeners.forEach((cb) => cb(rect));
};

/** The ring subscribes to the latest published back-button rect (null = none). */
export const useBackButtonRect = (): BackButtonRect | null => {
  const [rect, setRect] = useState<BackButtonRect | null>(currentBackRect);
  useEffect(() => {
    backRectListeners.add(setRect);
    setRect(currentBackRect);
    return () => {
      backRectListeners.delete(setRect);
    };
  }, []);
  return rect;
};
