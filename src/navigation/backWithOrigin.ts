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
  //
  // The payload arrives in one of two shapes depending on how AddProduct was opened:
  //   • flat — navigate('AddProduct', { ...payload })            → params.origin
  //   • nested — navigate('TabNavigator', { screen: 'AddProduct', params }) → params.params.origin
  // The chat-open path this helper services is the nested one. AddProductScreen
  // unwraps the same `params.params` envelope before reading sessionId, so mirror it
  // here and clear origin from whichever envelope actually held it.
  let origin: { screen?: string; params?: Record<string, unknown> } | undefined;
  let nested: Record<string, unknown> | undefined;
  try {
    const state = nav.getState?.();
    const rawParams = state?.routes?.[state.index]?.params;
    nested = (rawParams?.params && typeof rawParams.params === 'object') ? rawParams.params : undefined;
    const effective = nested ?? rawParams;
    origin = effective?.origin;
  } catch {
    origin = undefined;
  }

  if (origin?.screen) {
    // Consume it so the next plain open of this persistent tab route doesn't reuse it,
    // clearing from the nested envelope when that's where it lived.
    try {
      if (nested && 'origin' in nested) {
        nav.setParams?.({ params: { ...nested, origin: undefined } });
      } else {
        nav.setParams?.({ origin: undefined });
      }
    } catch { /* noop */ }
    nav.navigate(origin.screen, origin.params);
    return;
  }

  if (nav.canGoBack?.()) { nav.goBack(); return; }
  const parent = nav.getParent?.();
  if (parent?.canGoBack?.()) { parent.goBack(); return; }
  nav.navigate('Clearouts');
}

export default backWithOrigin;
