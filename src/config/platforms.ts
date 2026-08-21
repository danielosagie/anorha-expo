// ────────────────────────────────────────────────────────────────────────────
// Platform registry — ONE place to describe every sales platform.
//
// Adding a platform should mean adding ONE entry to `PLATFORMS` below (plus its
// SVG asset + a backend adapter). Everything the frontend needs — label, brand
// color, logo, MDI fallback icon, OAuth connect strategy, capability gates, the
// On<Platform> column name — lives on the `PlatformDef`. Call sites read it via
// the helpers (getPlatform / listPlatforms / normalizeDisplayName / …) instead
// of re-declaring per-platform switches.
//
// Migration is incremental: this file is the source of truth; older scattered
// maps (getPlatformColor/getPlatformIcon switches, connect handlers, display
// strippers) get pointed at these helpers one file at a time. The legacy
// exports (PLATFORM_CONFIG / ENABLED_PLATFORMS / ENABLED_PLATFORM_OPTIONS) are
// derived from the registry below so existing consumers keep working unchanged.
// ────────────────────────────────────────────────────────────────────────────

import React from 'react';
import type { SvgProps } from 'react-native-svg';

type SvgModule = React.FC<SvgProps> | { default: React.FC<SvgProps> };

const lazySvg = (load: () => SvgModule): React.FC<SvgProps> => (props) => {
  const loaded = load();
  const Logo = typeof loaded === 'function' ? loaded : loaded.default;
  return React.createElement(Logo, props);
};

// Literal requires stay statically discoverable by Metro, while delaying SVG
// evaluation until a logo actually renders. Pure registry tests can run in Node.
const ShopifySvg = lazySvg(() => require('../assets/shopify.svg'));
const AmazonSvg = lazySvg(() => require('../assets/amazon.svg'));
const FacebookSvg = lazySvg(() => require('../assets/facebook.svg'));
const EbaySvg = lazySvg(() => require('../assets/ebay.svg'));
const CloverSvg = lazySvg(() => require('../assets/clover.svg'));
const SquareSvg = lazySvg(() => require('../assets/square.svg'));
const WhatnotSvg = lazySvg(() => require('../assets/whatnot.svg'));
const DepopSvg = lazySvg(() => require('../assets/depop-icon.svg'));

/**
 * A single step required to fully connect a platform. 'oauth' = the account
 * login / connection marker; 'linkComputer' = pairing the user's own desktop
 * (for browser-driven platforms like Facebook Marketplace). A platform counts as
 * connected only when ALL of its steps are done.
 */
export type ConnectStepKind = 'oauth' | 'linkComputer';

/** How a platform's OAuth / connect flow is kicked off from the mobile client. */
export interface PlatformConnectDef {
  /**
   * shopifyStorePicker → the store-picker initiate endpoint (Shopify only).
   * oauth → the standard `/api/auth/:platform/login` flow.
   */
  strategy: 'oauth' | 'shopifyStorePicker';
  /** Backend path that begins the auth flow (relative to API_BASE_URL). */
  loginPath: string;
  /**
   * bare   → deep-links back to `anorhaapp://auth-callback` (Shopify, Facebook).
   * tagged → deep-links to `anorhaapp://auth/callback?platform=<key>`.
   */
  redirectStyle: 'bare' | 'tagged';
  /** Extra query params appended to the login URL (e.g. Facebook's mode). */
  extraParams?: Readonly<Record<string, string>>;
  /**
   * Ordered connect steps this platform requires. Omit to use the derived
   * default (see connectStepsFor): ['oauth'], plus 'linkComputer' when
   * capabilities.writeVia === 'computer'. Set explicitly only when the order or
   * set is non-obvious.
   */
  requiredSteps?: readonly ConnectStepKind[];
}

export type PlatformFieldSchema = Record<string, any>;

