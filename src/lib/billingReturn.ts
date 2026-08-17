import * as WebBrowser from 'expo-web-browser';

/**
 * Where a hosted checkout or billing portal sends the user back to.
 *
 * The in-app auth session watches for this URL and closes itself the moment the page
 * redirects to it. App.tsx handles the same URL as a normal deep link for the other case:
 * the session was already dismissed, or the OS delivered the link cold.
 */
export const BILLING_RETURN_URL = 'anorhaapp://billing/return';

/**
 * Mark a hosted-checkout return URL as coming from the app. app.anorha.app/billing sees this
 * and bounces to BILLING_RETURN_URL instead of rendering the web billing page inside the
 * sheet. The URL itself stays https, which is what payment providers accept.
 */
export const withMobileReturn = (url: string): string =>
  `${url}${url.includes('?') ? '&' : '?'}mobile=1`;

/**
 * Open a checkout or portal URL and resolve once the user is back in the app — whether the
 * page redirected to BILLING_RETURN_URL or they closed the sheet themselves. Callers refresh
 * billing on the resolved promise, so both endings are covered by one line.
 */
export const openBillingUrl = (url: string) =>
  WebBrowser.openAuthSessionAsync(url, BILLING_RETURN_URL);
