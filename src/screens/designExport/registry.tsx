/**
 * Route registry for the web-only design-export app.
 * Each entry renders a REAL app screen (lazy-loaded) through the Harness, with
 * mock route params so it renders populated UI without auth/network.
 *
 * Open any screen at:  http://localhost:8082/?screen=<key>
 */
import React from 'react';

export type ExportRoute = {
  key: string;
  title: string;
  group: string;
  routeName: string;
  params?: Record<string, any>;
  load: () => Promise<{ default: React.ComponentType<any> }>;
};

const noop = () => {};

// ---- mock data for screens that render from route params ----
const matchResults = {
  jobId: 'job_mock',
  analysis: {
    results: [
      {
        productIndex: 0,
        originalTargetImage: 'https://picsum.photos/seed/target0/300/300',
        serpApiData: [
          { title: 'Organic Coconut Oil 32oz', thumbnail: 'https://picsum.photos/seed/c1/200', link: 'https://amazon.com', source: 'amazon.com' },
          { title: 'Cold Pressed Coconut Oil', thumbnail: 'https://picsum.photos/seed/c2/200', link: 'https://ebay.com', source: 'ebay.com' },
          { title: 'Virgin Coconut Oil Jar', thumbnail: 'https://picsum.photos/seed/c3/200', link: 'https://walmart.com', source: 'walmart.com' },
        ],
      },
    ],
  },
};

const generateResults = [
  {
    productIndex: 0,
    variantId: 'var_mock_1',
    title: 'Organic Coconut Oil - 32oz',
    description: 'Cold-pressed, unrefined organic coconut oil in a 32oz jar.',
    price: 24.99,
    sku: 'COCO-32',
    images: ['https://picsum.photos/seed/coco/400/400'],
    platforms: { shopify: { title: 'Organic Coconut Oil - 32oz', price: 24.99 } },
  },
];

