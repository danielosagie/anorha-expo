// Whether we know which workspace the seller is in.
//
// Home gated its empty state on `isOrgLoading || !currentOrg?.id`, which folded
// two different answers into one: "still loading" and "there is no workspace".
// The second is a steady state, so the spinner had no exit and a seller whose
// membership row lost its race with onboarding sat on it forever. Splitting
// them is the whole fix: 'none' is something a screen can render.

export type OrgResolution = 'pending' | 'resolved' | 'none';

/**
 * Org resolution cannot start until the auth bridge is up, and the bridge's own
 * boot grace is 12s (BRIDGE_BOOT_GRACE_MS in lib/bootGate). This sits one beat
 * past it: anything still pending here is stuck, not slow, because every gate
 * upstream has already failed open.
 */
export const ORG_RESOLVE_GRACE_MS = 15_000;

export function resolveOrgState(
  hasOrg: boolean,
  isLoading: boolean,
): OrgResolution {
  if (hasOrg) return 'resolved';
  return isLoading ? 'pending' : 'none';
}

/** True only while the screen legitimately cannot tell the seller anything. */
export function isSetupUnknown(
  resolution: OrgResolution,
  productCountLoading: boolean,
): boolean {
  return resolution === 'pending' || productCountLoading;
}
