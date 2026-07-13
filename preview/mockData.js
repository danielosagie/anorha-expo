// Preview fixtures for the Reports tab harness (dev-only, not bundled in the
// app). Shapes mirror the real backend responses the components consume.

const DAY = 86400000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

// ── /api/activity — 30d of order events across platforms ────────────────────
const orders = [
  // [daysAgo, platform, total]
  [0.2, 'ebay', 64], [0.6, 'shopify', 38], [1.1, 'ebay', 145],
  [1.8, 'facebook', 25], [2.3, 'ebay', 89], [2.9, 'depop', 32],
  [3.4, 'shopify', 120], [4.1, 'ebay', 54], [4.7, 'ebay', 210],
  [5.5, 'facebook', 45], [6.2, 'shopify', 74], [7.3, 'ebay', 96],
  [8.1, 'depop', 28], [9.4, 'ebay', 132], [10.2, 'shopify', 61],
  [11.6, 'ebay', 47], [12.8, 'facebook', 85], [13.5, 'ebay', 118],
  [16.0, 'ebay', 72], [18.4, 'shopify', 154], [21.2, 'ebay', 43],
  [23.7, 'depop', 36], [26.1, 'ebay', 92], [28.5, 'shopify', 58],
];

const activityEvents = orders.map(([d, platform, total], i) => ({
  Id: `evt-${i}`,
  EventType: 'order_created',
  PlatformType: platform,
  Timestamp: iso(d * DAY),
  Details: { total, orderId: `ord-${1000 + i}` },
}));

// ── /api/agent/analytics/portfolio ───────────────────────────────────────────
const portfolio = {
  recovery: { soldCount: 23, recoveryRatePct: 68, avgDaysToSale: 4 },
  campaigns: [
    { strategyId: 'strat-clearout-jul', soldCount: 14, recoveryRatePct: 72, avgDaysToSale: 3 },
    { strategyId: 'strat-vintage', soldCount: 9, recoveryRatePct: 61, avgDaysToSale: 5 },
  ],
  pools: [
    { id: 'pool-1', name: 'Garage shelves', units: 142 },
    { id: 'pool-2', name: 'Storage unit A', units: 86 },
    { id: 'pool-3', name: 'Closet overflow', units: 37 },
    { id: null, name: 'Unassigned', units: 12 },
  ],
};

// ── /api/agent/sessions?type=liquidation&status=active ──────────────────────
const sessions = {
  sessions: [
    {
      id: 'sess-clearout',
      goal: { deadline: new Date(now + 5 * DAY).toISOString(), timeframeDays: 14, targetRevenue: 2500 },
      state: {
        revenueTarget: 2500, revenueCollected: 1620,
        strategyId: 'strat-clearout-jul', itemsListed: 34, itemsSold: 14,
      },
    },
    {
      id: 'sess-vintage',
      goal: { deadline: new Date(now + 2 * DAY).toISOString(), timeframeDays: 10, targetRevenue: 1200 },
      state: {
        revenueTarget: 1200, revenueCollected: 410,
        strategyId: 'strat-vintage', itemsListed: 21, itemsSold: 9,
      },
    },
  ],
};

// ── /api/agent/reports ───────────────────────────────────────────────────────
const doc = (documentId, title, summary, sections) => ({ documentId, title, summary, format: 'report', sections });

