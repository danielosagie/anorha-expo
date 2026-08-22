import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  derivePlatformConnectStatus,
  platformConnectStatusLabel,
} from '../src/lib/platformConnectStatus.ts';
import { listSellingPlatformConnections } from '../src/lib/connectionImportPresentation.ts';

const disabledShopify = {
  Id: '9f259a53-a345-4484-af04-d1963477e24b',
  PlatformType: 'shopify',
  DisplayName: 'muffinsmc.myshopify.com',
  Status: 'inactive',
  IsEnabled: false,
};

test('disabled Shopify is Not connected in product detail and absent from Connections', () => {
  const status = derivePlatformConnectStatus(
    'shopify',
    [disabledShopify] as any,
    { computerOnline: false, presenceLoaded: true },
  );

  assert.equal(status.uiState, 'not-connected');
  assert.equal(platformConnectStatusLabel(status), 'Not connected');
  assert.deepEqual(listSellingPlatformConnections([disabledShopify]), []);
});

test('ProductDetail uses the shared platform connection derivation', () => {
  const source = readFileSync(
    '/Users/dosagie/Documents/CodeProjects/sssync_mobile_test/src/screens/ProductDetail.tsx',
    'utf8',
  );
  assert.match(source, /derivePlatformConnectStatus/);
  assert.match(source, /platformConnectStatusLabel/);
});