/** What a platform can do — drives capability gates across the UI. */
export interface PlatformCapabilities {
  /** Can anorha publish/create listings on this platform today. */
  canPublish: boolean;
  /**
   * HOW writes are delivered (two-axis with canPublish — canPublish is the
   * "can sell" OAuth axis; this is the delivery axis):
   *   'api'      → posts directly via the platform API (default; omit).
   *   'computer' → posts through the user's own computer + their own platform
   *                login, paced for account safety. Gating must allow publishing
   *                but, when the computer is offline, the job sits PENDING
   *                ("waiting for your computer") — it NEVER blocks.
   * Default (undefined) === 'api', so every other platform is unchanged.
   */
  writeVia?: 'api' | 'computer';
  /** The connected account represents a seller-owned store rather than a marketplace. */
  storefront: boolean;
  /** Delivery data is nested under pickupLocation and exposes a pickup-location picker. */
  pickupLocation?: boolean;
  /** Surfaces shipping/delivery options (DeliveryShippingSheet gate). */
  shipping: boolean;
  /** Has a browsable category taxonomy the editor should collect. */
  supportsTaxonomy: boolean;
  /** Form field used to carry the chosen category id, when supportsTaxonomy. */
  categoryField?: 'productCategoryId' | 'categoryId';
  /** Minimum fields required to publish (platformRequirements default set). */
  requiredFields: readonly string[];
}

export interface PlatformDef {
  key: string;
  /** Correctly-cased display label (e.g. 'eBay'). */
  label: string;
  /** Legacy / free-text PlatformType spellings that should resolve to this key. */
  aliases?: readonly string[];
  /** Rollout state: ga = connectable + publishable, planned = not wired yet. */
  status: 'ga' | 'beta' | 'planned';
  /** ProductVariants boolean column, when one exists for this platform. */
  onColumn?: `On${string}`;
  /** Brand color (reconciled to one canonical value per platform). */
  brandColor: string;
  /** MaterialCommunityIcons fallback name when the SVG logo isn't used. */
  mdiIcon: string;
  /** Brand SVG logo component. */
  logo: React.FC<SvgProps>;
  /** Optional registry-driven placement in onboarding platform artwork. */
  onboarding?: { syncOrder?: number; listOrder?: number };
  /** OAuth / connect flow definition; absent when not connectable in-app. */
  connect?: PlatformConnectDef;
  /** Listing editor fields. Missing schemas resolve to the shared empty default. */
  fieldSchema?: PlatformFieldSchema;
  capabilities: PlatformCapabilities;
}

