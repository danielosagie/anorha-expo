### Clerk ↔ Supabase integration: engineering notes (read before building)

Use this as the source of truth for auth, data access, and verification with Clerk + our Supabase bridge.

---

#### Architecture overview
- Clerk handles authentication. On mobile, we persist the session token via SecureStore.
- After sign‑in, `SessionProvider` exchanges the Clerk token for a Supabase JWT via our API (`/api/auth/exchange`) and marks `session.ready = true`.
- Once `session.ready` is true, the app initializes Legend state and renders the main app.

Key files:
- `App.tsx`: branches UI on `useAuth().isSignedIn`, mounts `WithSessionProvider` only when signed in.
- `src/context/SessionProvider.tsx`: configures the bridge; exposes `SessionContext` with `{ ready, user, entitlements, refresh }`.
- `src/lib/supabase.ts`: custom client that injects our Supabase JWT and refreshes on demand.

---

#### How to sign in / sign up
- Use Clerk hooks in screens:
  - `useSignIn()` → `signIn.create({ identifier, password })`
  - `useSignUp()` → `signUp.create({ emailAddress, password, firstName, lastName })`
- On success: call `auth.setActive({ session: createdSessionId })` and return. Do not navigate.
- App root reacts to `isSignedIn` and mounts providers.

Avoid:
- Manual navigation after sign‑in/signup.
- Polling `useAuth().isSignedIn` inside screens.

---

#### Getting the Clerk session token
- From anywhere under providers, use `const { getToken } = useAuth()`.
- If you need to pass it to APIs, prefer the `SessionProvider` bridge instead (it manages exchange and refresh for you).

---

#### Getting the Supabase user (new way)
We don’t rely on GoTrue. Use our view-backed helper:

Example:
```ts
import { supabase } from '../lib/supabase';

const { data: { user }, error } = await supabase.auth.getUser();
// user is { id, email } or null if not signed in
```

Or, if you need the full record:
```ts
import { getUserLike } from '../lib/supabase';
const { user } = await getUserLike(); // { id, email } or null
```

---

#### Querying tables (after bridge is ready)
- Ensure `SessionContext.ready` is true before making authenticated calls.
- Pattern:
```ts
import React from 'react';
import { supabase } from '../lib/supabase';
import { SessionContext } from '../context/SessionContext';

export function useMyData() {
  const session = React.useContext(SessionContext);
  const [rows, setRows] = React.useState<any[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!session?.ready) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error: err } = await supabase.from('MyTable').select('*');
        if (!cancelled) {
          if (err) throw err;
          setRows(data ?? []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.ready]);

  return { rows, loading, error };
}
```

---

#### Onboarding routing (CreateAccountScreen vs TabNavigator)
- `AppNavigator.checkOnboardingAndNavigate()` fetches `Users.isOnboardingComplete` via Supabase once signed in.
- It sets the AppStack initial screen accordingly.
- Do not redirect from auth screens; let `AppNavigator` decide.

---

#### Verification flows
- Email verification during signup: `signUp.prepareEmailAddressVerification({ strategy: 'email_code' })`, then navigate to `VerifyCode` screen.
- Phone verification (future): prefer Clerk’s phone verification APIs from the auth screens; don’t hit Supabase directly for auth.

---

#### Logout
- Call `const { signOut } = useAuth(); await signOut();`
- The app will flip to signed‑out branch automatically; `SessionProvider` stops the bridge.

---

#### Error handling and fallbacks
- If a Supabase request returns 401, our client auto‑refreshes the JWT once and retries.
- If sign-in succeeds but the UI doesn’t switch, ensure:
  - `ClerkProvider` has a token cache and publishable key.
  - Auth screens aren’t navigating directly.
  - `SessionProvider` is mounted only when `isSignedIn` is true.

---

#### Migration checklist for existing screens
1) Remove direct navigation after sign-in/signup.
2) Replace any direct GoTrue calls with `supabase` from `src/lib/supabase`.
3) Use `supabase.auth.getUser()` for the current user.
4) Gate data fetching on `SessionContext.ready`.
5) For onboarding decisions, rely on `AppNavigator`’s initial screen logic.

---

#### Gotchas
- Using custom token caches or flags (e.g., `__clerk_skip_cache`) can prevent Clerk from flipping `isSignedIn` in-process.
- Don’t poll `isSignedIn` in screens; let the root react.
- If you must check tokens in a component, prefer `useAuth().getToken()`; but most cases should rely on the bridge and `SessionContext.ready`.


