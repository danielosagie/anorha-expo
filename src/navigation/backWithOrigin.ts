/**
 * Shared back action for the AddProduct (camera/cart) screen.
 *
 * AddProduct is a hidden TAB screen that sits inside TabNavigator, which is itself
 * the initial route of the AppStack. When it's opened from a pushed stack screen
 * (e.g. the in-chat cart card on CampaignThreadScreen) via
 * `navigate('TabNavigator', { screen: 'AddProduct' })`, React Navigation navigates
 * to the *existing* TabNavigator sitting below the chat — which pops the chat off
 * the stack. By the time we're in the cart, the chat is already gone from history,
 * so a plain goBack()/parent.goBack() chain can't return to it and falls through to
 * Home ('Clearouts').
 *
 * To make back return to wherever the cart was opened from, the opener passes an
 * `origin` route param ({ screen, params }). This helper honors it first, then
 * consumes it (clears the param) so a later plain camera open — which reuses the
 * same persistent tab route — never inherits a stale return target. With no origin
 * it preserves the original deterministic behavior (goBack → parent.goBack → Home).
 *
 * Used by BOTH the in-screen back button and the SwipeBackRing onBack so tap and
 * swipe behave identically.
 */
export function backWithOrigin(navigation: any): void {
  const nav = navigation as any;

  // Read the origin off the currently focused route (AddProduct). useNavigation()
  // inside the screen / the swipe-back HOC both resolve to the tab navigator, whose
  // focused route is AddProduct.
  let origin: { screen?: string; params?: Record<string, unknown> } | undefined;
  try {
    const state = nav.getState?.();
    origin = state?.routes?.[state.index]?.params?.origin;
  } catch {
    origin = undefined;
  }

  if (origin?.screen) {
    // Consume it so the next plain open of this persistent tab route doesn't reuse it.
    try { nav.setParams?.({ origin: undefined }); } catch { /* noop */ }
    nav.navigate(origin.screen, origin.params);
    return;
  }

  if (nav.canGoBack?.()) { nav.goBack(); return; }
  const parent = nav.getParent?.();
  if (parent?.canGoBack?.()) { parent.goBack(); return; }
  nav.navigate('Clearouts');
}

export default backWithOrigin;
