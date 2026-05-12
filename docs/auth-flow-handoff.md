## Mobile auth flow handoff (Clerk ↔ Providers ↔ Supabase)

High-signal notes for the next engineer. Goal: a boring, reliable sign-in that mounts the right providers before any navigation.

- **Libraries**
  - `@clerk/clerk-expo`: 2.14.20
  - `expo`: 53.x, `react-native`: 0.79.x

### Responsibilities by file
- `src/screens/AuthScreen.tsx`
  - On success: `await auth.setActive({ session })` and return.
  - No navigation, no polling `isSignedIn`.

- `App.tsx`
  - Branches on `useAuth()`:
    - Signed-out: render `<AppNavigator />` (Auth stack)
    - Signed-in: render `<WithSessionProvider><AuthedAppContent/></WithSessionProvider>`
  - `SessionProvider` configures the Clerk→Supabase bridge and sets `session.ready` once the JWT exchange succeeds.
  - Only render the full app once both `session.ready` and Legend state are initialized.
  - Token cache: uses SecureStore-based cache (no skip-flags). If you upgrade Clerk, prefer their official Expo cache helper when available.

- `src/navigation/AppNavigator.tsx`
  - Decides initial app screen after sign-in via `checkOnboardingAndNavigate()` (reads `Users.isOnboardingComplete`).
  - Renders `AppStack` with `initialScreenName` from either route params or computed state.
  - Avoid navigating from `AuthScreen` directly; providers may not be mounted yet.

- `src/context/SessionProvider.tsx`
  - Polls `getClerkToken()`; when present, configures the Supabase bridge, loads `me`, fetches entitlements, then flips `ready = true`.

- `src/lib/supabase.ts`
  - Handles Clerk→Supabase token exchange and background refresh.
  - Custom `fetch` injects Supabase JWT and retries on 401 with a refresh.

### State flow (happy path)
1) AuthScreen: idle → loading → `auth.setActive({ session })` → return.
2) App.tsx: `isSignedIn` flips true → mounts providers.
3) SessionProvider: bridge configured → `ready = true`.
4) AppNavigator: decides `CreateAccountScreen` vs `TabNavigator`.

### Do / Don’t
- Do: Let App.tsx react to `isSignedIn`; keep `AuthScreen` minimal.
- Do: Use a real token cache (SecureStore). No skip-flag mutations.
- Don’t: Navigate to app stacks from `AuthScreen`.
- Don’t: Poll `isSignedIn` in component code.

### Debugging checklists
- After sign-in you should see logs in `App.tsx`:
  - `[App] ✓ isSignedIn changed to: true`
  - `[SessionProvider] bridge configured...` then `ready = true`
  - Legend state init logs
- If `isSignedIn` doesn’t flip without an app restart:
  - Ensure token cache isn’t overridden by any “skip” flags.
  - Confirm `ClerkProvider` is the root and receives the token cache.
  - Verify no direct navigation is triggered in `AuthScreen`.

### Logout
- `useAuth().signOut()` in `AuthContext.signOut` toggles the App back to the signed-out branch. Don’t clear flags that affect Clerk’s cache behavior.

### Tradeoffs
- Deferring navigation centralizes routing decisions where providers are mounted, eliminating spinner/crash due to missing contexts.
- Minimal AuthScreen reduces flakiness from local state races and SDK timing.


