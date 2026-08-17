export type VerificationGateSurface =
  | 'loading'
  | 'signed_out'
  | 'verification_required'
  | 'signed_in';

export type VerificationGateSnapshot = {
  surface: VerificationGateSurface;
};

/**
 * Fail-closed Clerk gate for the app's single signed-in tree branch.
 *
 * This is intentionally pure and module-level. React remounts cannot reset or bypass it,
 * and a signed-in session never reaches the app until Clerk has also loaded the user and
 * confirmed the primary email address is verified.
 */
export function resolveVerificationGate(input: {
  authLoaded: boolean;
  userLoaded: boolean;
  isSignedIn: boolean;
  primaryEmailVerificationStatus?: string | null;
}): VerificationGateSnapshot {
  if (!input.authLoaded) return { surface: 'loading' };
  if (!input.isSignedIn) return { surface: 'signed_out' };
  if (!input.userLoaded) return { surface: 'loading' };
  if (input.primaryEmailVerificationStatus !== 'verified') {
    return { surface: 'verification_required' };
  }
  return { surface: 'signed_in' };
}
