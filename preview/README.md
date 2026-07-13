# preview/ — Reports tab screenshot harness (dev-only)

Renders the real `ReportsTab` (analytics header + report list + report sheet)
in a browser with the network layer mocked, so the UI can be previewed and
screenshotted without live auth or a deployed backend. Not part of the app
bundle: nothing imports this directory, and the shipped entry in
`package.json` is untouched.

## Run

1. Temporarily point the entry at the harness (revert afterwards):

   ```jsonc
   // package.json
   "main": "preview/entry.js"
   ```

2. Start Expo web with placeholder env (all network calls to these hosts are
   intercepted by the harness's fetch mock — nothing real is contacted):

   ```bash
   CI=1 \
   EXPO_PUBLIC_API_BASE_URL=https://mock.api.local \
   EXPO_PUBLIC_SUPABASE_URL=https://mock.supabase.co \
   EXPO_PUBLIC_SUPABASE_ANON_KEY=preview-anon-key \
   EXPO_PUBLIC_CLERK_NATIVE_AUTH=true \
   npx expo start --web --port 8090
   ```

   `EXPO_PUBLIC_CLERK_NATIVE_AUTH=true` makes `ensureSupabaseJwt()` return the
   harness's fake token directly (no exchange round-trip).

3. Open `http://localhost:8090` in a 390×844 viewport. Scenarios:
   - `/?state=data` — full analytics + 5 sample reports (default)
   - `/?state=empty` — zero tiles, "No reports yet"
   - `/?state=error` — API 500s, "Reports could not load" + Retry

4. Revert `package.json` when done: `git checkout -- package.json`.

Fixtures live in `mockData.js`; edit them to stage different campaign pacing,
platforms, pools, or report documents.
