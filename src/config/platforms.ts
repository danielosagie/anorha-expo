export type PlatformKey =
  | 'shopify'
  | 'amazon'
  | 'ebay'
  | 'clover'
  | 'square'
  | 'facebook';

const DEFAULT_PLATFORM_KEYS: PlatformKey[] = [
  'shopify',
  'amazon',
  'ebay',
  'clover',
  'square',
  'facebook',
];

export const PLATFORM_CONFIG: Record<
  PlatformKey,
  { label: string; icon: string }
> = {
  shopify: { label: 'Shopify', icon: 'shopping' },
  amazon: { label: 'Amazon', icon: 'package' },
  ebay: { label: 'eBay', icon: 'shopping' },
  clover: { label: 'Clover', icon: 'leaf' },
  square: { label: 'Square', icon: 'square-outline' },
  facebook: { label: 'Facebook', icon: 'facebook' },
};

const parseEnabledPlatforms = (): PlatformKey[] => {
  const raw = process.env.EXPO_PUBLIC_ENABLED_PLATFORMS;
  if (!raw) return DEFAULT_PLATFORM_KEYS;

  const tokens = raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean) as PlatformKey[];

  const valid = tokens.filter((p) =>
    (DEFAULT_PLATFORM_KEYS as PlatformKey[]).includes(p),
  );

  return valid.length ? valid : DEFAULT_PLATFORM_KEYS;
};

export const ENABLED_PLATFORMS: PlatformKey[] = parseEnabledPlatforms();

export const ENABLED_PLATFORM_OPTIONS = ENABLED_PLATFORMS.map((key) => ({
  key,
  ...PLATFORM_CONFIG[key],
}));

