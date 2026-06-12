/**
 * webFetchMock — design-export only. Intercepts known sssync API endpoints on web
 * and returns demo JSON so data-driven screens (Billing, Team, Notifications) render
 * populated instead of "no auth"/empty. Imported for its side effect by App.web.tsx.
 */
import { supabase } from '../../lib/supabase';

if (typeof window !== 'undefined' && typeof window.fetch === 'function' && !(window as any).__sssyncFetchMocked) {
  (window as any).__sssyncFetchMocked = true;
  const orig = window.fetch.bind(window);

  // Make screens that gate on a Supabase session (e.g. Team, Past scans) proceed on web.
  try {
    const mockUser: any = { id: 'user_mock', email: 'demo@sssync.app' };
    const mockSession: any = { user: mockUser, access_token: 'mock_jwt_token', token_type: 'bearer', expires_at: Date.now() / 1000 + 3600 };
    (supabase as any).auth.getUser = async () => ({ data: { user: mockUser }, error: null });
    (supabase as any).auth.getSession = async () => ({ data: { session: mockSession }, error: null });
  } catch {}

  const json = (data: any) =>
    new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const now = Date.now();
  const sec = (d: number) => Math.floor((now - d * 86400000) / 1000);

  const billingSummary = {
    subscription: { Status: 'active', CurrentPlan: 'Growth', current_plan: 'Growth' },
    tier_name: 'Growth',
    ai_scans_limit: 40,
    ai_credit_unit_cents: 20,
    ai_credits_limit: 40,
    ai_credits_used: 14,
    ai_allowance_cents: 800,
    ai_credits_cents: 800,
    ai_used_cents: 280,
    ai_overage_cents: 0,
    team_members_count: 3,
    team_members_included: 1,
    team_members_extra: 2,
    team_members_cost: 5800,
    usage_by_type: {
      ai_quick_scan: 8,
      ai_recognize_match: 4,
      ai_generate_groq: 2,
    },
  };

  const invoices = [
    { id: 'in_1', created: sec(3), amount_paid: 2900, total: 2900, status: 'paid', number: 'SSY-1042' },
    { id: 'in_2', created: sec(33), amount_paid: 2900, total: 2900, status: 'paid', number: 'SSY-1041' },
    { id: 'in_3', created: sec(63), amount_paid: 2900, total: 2900, status: 'paid', number: 'SSY-1040' },
  ];

  const upcoming = { upcoming: { amount_due: 2900, total: 2900, next_payment_attempt: sec(-27), period_end: sec(-27) } };

  const orgs = [{ Organizations: { Id: 'org_mock', Name: 'Demo Business' }, Role: 'org:admin' }];

  const members = [
    { Id: 'm1', Role: 'org:admin', Users: { Id: 'user_mock', Email: 'demo@sssync.app', FirstName: 'Demo', LastName: 'Seller' } },
    { Id: 'm2', Role: 'member', Users: { Id: 'u2', Email: 'maria@demo.co', FirstName: 'Maria', LastName: 'Lopez' } },
    { Id: 'm3', Role: 'member', Users: { Id: 'u3', Email: 'sam@demo.co', FirstName: 'Sam', LastName: 'Chen' } },
  ];

  const invitations = [
    { Id: 'inv1', Email: 'jordan@demo.co', Role: 'member', Status: 'pending' },
  ];

  const notifPrefs = {
    jobCompletions: true,
    inventorySharing: true,
    sproutInsights: true,
    syncAlerts: true,
    marketingUpdates: false,
  };

  const routes: Array<[RegExp, any]> = [
    [/\/billing\/summary/, billingSummary],
    [/\/billing\/invoices/, invoices],
    [/\/billing\/upcoming/, upcoming],
    [/\/organizations\/[^/]+\/members/, members],
    [/\/organizations\/[^/]+\/invitations/, invitations],
    [/\/organizations\/[^/]+\/check-admin/, { isAdmin: true }],
    [/\/organizations(\?|$)/, orgs],
    [/\/notifications\/preferences/, notifPrefs],
  ];

  window.fetch = ((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    for (const [re, data] of routes) {
      if (re.test(url)) return Promise.resolve(json(data));
    }
    return orig(input, init);
  }) as typeof window.fetch;
}

export {};
