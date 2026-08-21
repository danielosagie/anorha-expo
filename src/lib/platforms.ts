/**
 * Track B (v2): variant membership still uses registry-declared `On*` columns.
 * The public compatibility names below are all derived from that capability.
 */

import {
  getPlatform,
  listPlatforms,
  type PlatformFlagColumn,
  type VariantPlatformKey,
} from '../config/platforms.ts';

export type PlatformType = VariantPlatformKey;
export type VariantPlatformFlags = Partial<Record<PlatformFlagColumn, boolean | null>>;

/** Platforms with a registry `onColumn`, in registry order. */
export const listVariantPlatforms = (): PlatformType[] =>
  listPlatforms()
    .filter((def) => !!def.onColumn)
    .map((def) => def.key as PlatformType);

/** Compatibility list, derived rather than hand-maintained. */
export const PLATFORM_TYPES: readonly PlatformType[] = listVariantPlatforms();

/** Resolve the current registry column for a variant-backed platform. */
export const getPlatformFlagColumn = (platform: string): PlatformFlagColumn | undefined =>
  getPlatform(platform)?.onColumn as PlatformFlagColumn | undefined;

/**
 * Compatibility map. Property reads and enumeration resolve from the live
 * registry so a newly registered platform is visible without another edit.
 */
export const PLATFORM_FLAG_COLUMN = new Proxy(
  {} as Record<PlatformType, PlatformFlagColumn>,
  {
    get: (_target, property) => (
      typeof property === 'string' ? getPlatformFlagColumn(property) : undefined
    ),
    ownKeys: () => listVariantPlatforms(),
    getOwnPropertyDescriptor: (_target, property) => (
      typeof property === 'string' && getPlatformFlagColumn(property)
        ? { configurable: true, enumerable: true }
        : undefined
    ),
  },
);

/** Platforms a variant is currently listed on, derived from its `On*` flags. */
export function getVariantPlatforms(
  variant: VariantPlatformFlags | null | undefined,
): PlatformType[] {
  if (!variant) return [];
  return listVariantPlatforms().filter((platform) => {
    const column = getPlatformFlagColumn(platform);
    return column ? Boolean(variant[column]) : false;
  });
}

/** Whether a variant is listed on a specific platform. */
export function isVariantOnPlatform(
  variant: VariantPlatformFlags | null | undefined,
  platform: PlatformType,
): boolean {
  const column = getPlatformFlagColumn(platform);
  return Boolean(variant && column && variant[column]);
}
