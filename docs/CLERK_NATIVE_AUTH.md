# Track A — Clerk-native Supabase auth (cutover runbook)

Goal: delete the Clerk→Supabase **JWT-exchange bridge** (`/api/auth/exchange` minting a short-lived
HS256 token) and have Supabase trust **Clerk's session token directly** (Supabase third-party auth).
Clerk stays the only identity provider — this removes the translation layer, not a login.

The mobile code is already shipped **behind a flag** (`EXPO_PUBLIC_CLERK_NATIVE_AUTH`, default
`false`), so merging is safe. Nothing changes until you complete the steps below **in order** and
flip the flag.

## The one gotcha: `sub` changes meaning

| | Today (mint bridge) | Native Clerk auth |
|---|---|---|
| `auth.jwt()->>'sub'` | internal `Users.Id` (UUID) | Clerk user id (`user_xxx`) |

Every `UserId` FK and RLS policy keys on the **UUID**. Native Clerk tokens carry the **Clerk id**.
So RLS must map Clerk id → `Users.Id`. `Users.ClerkUserId` already exists and is populated.

## Order of operations (each step is safe on its own)

**1. Configure dashboards** (no code impact; flag still off)
- **Supabase → Auth → Third-Party Auth:** add **Clerk** (enter your Clerk domain). This makes Supabase accept Clerk-signed JWTs via JWKS.
- **Clerk → Integrations → Supabase:** enable it. This adds the required `"role": "authenticated"` claim to Clerk session tokens.

**2. Apply the RLS mapping migration** (additive — does not affect the minted-token path)
```sql
-- Maps the Clerk sub on a native token to the internal user UUID.
create or replace function public.app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select "Id" from "Users" where "ClerkUserId" = auth.jwt()->>'sub'
$$;

-- Rewrite each user-scoped RLS policy to accept EITHER token shape during transition:
--   OLD:  using ( auth.uid() = "UserId" )                 -- minted UUID token
--   NEW:  using ( "UserId" = coalesce(app_user_id(), auth.uid()) )
-- coalesce() keeps the minted-token path working until the flag flip, so this is
-- zero-downtime. Apply table-by-table; verify SELECT/INSERT/UPDATE per table.
```
> Enumerate current policies with:
> `select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname='public';`
> Rewrite each user-scoped one with the `coalesce()` pattern above.

**3. Flip the flag** (the actual cutover)
- Set `EXPO_PUBLIC_CLERK_NATIVE_AUTH=true` (EAS env / `.env`), rebuild.
- Mobile now sends the Clerk token directly (REST + Realtime via supabase-js `accessToken`); no `/api/auth/exchange` calls.

**4. Smoke-test on device** (the part only you can do)
- Sign in → reads/writes work; **two accounts → RLS isolation holds**; Realtime updates arrive; idle >10 min still works (no mint expiry).

**5. Decommission** (after a soak period)
- Drop the `coalesce(..., auth.uid())` fallback from policies (keep only `app_user_id()`).
- Backend: retire `/api/auth/exchange` + `SupabaseAuthGuard` PATH 1; keep PATH 3 (raw Clerk).
- Mobile: delete the mint code in `supabase.ts` (the `else` branch) + the flag.

## Rollback
Set `EXPO_PUBLIC_CLERK_NATIVE_AUTH=false` and rebuild — instantly back to the mint bridge. The
`coalesce()` RLS policies accept both shapes, so no DB rollback is needed.