export const ROUTES: ExportRoute[] = [
  // ---------- Inventory (self-contained composed mock) ----------
  { key: 'inventory', title: 'Inventory + components', group: 'Inventory', routeName: 'DesignExport',
    load: () => import('../DesignExportScreen') },

  // ---------- Onboarding / Login ----------
  { key: 'initial', title: 'Splash / Initial', group: 'Onboarding & Login', routeName: 'InitialScreen',
    load: () => import('../InitialScreen') },
  { key: 'auth', title: 'Login / Sign up', group: 'Onboarding & Login', routeName: 'Auth',
    load: () => import('../AuthScreen') },
  { key: 'verify', title: 'Verify code', group: 'Onboarding & Login', routeName: 'VerifyCode',
    params: { contactLabel: 'demo@sssync.app', mode: 'signup' },
    load: () => import('../VerifyCodeScreen') },
  // Create account — one tile per wizard step
  { key: 'create-welcome', title: 'Create account · Welcome', group: 'Onboarding & Login', routeName: 'CreateAccountScreen',
    params: { initialStep: 'WELCOME' }, load: () => import('../CreateAccountScreen') },
  { key: 'create-business', title: 'Create account · Business name', group: 'Onboarding & Login', routeName: 'CreateAccountScreen',
    params: { initialStep: 'BUSINESS_NAME' }, load: () => import('../CreateAccountScreen') },
  { key: 'create-address', title: 'Create account · Store address', group: 'Onboarding & Login', routeName: 'CreateAccountScreen',
    params: { initialStep: 'STORE_ADDRESS' }, load: () => import('../CreateAccountScreen') },
  { key: 'create-type', title: 'Create account · Business type', group: 'Onboarding & Login', routeName: 'CreateAccountScreen',
    params: { initialStep: 'BUSINESS_TYPE' }, load: () => import('../CreateAccountScreen') },
  { key: 'create-role', title: 'Create account · Role', group: 'Onboarding & Login', routeName: 'CreateAccountScreen',
    params: { initialStep: 'ROLE' }, load: () => import('../CreateAccountScreen') },
  { key: 'create-contact', title: 'Create account · Contact', group: 'Onboarding & Login', routeName: 'CreateAccountScreen',
    params: { initialStep: 'CONTACT' }, load: () => import('../CreateAccountScreen') },
  { key: 'create-team', title: 'Create account · Team', group: 'Onboarding & Login', routeName: 'CreateAccountScreen',
    params: { initialStep: 'TEAM' }, load: () => import('../CreateAccountScreen') },
  { key: 'create-finish', title: 'Create account · Finish', group: 'Onboarding & Login', routeName: 'CreateAccountScreen',
    params: { initialStep: 'FINISH' }, load: () => import('../CreateAccountScreen') },

  // ---------- Add Product flow (the master page also renders camera modes + sheets) ----------
  { key: 'add-photo', title: 'Camera · Photo mode', group: 'Add Product Flow', routeName: 'AddProduct',
    params: { initialCameraMode: 'camera' }, load: () => import('../AddProductScreen') },
  { key: 'add-barcode', title: 'Camera · Barcode mode', group: 'Add Product Flow', routeName: 'AddProduct',
    params: { initialCameraMode: 'barcode' }, load: () => import('../AddProductScreen') },
  { key: 'add-shelf', title: 'Camera · Shelf scan mode', group: 'Add Product Flow', routeName: 'AddProduct',
    params: { initialCameraMode: 'shelf' }, load: () => import('../AddProductScreen') },
  { key: 'add-items', title: 'Camera · With items', group: 'Add Product Flow', routeName: 'AddProduct',
    params: { initialCameraMode: 'camera', designState: 'withItems' }, load: () => import('../AddProductScreen') },
  { key: 'add-loading', title: 'Camera · Recognizing (loading)', group: 'Add Product Flow', routeName: 'AddProduct',
    params: { initialCameraMode: 'camera', designState: 'loading' }, load: () => import('../AddProductScreen') },
  { key: 'add-match', title: 'Camera · Match results sheet', group: 'Add Product Flow', routeName: 'AddProduct',
    params: { initialCameraMode: 'camera', designState: 'matchSheet' }, load: () => import('../AddProductScreen') },
  { key: 'add-shelf-scanning', title: 'Shelf · Scanning', group: 'Add Product Flow', routeName: 'AddProduct',
    params: { initialCameraMode: 'shelf', designState: 'shelfScanning' }, load: () => import('../AddProductScreen') },
  { key: 'add-shelf-complete', title: 'Shelf · Complete', group: 'Add Product Flow', routeName: 'AddProduct',
    params: { initialCameraMode: 'shelf', designState: 'shelfComplete' }, load: () => import('../AddProductScreen') },
  { key: 'photo-upload', title: 'Photo upload', group: 'Add Product Flow', routeName: 'PhotoUpload',
    params: { onDone: noop },
    load: () => import('../PhotoUploadScreen') },
  { key: 'past-scans', title: 'Past scans', group: 'Add Product Flow', routeName: 'PastScans',
    load: () => import('../PastScansScreen') },
  { key: 'loading', title: 'Processing / Loading', group: 'Add Product Flow', routeName: 'LoadingScreen',
    params: { processType: 'match', payload: { jobId: 'job_mock', firstPhotos: ['https://picsum.photos/seed/p1/300', 'https://picsum.photos/seed/p2/300'] }, onCompleteRoute: { screen: 'GenerateDetailsScreen', params: {} } },
    load: () => import('../LoadingScreen') },
  { key: 'match', title: 'Match selection', group: 'Add Product Flow', routeName: 'MatchSelectionScreen',
    params: { jobId: 'job_mock', response: matchResults, focusIndex: 0 },
    load: () => import('../MatchSelectionScreen') },
  { key: 'generate-details', title: 'Generate details', group: 'Add Product Flow', routeName: 'GenerateDetailsScreen',
    params: { jobId: 'gen_mock', status: 'completed', results: generateResults, focusIndex: 0 },
    load: () => import('../GenerateDetailsScreen') },
  { key: 'confirm', title: 'Publish confirmation', group: 'Add Product Flow', routeName: 'PublishConfirmation',
    params: { title: 'Organic Coconut Oil - 32oz', description: 'Cold-pressed organic coconut oil.', price: 24.99, imageUrl: 'https://picsum.photos/seed/coco/400/400', platforms: ['shopify', 'amazon'], accountNames: ['My Shopify', 'My Amazon Store'], origin: 'generate' },
    load: () => import('../PublishConfirmationScreen') },

  // ---------- Settings ----------
  { key: 'profile', title: 'Profile / Settings home', group: 'Settings', routeName: 'Profile',
    load: () => import('../ProfileScreen') },
  { key: 'notifications', title: 'Notification settings', group: 'Settings', routeName: 'NotificationSettings',
    load: () => import('../NotificationSettingsScreen') },
  { key: 'team', title: 'Team', group: 'Settings', routeName: 'Team',
    load: () => import('../TeamScreen') },
  { key: 'billing', title: 'Billing', group: 'Settings', routeName: 'Billing',
    load: () => import('../BillingScreen') },
  { key: 'billing-support', title: 'Billing support', group: 'Settings', routeName: 'BillingSupport',
    params: { context: { planName: 'Growth', subscriptionStatus: 'active', aiAllowanceCents: 800, aiUsedCents: 200 } },
    load: () => import('../BillingSupportScreen') },
  { key: 'partners', title: 'Partners', group: 'Settings', routeName: 'Partners',
    load: () => import('../PartnersScreen') },
  { key: 'sync-rules', title: 'Sync rules', group: 'Settings', routeName: 'SyncRules',
    params: { connectionId: 'conn_mock' },
    load: () => import('../SyncRulesScreen') },
  { key: 'backups', title: 'Backups', group: 'Settings', routeName: 'Backups',
    params: { orgId: 'org_mock' },
    load: () => import('../BackupsScreen') },
  { key: 'onboard-connection', title: 'Onboard connection', group: 'Settings', routeName: 'OnboardConnectionScreen',
    load: () => import('../OnboardConnectionScreen') },
  { key: 'delete-account', title: 'Delete account info', group: 'Settings', routeName: 'DeleteAccountInfo',
    load: () => import('../DeleteAccountInfoScreen') },

  // ---------- Import ----------
  { key: 'import-overview', title: 'Import overview', group: 'Import', routeName: 'ImportOverview',
    params: { connectionId: 'conn_mock', platformName: 'Shopify' },
    load: () => import('../ImportOverviewScreen') },
  { key: 'mapping-review', title: 'Mapping review', group: 'Import', routeName: 'MappingReview',
    params: { connectionId: 'conn_mock', platformName: 'Shopify' },
    load: () => import('../MappingReviewScreen') },
  { key: 'csv-mapping', title: 'CSV column mapping', group: 'Import', routeName: 'CSVColumnMapping',
    params: { connectionName: 'My CSV Import', csvHeaders: ['Title', 'SKU', 'Price', 'Quantity'], sampleRow: { Title: 'Nike Shoe', SKU: 'NIKE001', Price: '99.99', Quantity: '10' }, csvData: [ { Title: 'Nike Shoe', SKU: 'NIKE001', Price: '99.99', Quantity: '10' }, { Title: 'Adidas Shoe', SKU: 'ADIDAS001', Price: '89.99', Quantity: '15' } ] },
    load: () => import('../CSVColumnMappingScreen').then((m: any) => ({ default: m.default || m.CSVColumnMappingScreen })) },
  { key: 'backfill', title: 'Backfill optimizer', group: 'Import', routeName: 'BackfillOptimizer',
    params: { newlyImportedIds: ['prod_1', 'prod_2'] },
    load: () => import('../BackfillOptimizerScreen').then((m: any) => ({ default: m.default || m.BackfillOptimizerScreen })) },
];

export const ROUTES_BY_KEY: Record<string, ExportRoute> = Object.fromEntries(
  ROUTES.map((r) => [r.key, r])
);

export const GROUPS: string[] = ROUTES.reduce((acc: string[], r) => {
  if (!acc.includes(r.group)) acc.push(r.group);
  return acc;
}, []);

// One master page per flow (slug used in ?flow=<slug>).
export const FLOWS: { slug: string; group: string }[] = [
  { slug: 'inventory', group: 'Inventory' },
  { slug: 'onboarding', group: 'Onboarding & Login' },
  { slug: 'add-product', group: 'Add Product Flow' },
  { slug: 'settings', group: 'Settings' },
  { slug: 'import', group: 'Import' },
];

export const SLUG_TO_GROUP: Record<string, string> = Object.fromEntries(
  FLOWS.map((f) => [f.slug, f.group])
);

export const routesForGroup = (group: string) => ROUTES.filter((r) => r.group === group);