export const PLATFORMS = {
  shopify: {
    key: 'shopify',
    label: 'Shopify',
    aliases: ['Shopify'],
    status: 'ga',
    onColumn: 'OnShopify',
    brandColor: '#96BF47',
    mdiIcon: 'shopping',
    logo: ShopifySvg,
    onboarding: { syncOrder: 1, listOrder: 1 },
    connect: {
      strategy: 'shopifyStorePicker',
      // The reusable flow discovers the handle in Shopify Admin first, then
      // calls this supported, store-specific OAuth entry point.
      loginPath: '/api/auth/shopify/login',
      redirectStyle: 'bare',
    },
    fieldSchema: {
      title: { type: 'string', label: 'Title', required: true },
      description: { type: 'string', label: 'Description', multiline: true },
      vendor: { type: 'string', label: 'Vendor' },
      productCategory: { type: 'string', label: 'Product Category' },
      productType: { type: 'string', label: 'Product Type' },
      tags: { type: 'array', label: 'Tags' },
      status: { type: 'select', label: 'Status', options: ['active', 'draft', 'archived'] },
      variants: {
        type: 'array',
        label: 'Variants',
        schema: {
          sku: { type: 'string', label: 'SKU' },
          barcode: { type: 'string', label: 'Barcode' },
          price: { type: 'number', label: 'Price' },
          compareAtPrice: { type: 'number', label: 'Compare At Price' },
          costPerItem: { type: 'number', label: 'Cost Per Item' },
          weightValueGrams: { type: 'number', label: 'Weight (g)' },
          requiresShipping: { type: 'boolean', label: 'Requires Shipping' },
        },
      },
      images: { type: 'array', label: 'Images' },
      seo: {
        type: 'object',
        label: 'SEO',
        schema: {
          seoTitle: { type: 'string', label: 'SEO Title' },
          seoDescription: { type: 'string', label: 'SEO Description', multiline: true },
        },
      },
    },
    capabilities: {
      canPublish: true,
      storefront: true,
      shipping: true,
      supportsTaxonomy: true,
      categoryField: 'productCategoryId',
      requiredFields: ['title', 'sku', 'price', 'description', 'images', 'category'],
    },
  },
  square: {
    key: 'square',
    label: 'Square',
    aliases: ['Square'],
    status: 'ga',
    onColumn: 'OnSquare',
    brandColor: '#3E4348',
    mdiIcon: 'square-outline',
    logo: SquareSvg,
    onboarding: { syncOrder: 2, listOrder: 4 },
    connect: {
      strategy: 'oauth',
      loginPath: '/api/auth/square/login',
      redirectStyle: 'tagged',
    },
    fieldSchema: {
      name: { type: 'string', label: 'Name', required: true },
      description: { type: 'string', label: 'Description', multiline: true },
      sku: { type: 'string', label: 'SKU' },
      price: { type: 'number', label: 'Price' },
    },
    capabilities: {
      canPublish: true,
      storefront: true,
      shipping: true,
      supportsTaxonomy: false,
      requiredFields: ['title', 'sku', 'price'],
    },
  },
  clover: {
    key: 'clover',
    label: 'Clover',
    aliases: ['Clover'],
    status: 'ga',
    onColumn: 'OnClover',
    brandColor: '#3CAD46',
    mdiIcon: 'leaf',
    logo: CloverSvg,
    onboarding: { syncOrder: 4, listOrder: 5 },
    connect: {
      strategy: 'oauth',
      loginPath: '/api/auth/clover/login',
      // Bare, not tagged: the backend's Clover App Market finish page returns on
      // anorhaapp://auth-callback, so both entry paths must share one surface.
      redirectStyle: 'bare',
    },
    fieldSchema: {
      name: { type: 'string', label: 'Name', required: true },
      price: { type: 'number', label: 'Price', required: true },
      sku: { type: 'string', label: 'SKU' },
      category: { type: 'string', label: 'Category' },
    },
    capabilities: {
      canPublish: true,
      storefront: true,
      shipping: true,
      supportsTaxonomy: false,
      requiredFields: ['title', 'sku', 'price'],
    },
  },
  ebay: {
    key: 'ebay',
    label: 'eBay',
    aliases: ['Ebay', 'eBay', 'EBay'],
    status: 'ga',
    onColumn: 'OnEbay',
    brandColor: '#E53238',
    mdiIcon: 'shopping',
    logo: EbaySvg,
    onboarding: { syncOrder: 3, listOrder: 3 },
    connect: {
      strategy: 'oauth',
      loginPath: '/api/auth/ebay/login',
      redirectStyle: 'tagged',
    },
    fieldSchema: {
      title: { type: 'string', label: 'Title', required: true },
      subtitle: { type: 'string', label: 'Subtitle' },
      description: { type: 'string', label: 'Description', multiline: true },
      category: { type: 'string', label: 'Category' },
      conditionID: { type: 'number', label: 'Condition ID' },
      listingDetails: {
        type: 'object',
        label: 'Listing Details',
        schema: {
          format: { type: 'select', label: 'Format', options: ['FixedPrice', 'Auction'] },
          startPrice: { type: 'number', label: 'Price' },
          quantity: { type: 'number', label: 'Quantity' },
          bestOfferEnabled: { type: 'boolean', label: 'Best Offer' },
        },
      },
    },
    capabilities: {
      canPublish: true,
      storefront: false,
      shipping: true,
      supportsTaxonomy: true,
      categoryField: 'categoryId',
      requiredFields: ['title', 'sku', 'price', 'description', 'images', 'category'],
    },
  },
  facebook: {
    key: 'facebook',
    label: 'Facebook',
    aliases: ['Facebook', 'FacebookMarketplace', 'Facebook Marketplace'],
    status: 'ga',
    onColumn: 'OnFacebook',
    brandColor: '#1877F2',
    mdiIcon: 'facebook',
    logo: FacebookSvg,
    connect: {
      strategy: 'oauth',
      loginPath: '/api/auth/facebook/login',
      redirectStyle: 'bare',
      extraParams: { mode: 'personal_marketplace' },
    },
    fieldSchema: {
      title: { type: 'string', label: 'Title', required: true },
      description: { type: 'string', label: 'Description', multiline: true },
      availability: { type: 'select', label: 'Availability', options: ['in stock', 'out of stock'] },
      condition: { type: 'select', label: 'Condition', options: ['new', 'refurbished', 'used'] },
      price: { type: 'string', label: 'Price' },
      brand: { type: 'string', label: 'Brand' },
    },
    capabilities: {
      canPublish: true,
      // Facebook writes go through the user's own computer + Facebook login,
      // paced for account safety — keep OAuth (canPublish) for the sell axis.
      writeVia: 'computer',
      storefront: false,
      pickupLocation: true,
      shipping: true,
      supportsTaxonomy: false,
      requiredFields: ['title', 'sku', 'price', 'description', 'images'],
    },
  },
  amazon: {
    key: 'amazon',
    label: 'Amazon',
    aliases: ['Amazon'],
    // Has an OnAmazon column + field requirements but no adapter/OAuth yet.
    status: 'planned',
    onColumn: 'OnAmazon',
    brandColor: '#FF9900',
    mdiIcon: 'package',
    logo: AmazonSvg,
    onboarding: { listOrder: 2 },
    fieldSchema: {
      sku: { type: 'string', label: 'SKU', required: true },
      productId: { type: 'string', label: 'Product ID' },
      productIdType: { type: 'select', label: 'ID Type', options: ['UPC', 'EAN', 'ASIN'] },
      title: { type: 'string', label: 'Title', required: true },
      brand: { type: 'string', label: 'Brand' },
      description: { type: 'string', label: 'Description', multiline: true },
      bullet_points: { type: 'array', label: 'Bullet Points' },
      price: { type: 'number', label: 'Price', required: true },
      quantity: { type: 'number', label: 'Quantity' },
      condition: { type: 'select', label: 'Condition', options: ['New', 'Refurbished', 'Used'] },
    },
    capabilities: {
      canPublish: false,
      storefront: false,
      shipping: false,
      supportsTaxonomy: false,
      requiredFields: ['title', 'sku', 'price', 'description', 'images'],
    },
  },
  whatnot: {
    key: 'whatnot',
    label: 'Whatnot',
    aliases: ['Whatnot'],
    // Backend adapter exists but there's no On-column / in-app connect yet.
    status: 'planned',
    brandColor: '#FFE406',
    mdiIcon: 'television-play',
    logo: WhatnotSvg,
    fieldSchema: {
      title: { type: 'string', label: 'Title', required: true },
      description: { type: 'string', label: 'Description', multiline: true },
      category: { type: 'string', label: 'Category' },
      price: { type: 'number', label: 'Price', required: true },
      quantity: { type: 'number', label: 'Quantity' },
      condition: { type: 'string', label: 'Condition' },
      sku: { type: 'string', label: 'SKU' },
    },
    capabilities: {
      canPublish: false,
      storefront: false,
      shipping: false,
      supportsTaxonomy: false,
      requiredFields: ['title', 'sku', 'price'],
    },
  },
  depop: {
    key: 'depop',
    label: 'Depop',
    aliases: ['Depop'],
    status: 'planned',
    brandColor: '#FF2300',
    mdiIcon: 'alpha-d-circle',
    logo: DepopSvg,
    onboarding: { listOrder: 6 },
    capabilities: {
      canPublish: false,
      storefront: false,
      shipping: false,
      supportsTaxonomy: false,
      requiredFields: ['title', 'sku', 'price'],
    },
  },
} as const satisfies Record<string, PlatformDef>;

