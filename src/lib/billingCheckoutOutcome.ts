export type BillingBrowserOutcome =
  | { kind: 'returned'; shouldPoll: true }
  | { kind: 'cancelled'; shouldPoll: false }
  | { kind: 'could_not_verify'; shouldPoll: false };

/** Interprets Expo's auth-session result without importing native modules. */
export function decideBillingBrowserOutcome(result: { type?: unknown } | null | undefined): BillingBrowserOutcome {
  const type = String(result?.type || '').trim().toLowerCase();
  if (type === 'success') return { kind: 'returned', shouldPoll: true };
  if (type === 'cancel' || type === 'dismiss') return { kind: 'cancelled', shouldPoll: false };
  return { kind: 'could_not_verify', shouldPoll: false };
}

export function billingCheckoutFeedback(kind: 'cancelled' | 'could_not_verify'): {
  message: string;
  action: 'recheck' | null;
} {
  return kind === 'cancelled'
    ? { message: 'Checkout cancelled.', action: null }
    : { message: 'Couldn’t verify payment.', action: 'recheck' };
}