const reports = {
  total: 5,
  reports: [
    {
      id: 'rep-1', documentId: 'doc-winddown-1', source: 'digest', status: 'active',
      title: 'Clearout campaign — week 1 wrap-up',
      summary: '14 of 34 items sold. 72% of suggested value captured, 3 days avg to sale.',
      createdAt: iso(0.4 * DAY), updatedAt: iso(0.4 * DAY),
      document: doc('doc-winddown-1', 'Clearout campaign — week 1 wrap-up',
        '14 of 34 items sold. 72% of suggested value captured, 3 days avg to sale.', [
        { kind: 'metrics', heading: 'Where the campaign stands', metrics: [
          { label: 'Collected', value: '$1,620', sub: 'of $2,500 target' },
          { label: 'Value recovered', value: '72%', sub: 'of suggested prices' },
          { label: 'Avg time to sale', value: '3 days' },
        ]},
        { kind: 'table', heading: 'Top sales this week', columns: ['Item', 'Sold', 'Suggested', 'Recovered'], rows: [
          ['Patagonia fleece (M)', '$74', '$85', '87%'],
          ['Lego Star Wars 75257', '$118', '$140', '84%'],
          ['KitchenAid mixer', '$145', '$210', '69%'],
          ['Vintage Levi’s 501 (32)', '$54', '$70', '77%'],
        ]},
        { kind: 'prose', heading: 'What I’m doing next', text: 'Nine slow movers hit their first decay step overnight (-10%). Two items are within $5 of their floor — if they don’t move by Friday I’ll recommend bundling them with the Saturday pickup lot.' },
      ]),
    },
    {
      id: 'rep-2', documentId: 'doc-insight-am', source: 'insight', status: 'active',
      title: 'Morning report — what moved overnight',
      summary: '3 sales overnight ($233). eBay watchers up on 4 listings.',
      createdAt: iso(0.7 * DAY), updatedAt: iso(0.7 * DAY),
      document: doc('doc-insight-am', 'Morning report — what moved overnight',
        '3 sales overnight ($233). eBay watchers up on 4 listings.', [
        { kind: 'metrics', metrics: [
          { label: 'Overnight sales', value: '3', sub: '$233 collected' },
          { label: 'New watchers', value: '11', sub: 'across 4 eBay listings' },
          { label: 'Messages waiting', value: '2', sub: 'both price questions' },
        ]},
        { kind: 'prose', text: 'The KitchenAid mixer sold at the second decay step — $145 against a $210 suggested price. Two buyers asked about the Dyson V8; both got the stock answer and one looks ready to offer.' },
      ]),
    },
    {
      id: 'rep-3', documentId: 'doc-comps-denim', source: 'chat', status: 'active',
      title: 'eBay comps: vintage denim jackets',
      summary: 'Sold comps cluster $38–$65; sherpa-lined outliers to $95.',
      createdAt: iso(1.6 * DAY), updatedAt: iso(1.6 * DAY),
      document: doc('doc-comps-denim', 'eBay comps: vintage denim jackets',
        'Sold comps cluster $38–$65; sherpa-lined outliers to $95.', [
        { kind: 'table', heading: 'Sold in the last 30 days', columns: ['Listing', 'Condition', 'Sold at', 'Days listed'], rows: [
          ['Levi’s trucker, 90s, L', 'Good', '$62', '6'],
          ['Wrangler sherpa-lined, M', 'Very good', '$95', '11'],
          ['Lee storm rider, L', 'Fair', '$38', '3'],
          ['Levi’s type III, XL', 'Good', '$55', '9'],
        ]},
        { kind: 'prose', text: 'Your two jackets fit the $50–$65 band. Suggested: list at $64 and $58 with best offer on, floor at $42/$38. Sherpa lining is the premium signal — neither of yours has it, so ignore the $95 comp.' },
      ]),
    },
    {
      id: 'rep-4', documentId: 'doc-audit-stale', source: 'chat', status: 'active',
      title: 'Inventory audit — listings stale past 60 days',
      summary: '17 listings older than 60 days holding ≈$1,140 of suggested value.',
      createdAt: iso(3.2 * DAY), updatedAt: iso(2.1 * DAY),
      document: doc('doc-audit-stale', 'Inventory audit — listings stale past 60 days',
        '17 listings older than 60 days holding ≈$1,140 of suggested value.', [
        { kind: 'metrics', metrics: [
          { label: 'Stale listings', value: '17', sub: '60+ days, no watchers' },
          { label: 'Value parked', value: '$1,140', sub: 'at suggested prices' },
        ]},
        { kind: 'prose', text: 'Recommendation: move the 17 into a 14-day balanced campaign. At the observed 68% recovery rate that’s ≈$775 back in about two weeks versus another quarter on the shelf.' },
      ]),
    },
    {
      id: 'rep-5', documentId: 'doc-insight-mid', source: 'insight', status: 'active',
      title: 'Midday report — pricing opportunities',
      summary: '4 items priced above their comp band; two quick wins.',
      createdAt: iso(5.5 * DAY), updatedAt: iso(5.5 * DAY),
      document: doc('doc-insight-mid', 'Midday report — pricing opportunities',
        '4 items priced above their comp band; two quick wins.', [
        { kind: 'prose', text: 'The North Face jacket and the Nintendo Switch dock are both 20%+ above where identical items sold this week. Dropping each ≈$12 puts them at the top of the sold band without touching your floors.' },
      ]),
    },
  ],
};

export const MOCK = { activityEvents, portfolio, sessions, reports };
