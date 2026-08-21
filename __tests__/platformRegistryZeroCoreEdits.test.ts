import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLATFORMS,
  connectStepsFor,
  getPlatformFieldSchema,
  listConnectablePlatforms,
  platformSupportsPickupLocation,
  type PlatformDef,
} from '../src/config/platforms.ts';
import { getBrowserJobCopy } from '../src/lib/browserJobCodes.ts';
import {
  computerPostingSetupCopy,
  computerPostsViaCopy,
} from '../src/lib/computerPlatformCopy.ts';
import { isComputerJob } from '../src/lib/computerJobs.ts';
import { PLATFORM_FLAG_COLUMN } from '../src/lib/platforms.ts';

test('a registry-only computer platform reaches every derived mobile seam', () => {
  const runtimeRegistry = PLATFORMS as unknown as Record<string, PlatformDef>;
  const key = 'fake';

  runtimeRegistry[key] = {
    key,
    label: 'Fable',
    status: 'beta',
    onColumn: 'OnFake',
    brandColor: '#123456',
    mdiIcon: 'store-outline',
    logo: () => null,
    connect: {
      strategy: 'oauth',
      loginPath: '/api/auth/fake/login',
      redirectStyle: 'tagged',
    },
    capabilities: {
      canPublish: true,
      writeVia: 'computer',
      storefront: false,
      pickupLocation: true,
      shipping: true,
      supportsTaxonomy: false,
      requiredFields: ['title', 'price'],
    },
  };

  try {
    assert.deepEqual(connectStepsFor(key), ['oauth', 'linkComputer']);
    assert.equal((PLATFORM_FLAG_COLUMN as Record<string, string>)[key], 'OnFake');
    assert.equal((listConnectablePlatforms() as readonly string[]).includes(key), true);
    assert.equal(isComputerJob({ platform: 'fake_marketplace' }), true);
    assert.equal(platformSupportsPickupLocation(key), true);
    assert.deepEqual(getPlatformFieldSchema(key), {});
    assert.equal(
      getBrowserJobCopy('FACEBOOK_CHECKPOINT', key),
      'Fable needs a check on your computer',
    );
    assert.equal(
      computerPostingSetupCopy(key),
      'Posting to Fable happens through your own computer and Fable account, so it stays safe. Set it up once and we’ll handle the rest.',
    );
    assert.equal(computerPostsViaCopy(key), 'Fable posts via your computer.');
  } finally {
    delete runtimeRegistry[key];
  }
});
