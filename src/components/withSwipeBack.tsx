import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SwipeBackRing } from './SwipeBackRing';

/**
 * Wraps a screen so a left-edge swipe drives the SwipeBackRing (page slides right + activity
 * ring fills to armed, then pops). Inert on screens with nothing to go back to.
 *
 * Wrap ONCE at module scope (or via the sb() cache in AppNavigator) — never inline in render,
 * or the screen remounts every frame.
 */
/** Per-screen overrides forwarded to SwipeBackRing (surface color, pin mode, sizing, etc.). */
type Options = {
  surface?: string;
  mode?: 'slide' | 'pin';
  size?: number;
  pinTop?: number;
  pinLeft?: number;
  accent?: string;
  armed?: string;
  /** Custom back action (gets the screen's navigation). Defaults to navigation.goBack().
   *  Use to match a screen's real back button (e.g. goBack-or-navigate fallback). */
  onBack?: (navigation: any) => void;
};

export function withSwipeBack<P extends object>(Component: React.ComponentType<P>, opts: Options = {}) {
  const Wrapped = (props: P) => {
    const navigation = useNavigation<any>();
    // Bump a nonce every time the screen regains focus so the ring resets — tab screens
    // (e.g. AddProduct) stay mounted, so a prior commit/half-pull would otherwise linger.
    const [focusNonce, setFocusNonce] = useState(0);
    useFocusEffect(useCallback(() => { setFocusNonce((n) => n + 1); }, []));
    const { onBack: customOnBack, ...ringOpts } = opts;
    // A custom onBack always has somewhere to go (e.g. goBack-or-navigate), so keep the
    // ring enabled even when canGoBack() is false; otherwise gate on canGoBack().
    const handleBack = customOnBack ? () => customOnBack(navigation) : () => navigation.goBack();
    const enabled = customOnBack ? true : navigation.canGoBack();
    return (
      <SwipeBackRing onBack={handleBack} enabled={enabled} {...ringOpts} resetNonce={focusNonce}>
        <Component {...props} />
      </SwipeBackRing>
    );
  };
  Wrapped.displayName = `withSwipeBack(${Component.displayName || Component.name || 'Screen'})`;
  return Wrapped;
}

export default withSwipeBack;
