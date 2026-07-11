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

  // ---- Import Hub / SyncInbox demo data ----
  const inboxSummary = {
    totalNeedsAttention: 7,
    byReason: { multiple_candidates: 4, weak_match: 3 },
    connections: [
      { connectionId: 'conn_shopify', platformType: 'shopify', displayName: 'My Shopify Store', state: 'needs-attention', needsAttention: 4 },
      { connectionId: 'conn_square', platformType: 'square', displayName: 'Square POS', state: 'needs-attention', needsAttention: 3 },
      { connectionId: 'conn_csv', platformType: 'csv', displayName: 'Spring inventory.csv', state: 'scanning', needsAttention: 0 },
    ],
    recentImports: [
      { importId: 'imp_1', connectionId: 'conn_shopify', source: 'platform_scan', status: 'complete', itemsTotal: 182, itemsCommitted: 178, itemsFailed: 0, createdAt: new Date(now - 86400000).toISOString(), completedAt: new Date(now - 86000000).toISOString() },
      { importId: 'imp_2', connectionId: 'conn_csv', source: 'csv_upload', status: 'in_progress', itemsTotal: 120, itemsCommitted: 64, itemsFailed: 0, createdAt: new Date(now - 600000).toISOString(), completedAt: null },
    ],
  };

  const mkItem = (i: number, reason: string, candidates: number) => ({
    platformId: `plat_${i}`,
    sku: `SKU-10${i}`,
    barcode: null,
    title: ['Ceramic Pour-Over Coffee Dripper', 'Linen Table Runner 72"', 'Walnut Serving Board', 'Stoneware Mug — Sage'][i % 4],
    price: [24.99, 38.0, 54.5, 18.0][i % 4],
    imageUrl: `https://picsum.photos/seed/inbox${i}/300/300`,
    parentId: null,
    direction: 'both',
    resolution: candidates > 0
      ? { kind: 'link', canonical: { id: `can_${i}`, sku: `SKU-10${i}`, title: 'Existing: Pour-Over Dripper', imageUrl: `https://picsum.photos/seed/can${i}/200/200` }, confidence: 0.82, via: 'title' }
      : { kind: 'create' },
    attention: reason,
    candidates: Array.from({ length: candidates }, (_, k) => ({
      id: `can_${i}_${k}`, sku: `SKU-10${i}${k}`, title: k === 0 ? 'Pour-Over Coffee Dripper (existing)' : 'Coffee Dripper V2', imageUrl: `https://picsum.photos/seed/cand${i}${k}/200/200`,
    })),
    recommended: candidates > 0 ? 'primary' : null,
    reason: reason === 'multiple_candidates' ? 'Two close matches in your catalog' : 'Title similar but price differs',
  });

  const resolution = {
    autoLink: [],
    autoCreate: [],
    needsAttention: [mkItem(0, 'multiple_candidates', 2), mkItem(1, 'weak_match', 1), mkItem(2, 'multiple_candidates', 2), mkItem(3, 'weak_match', 0)],
    summary: { total: 182, autoLinked: 121, autoCreated: 57, needsAttention: 4, skipped: 0, pushSide: 0, clean: false, byReason: { multiple_candidates: 2, weak_match: 2 } },
  };

  const connStatus = {
    state: 'needs-attention',
    counts: { total: 182, autoLinked: 121, autoCreated: 57, needsAttention: 4 },
    attention: resolution.needsAttention,
  };

  const routes: Array<[RegExp, any]> = [
    [/\/sync\/inbox\/summary/, inboxSummary],
    [/\/sync\/connections\/[^/]+\/resolution/, resolution],
    [/\/sync\/connections\/[^/]+\/status/, connStatus],
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