/** Canonical platform union, derived from the registry keys. */
export type PlatformKey = keyof typeof PLATFORMS;

/** Registry keys with an in-app connect definition. */
export type ConnectablePlatform = {
  [Key in PlatformKey]: (typeof PLATFORMS)[Key] extends { readonly connect: PlatformConnectDef }
    ? Key
    : never;
}[PlatformKey];

/** Registry keys currently backed by a ProductVariants `On*` column. */
export type VariantPlatformKey = {
  [Key in PlatformKey]: (typeof PLATFORMS)[Key] extends { readonly onColumn: `On${string}` }
    ? Key
    : never;
}[PlatformKey];

export type PlatformFlagColumn = (typeof PLATFORMS)[VariantPlatformKey]['onColumn'];

const registryDefs = (): PlatformDef[] => Object.values(PLATFORMS) as PlatformDef[];
const registryKeys = (): PlatformKey[] => Object.keys(PLATFORMS) as PlatformKey[];

/**
 * Resolve any free-text platform spelling (key, alias, PascalCase legacy, or a
 * string that contains the platform name) to its canonical key. Returns
 * undefined when nothing matches.
 */
export const resolvePlatformKey = (raw?: string | null): PlatformKey | undefined => {
  if (!raw) return undefined;
  const norm = raw.toLowerCase().trim();
  const exact = registryDefs().find((def) => (
    def.key.toLowerCase() === norm
    || (def.aliases ?? []).some((alias) => alias.toLowerCase() === norm)
  ));
  if (exact) return exact.key as PlatformKey;
  // Loose contains-match (mirrors the legacy PlatformAvatar behavior, e.g.
  // "Shopify Store" or a marketplace-specific backend value).
  for (const def of registryDefs()) {
    if (norm.includes(def.key.toLowerCase())) return def.key as PlatformKey;
  }
  return undefined;
};

