// Dev-only screenshot harness for the Reports tab. NOT part of the app bundle —
// it only runs when package.json "main" is temporarily pointed at
// preview/entry.js (see preview/README.md). Renders the REAL ReportsTab
// (analytics header + report list + report sheet) with the network layer
// mocked, so the UI can be driven in a browser without live auth or a
// deployed backend.
//
// Scenarios via URL: ?state=data (default) | empty | error
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as Font from 'expo-font';
import { SessionContext } from '../src/context/SessionContext';
import { configureClerkSupabaseBridge } from '../src/lib/supabase';
import ReportsTab from '../src/screens/inventory/ReportsTab';
import { MOCK } from './mockData';

const STATE = (() => {
  try {
    return new URLSearchParams(window.location.search).get('state') || 'data';
  } catch {
    return 'data';
  }
})();

// ── fetch mock: the harness answers the app's API calls ─────────────────────
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const EMPTY: Record<string, unknown> = {
  '/api/agent/reports': { total: 0, reports: [] },
  '/api/activity': { events: [] },
  '/api/agent/analytics/portfolio': { recovery: { soldCount: 0, recoveryRatePct: null, avgDaysToSale: null }, campaigns: [], pools: [] },
  '/api/agent/sessions': { sessions: [] },
};

const DATA: Record<string, unknown> = {
  '/api/agent/reports': MOCK.reports,
  '/api/activity': { events: MOCK.activityEvents },
  '/api/agent/analytics/portfolio': MOCK.portfolio,
  '/api/agent/sessions': MOCK.sessions,
};

const realFetch = global.fetch.bind(global);
global.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url ? String(input.url) : String(input);
  const key = Object.keys(DATA).find((k) => url.includes(k));
  if (key) {
    await new Promise((r) => setTimeout(r, 150)); // let loading states exist
    if (STATE === 'error') return json({ error: 'preview: simulated outage' }, 500);
    if (STATE === 'empty') return json(EMPTY[key]);
    return json(DATA[key]);
  }
  return realFetch(input, init);
}) as typeof fetch;

const SESSION = {
  ready: true,
  bridgeReady: true,
  user: { id: 'preview-user', email: 'preview@anorha.app' },
  entitlements: null,
  bootstrapState: 'ready' as const,
  usingCachedSession: false,
  sessionMode: 'live' as const,
  bootstrapError: null,
  lastReadyAt: Date.now(),
  refresh: async () => {},
};

export default function PreviewApp() {
  const [interLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      // Icon glyphs (react-native-vector-icons ships the ttf; expo-font
      // registers the family for web).
      await Font.loadAsync({
        MaterialCommunityIcons: require('react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'),
      }).catch(() => {});
      // EXPO_PUBLIC_CLERK_NATIVE_AUTH=true → ensureSupabaseJwt() returns this
      // getter's value directly; no exchange, no real Clerk.
      await configureClerkSupabaseBridge({ getClerkToken: async () => 'preview-token' }).catch(() => {});
      setReady(true);
    })();
  }, []);

  if (!interLoaded || !ready) return null;

  return (
    <SafeAreaProvider>
      <SessionContext.Provider value={SESSION}>
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          <View style={{ paddingTop: 18, paddingHorizontal: 16, paddingBottom: 8 }}>
            <Text style={{ fontSize: 24, fontFamily: 'Inter_700Bold', color: '#18181B' }}>Reports</Text>
          </View>
          <ReportsTab />
        </View>
      </SessionContext.Provider>
    </SafeAreaProvider>
  );
}
