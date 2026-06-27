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

import type React from 'react';
import type { SvgProps } from 'react-native-svg';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import WhatnotSvg from '../assets/whatnot.svg';
import DepopSvg from '../assets/depop-icon.svg';

export type PlatformKey =
  | 'shopify'
  | 'amazon'
  | 'ebay'
  | 'clover'
  | 'square'
  | 'facebook'
  | 'whatnot'
  | 'depop';

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
  extraParams?: Record<string, string>;
}

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
  /** Surfaces shipping/delivery options (DeliveryShippingSheet gate). */
  shipping: boolean;
  /** Has a browsable category taxonomy the editor should collect. */
  supportsTaxonomy: boolean;
  /** Form field used to carry the chosen category id, when supportsTaxonomy. */
  categoryField?: 'productCategoryId' | 'categoryId';
  /** Minimum fields required to publish (platformRequirements default set). */
  requiredFields: string[];
}

export interface PlatformDef {
  key: PlatformKey;
  /** Correctly-cased display label (e.g. 'eBay'). */
  label: string;
  /** Legacy / free-text PlatformType spellings that should resolve to this key. */
  aliases?: string[];
  /** Rollout state: ga = connectable + publishable, planned = not wired yet. */
  status: 'ga' | 'beta' | 'planned';
  /** ProductVariants boolean column, when one exists for this platform. */
  onColumn?: string;
  /** Brand color (reconciled to one canonical value per platform). */
  brandColor: string;
  /** MaterialCommunityIcons fallback name when the SVG logo isn't used. */
  mdiIcon: string;
  /** Brand SVG logo component. */
  logo: React.FC<SvgProps>;
  /** OAuth / connect flow definition; absent when not connectable in-app. */
  connect?: PlatformConnectDef;
  capabilities: PlatformCapabilities;
}

export const PLATFORMS: Record<PlatformKey, PlatformDef> = {
  shopify: {
    key: 'shopify',
    label: 'Shopify',
    aliases: ['Shopify'],
    status: 'ga',
    onColumn: 'OnShopify',
    brandColor: '#96BF47',
    mdiIcon: 'shopping',
    logo: ShopifySvg,
    connect: {
      strategy: 'shopifyStorePicker',
      loginPath: '/api/auth/shopify/initiate-store-picker',
      redirectStyle: 'bare',
    },
    capabilities: {
      canPublish: true,
      shipping: true,
      supportsTaxonomy: true,
      categoryField: 'productCategoryId',
      requiredFields: ['title', 'price', 'description', 'images', 'category'],
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
    connect: {
      strategy: 'oauth',
      loginPath: '/api/auth/square/login',
      redirectStyle: 'tagged',
    },
    capabilities: {
      canPublish: true,
      shipping: false,
      supportsTaxonomy: false,
      requiredFields: ['title', 'price'],
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
    connect: {
      strategy: 'oauth',
      loginPath: '/api/auth/clover/login',
      redirectStyle: 'tagged',
    },
    capabilities: {
      canPublish: true,
      shipping: false,
      supportsTaxonomy: false,
      requiredFields: ['title', 'price'],
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
    connect: {
      strategy: 'oauth',
      loginPath: '/api/auth/ebay/login',
      redirectStyle: 'tagged',
    },
    capabilities: {
      canPublish: true,
      shipping: true,
      supportsTaxonomy: true,
      categoryField: 'categoryId',
      requiredFields: ['title', 'price', 'description', 'images', 'category'],
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
    capabilities: {
      canPublish: true,
      // Facebook writes go through the user's own computer + Facebook login,
      // paced for account safety — keep OAuth (canPublish) for the sell axis.
      writeVia: 'computer',
      shipping: true,
      supportsTaxonomy: false,
      requiredFields: ['title', 'price', 'description', 'images'],
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
    capabilities: {
      canPublish: false,
      shipping: false,
      supportsTaxonomy: false,
      requiredFields: ['title', 'price', 'description', 'images'],
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
    capabilities: {
      canPublish: false,
      shipping: false,
      supportsTaxonomy: false,
      requiredFields: ['title', 'price'],
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
    capabilities: {
      canPublish: false,
      shipping: false,
      supportsTaxonomy: false,
      requiredFields: ['title', 'price'],
    },
  },
};

const ALL_PLATFORM_KEYS = Object.keys(PLATFORMS) as PlatformKey[];

// Lower-cased lookup index covering keys + aliases, built once.
const PLATFORM_INDEX: Record<string, PlatformDef> = (() => {
  const index: Record<string, PlatformDef> = {};
  for (const def of Object.values(PLATFORMS)) {
    index[def.key.toLowerCase()] = def;
    for (const alias of def.aliases ?? []) {
      index[alias.toLowerCase()] = def;
    }
  }
  return index;
})();

/**
 * Resolve any free-text platform spelling (key, alias, PascalCase legacy, or a
 * string that contains the platform name) to its canonical key. Returns
 * undefined when nothing matches.
 */
export const resolvePlatformKey = (raw?: string | null): PlatformKey | undefined => {
  if (!raw) return undefined;
  const norm = raw.toLowerCase().trim();
  if (PLATFORM_INDEX[norm]) return PLATFORM_INDEX[norm].key;
  // Loose contains-match (mirrors the legacy PlatformAvatar behavior, e.g.
  // "Shopify Store" → shopify, "facebook_marketplace" → facebook).
  for (const key of ALL_PLATFORM_KEYS) {
    if (norm.includes(key)) return key;
  }
  return undefined;
};

/** Look up a platform definition by any spelling. Undefined when unknown. */
export const getPlatform = (raw?: string | null): PlatformDef | undefined => {
  const key = resolvePlatformKey(raw);
  return key ? PLATFORMS[key] : undefined;
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
  let defs = ALL_PLATFORM_KEYS.map((k) => PLATFORMS[k]);
  if (opts.connectableOnly) defs = defs.filter((d) => !!d.connect);
  if (opts.publishableOnly) defs = defs.filter((d) => d.capabilities.canPublish);
  if (opts.enabledOnly) {
    const enabled = new Set(ENABLED_PLATFORMS);
    defs = defs.filter((d) => enabled.has(d.key));
  }
  return defs;
};

/** Brand color for a platform spelling, with a neutral fallback. */
export const getPlatformColor = (raw?: string | null, fallback = '#6B7280'): string =>
  getPlatform(raw)?.brandColor ?? fallback;

/** MDI fallback icon name for a platform spelling. */
export const getPlatformIcon = (raw?: string | null, fallback = 'store-outline'): string =>
  getPlatform(raw)?.mdiIcon ?? fallback;

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
  const exact = PLATFORM_INDEX[trimmed.toLowerCase()];
  return exact ? exact.label : trimmed;
};

// ── Legacy exports (derived from the registry; keep existing consumers working) ─

// Default connect picker shows only platforms with a real connect flow (main's
// fix — Amazon/Whatnot/Depop have no in-app auth yet, so listing them produced
// dead buttons). They remain in the registry; opt back in via EXPO_PUBLIC_ENABLED_PLATFORMS.
const DEFAULT_PLATFORM_KEYS: PlatformKey[] = ALL_PLATFORM_KEYS.filter(
  (k) => !!PLATFORMS[k].connect,
);

export const PLATFORM_CONFIG: Record<PlatformKey, { label: string; icon: string }> =
  ALL_PLATFORM_KEYS.reduce(
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
    (ALL_PLATFORM_KEYS as PlatformKey[]).includes(p),
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
  if (!ENABLED_PLATFORMS.includes(def.key)) return 'coming-soon';
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