/** Look up a platform definition by any spelling. Undefined when unknown. */
export const getPlatform = (raw?: string | null): PlatformDef | undefined => {
  const key = resolvePlatformKey(raw);
  return key ? (PLATFORMS as Record<string, PlatformDef>)[key] : undefined;
};

export interface ListPlatformsOptions {
  /** Only platforms that can be connected in-app (have a connect def). */
  connectableOnly?: boolean;
  /** Only platforms that can be published to today. */
  publishableOnly?: boolean;
  /** Restrict to the env-enabled set (ENABLED_PLATFORMS). */
  enabledOnly?: boolean;
}

/** All platform defs, optionally filtered. Order follows PLATFORMS insertion. */
export const listPlatforms = (opts: ListPlatformsOptions = {}): PlatformDef[] => {
  let defs = registryDefs();
  if (opts.connectableOnly) defs = defs.filter((d) => !!d.connect);
  if (opts.publishableOnly) defs = defs.filter((d) => d.capabilities.canPublish);
  if (opts.enabledOnly) {
    const enabled = new Set<string>(ENABLED_PLATFORMS);
    defs = defs.filter((d) => enabled.has(d.key));
  }
  return defs;
};

/** Connectable platform keys, recomputed from the registry for each read. */
export const listConnectablePlatforms = (): ConnectablePlatform[] =>
  listPlatforms({ connectableOnly: true }).map((def) => def.key as ConnectablePlatform);

/** Brand color for a platform spelling, with a neutral fallback. */
export const getPlatformColor = (raw?: string | null, fallback = '#6B7280'): string =>
  getPlatform(raw)?.brandColor ?? fallback;

/** MDI fallback icon name for a platform spelling. */
export const getPlatformIcon = (raw?: string | null, fallback = 'store-outline'): string =>
  getPlatform(raw)?.mdiIcon ?? fallback;

/** Correctly-cased label for any registry spelling, with a natural fallback. */
export const getPlatformLabel = (raw?: string | null, fallback = 'This channel'): string =>
  getPlatform(raw)?.label ?? fallback;

/**
 * How a platform delivers writes: 'api' (default) or 'computer'. A 'computer'
 * platform (Facebook) still allows publishing, but the job waits for the user's
 * computer to be on instead of posting via API. Undefined platforms → 'api'.
 */
export const getPlatformWriteVia = (raw?: string | null): 'api' | 'computer' =>
  getPlatform(raw)?.capabilities.writeVia ?? 'api';

/** True when a platform posts through the user's own computer (e.g. Facebook). */
export const platformRequiresComputer = (raw?: string | null): boolean =>
  getPlatformWriteVia(raw) === 'computer';

/** True when delivery data uses the pickupLocation shape and picker. */
export const platformSupportsPickupLocation = (raw?: string | null): boolean =>
  getPlatform(raw)?.capabilities.pickupLocation === true;

/** True for seller-owned store connections rather than marketplace accounts. */
export const platformIsStorefront = (raw?: string | null): boolean =>
  getPlatform(raw)?.capabilities.storefront === true;

const EMPTY_PLATFORM_FIELD_SCHEMA: PlatformFieldSchema = Object.freeze({});

/** Listing-editor schema for a platform, defaulting to a shared empty schema. */
export const getPlatformFieldSchema = (raw?: string | null): PlatformFieldSchema =>
  getPlatform(raw)?.fieldSchema ?? EMPTY_PLATFORM_FIELD_SCHEMA;

/**
 * The ordered connect steps a platform requires to be FULLY connected. Explicit
 * `connect.requiredSteps` wins; otherwise derived: 'oauth' for any connectable
 * platform, plus 'linkComputer' for computer-write platforms (Facebook). A
 * platform with no connect def and no computer write returns []. This is the ONE
 * place the reusable connect flow reads, so adding a computer-write platform
 * automatically gets the combined OAuth + link-computer flow with no other edits.
 */
