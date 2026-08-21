/**
 * Compatibility access to listing field schemas owned by the platform registry.
 * New consumers should call getPlatformFieldSchema directly.
 */
import {
  getPlatformFieldSchema,
  listPlatforms,
  type PlatformFieldSchema,
  type PlatformKey,
} from '../config/platforms';

export { getPlatformFieldSchema } from '../config/platforms';
export type { PlatformFieldSchema } from '../config/platforms';

export const PLATFORM_FIELD_SCHEMA = new Proxy(
  {} as Record<PlatformKey, PlatformFieldSchema>,
  {
    get: (_target, property) => (
      typeof property === 'string' ? getPlatformFieldSchema(property) : undefined
    ),
    ownKeys: () => listPlatforms().map((def) => def.key),
    getOwnPropertyDescriptor: (_target, property) => (
      typeof property === 'string'
        ? { configurable: true, enumerable: true }
        : undefined
    ),
  },
);