export const connectStepsFor = (raw?: string | null): ConnectStepKind[] => {
  const def = getPlatform(raw);
  if (!def) return [];
  if (def.connect?.requiredSteps) return [...def.connect.requiredSteps];
  const steps: ConnectStepKind[] = [];
  if (def.connect) steps.push('oauth');
  if (def.capabilities.writeVia === 'computer') steps.push('linkComputer');
  return steps;
};

/**
 * Human-friendly display name for a raw platform value. Strips Shopify's
 * `.myshopify.com` store-domain suffix, resolves known platforms to their
 * correctly-cased label, and otherwise title-cases the input.
 */
export const normalizeDisplayName = (raw?: string | null): string => {
  if (!raw) return '';
  const trimmed = raw.trim();
  // Shop domains → strip the myshopify suffix and show the store handle.
  if (/\.myshopify\.com$/i.test(trimmed)) {
    return trimmed.replace(/\.myshopify\.com$/i, '');
  }
  // Collapse to the canonical label ONLY on an exact key/alias match — never the
  // fuzzy includes() match getPlatform() uses, otherwise a user's free-text
  // connection name like "Square One Boutique" or "Clover Lane Goods" would be
  // destroyed and rendered as just "Square"/"Clover". Anything else is returned
  // verbatim (matches the old shopLabel behavior).
  const exact = registryDefs().find((def) => (
    def.key.toLowerCase() === trimmed.toLowerCase()
    || (def.aliases ?? []).some((alias) => alias.toLowerCase() === trimmed.toLowerCase())
  ));
  return exact ? exact.label : trimmed;
};

// ── Legacy exports (derived from the registry; keep existing consumers working) ─

// Default connect picker shows only platforms with a real connect flow (main's
// fix — Amazon/Whatnot/Depop have no in-app auth yet, so listing them produced
// dead buttons). They remain in the registry; opt back in via EXPO_PUBLIC_ENABLED_PLATFORMS.
const DEFAULT_PLATFORM_KEYS: PlatformKey[] = registryKeys().filter(
  (key) => !!getPlatform(key)?.connect,
) as PlatformKey[];

export const PLATFORM_CONFIG: Record<PlatformKey, { label: string; icon: string }> =
  registryKeys().reduce(
    (acc, key) => {
      acc[key] = { label: PLATFORMS[key].label, icon: PLATFORMS[key].mdiIcon };
      return acc;
    },
    {} as Record<PlatformKey, { label: string; icon: string }>,
  );

const parseEnabledPlatforms = (): PlatformKey[] => {
  const raw = process.env.EXPO_PUBLIC_ENABLED_PLATFORMS;
  if (!raw) return DEFAULT_PLATFORM_KEYS;

  const tokens = raw
    .split(',')
    .map((p: string) => p.trim().toLowerCase())
    .filter(Boolean) as PlatformKey[];

  const valid = tokens.filter((p) =>
    registryKeys().includes(p),
  );

  return valid.length ? valid : DEFAULT_PLATFORM_KEYS;
};

export const ENABLED_PLATFORMS: PlatformKey[] = parseEnabledPlatforms();

export const ENABLED_PLATFORM_OPTIONS = ENABLED_PLATFORMS.map((key) => ({
  key,
  ...PLATFORM_CONFIG[key],
}));

// ── Availability — the ONE on/off + "why not" gate ───────────────────────────
// Turn a platform on/off by editing EXPO_PUBLIC_ENABLED_PLATFORMS (a comma list,
// e.g. `shopify,ebay,square,facebook`). A platform also needs status !== 'planned'
// and a `connect` def to be connectable. Computer-write platforms (Facebook) need
// the desktop helper linked — pass `computerOnline` to surface that cleanly
// instead of letting the user hit a wall.
export type PlatformAvailability = 'available' | 'needs-computer' | 'coming-soon';

export const getPlatformAvailability = (
  raw?: string | null,
  opts?: { computerOnline?: boolean },
): PlatformAvailability => {
  const def = getPlatform(raw);
  if (!def || !def.connect || def.status === 'planned') return 'coming-soon';
  if (!ENABLED_PLATFORMS.includes(def.key as PlatformKey)) return 'coming-soon';
  if (def.capabilities.writeVia === 'computer' && opts?.computerOnline === false) return 'needs-computer';
  return 'available';
};

/** Short, user-facing reason a platform can't be used right now ('' = available). */
export const platformUnavailableReason = (a: PlatformAvailability): string =>
  a === 'needs-computer'
    ? 'Connect your computer to use this'
    : a === 'coming-soon'
      ? 'Coming soon'
      : '';
