// Pure tests for the catalog patch bus (src/lib/catalogPatches.ts): the store
// (apply/subscribe/drain) and the merge helpers the inventory shelf uses.
// Runnable with Node's native TS type-stripping (Node >= 22.18):
//   node --test __tests__/catalogPatches.test.ts
// This directory is excluded from tsconfig, so these tests never gate `tsc`.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLevelPatch,
  applyLevelPatchesToMap,
  applyVariantPatch,
  applyVariantPatchesToMap,
  drainCatalogPatches,
  getCatalogPatchVersion,
  getLevelPatches,
  getVariantPatches,
  markCatalogStale,
  mergeNewestByUpdatedAt,
  subscribeCatalogPatches,
  subscribeCatalogStale,
} from '../src/lib/catalogPatches.ts';

// The store is module-level (by design — no provider needed); reset between tests.
beforeEach(() => {
  drainCatalogPatches(Date.now() + 60_000);
});

const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse('2026-08-09T12:00:00.000Z');

// ---------------------------------------------------------------------------
// mergeNewestByUpdatedAt
// ---------------------------------------------------------------------------

test('merge: rows only on one side pass through', () => {
  const merged = mergeNewestByUpdatedAt(
    { a: { Id: 'a', UpdatedAt: iso(T0) } },
    { b: { Id: 'b', UpdatedAt: iso(T0) } },
  );
  assert.deepEqual(Object.keys(merged).sort(), ['a', 'b']);
});

test('merge: newest UpdatedAt wins per key, either direction', () => {
  const older = { Id: 'a', Title: 'old', UpdatedAt: iso(T0) };
  const newer = { Id: 'a', Title: 'new', UpdatedAt: iso(T0 + 5_000) };

  // Realtime (base/legend) newer than direct fetch -> base wins.
  assert.equal(mergeNewestByUpdatedAt({ a: newer }, { a: older }).a.Title, 'new');
  // Direct fetch newer -> overlay wins.
  assert.equal(mergeNewestByUpdatedAt({ a: older }, { a: newer }).a.Title, 'new');
});

test('merge: ties and missing/unparseable stamps go to overlay (direct fetch)', () => {
  const legend = { Id: 'a', Title: 'legend', UpdatedAt: iso(T0) };
  const direct = { Id: 'a', Title: 'direct', UpdatedAt: iso(T0) };
  assert.equal(mergeNewestByUpdatedAt({ a: legend }, { a: direct }).a.Title, 'direct');

  const noStampBase = { Id: 'a', Title: 'legend' } as any;
  const noStampOverlay = { Id: 'a', Title: 'direct' } as any;
  assert.equal(mergeNewestByUpdatedAt({ a: noStampBase }, { a: noStampOverlay }).a.Title, 'direct');
  assert.equal(
    mergeNewestByUpdatedAt(
      { a: { ...legend, UpdatedAt: 'garbage' } },
      { a: direct },
    ).a.Title,
    'direct',
  );
});

test('merge: post-import shape — fresh direct rows beat a stale-but-larger legend mirror', () => {
  const legend: Record<string, any> = {};
  const direct: Record<string, any> = {};
  for (let i = 0; i < 5; i += 1) legend[`v${i}`] = { Id: `v${i}`, Title: 'stale', UpdatedAt: iso(T0) };
  for (let i = 0; i < 3; i += 1) direct[`v${i}`] = { Id: `v${i}`, Title: 'fresh', UpdatedAt: iso(T0 + 1_000) };
  const merged = mergeNewestByUpdatedAt(legend, direct);
  assert.equal(merged.v0.Title, 'fresh');
  assert.equal(merged.v4.Title, 'stale'); // untouched rows survive
});

// ---------------------------------------------------------------------------
// Variant patch application
// ---------------------------------------------------------------------------

test('variant patches: merge last over the row, newest-wins', () => {
  const rows = { a: { Id: 'a', Title: 'server', Price: 10, UpdatedAt: iso(T0) } };
  const out = applyVariantPatchesToMap(rows, [
    { id: 'a', fields: { Title: 'patched', UpdatedAt: iso(T0 + 1_000) }, at: Date.now() },
  ]);
  assert.equal(out.a.Title, 'patched');
  assert.equal(out.a.Price, 10); // untouched fields kept
  // Input map not mutated.
  assert.equal(rows.a.Title, 'server');
});

test('variant patches: a stale patch never overrides a fresher server row', () => {
  const rows = { a: { Id: 'a', Title: 'fresh-server', UpdatedAt: iso(T0 + 10_000) } };
  const out = applyVariantPatchesToMap(rows, [
    { id: 'a', fields: { Title: 'stale-patch', UpdatedAt: iso(T0) }, at: Date.now() },
  ]);
  assert.equal(out.a.Title, 'fresh-server');
});

test('variant patches: unknown row ids are ignored; Products projection deep-merges', () => {
  const rows: Record<string, any> = {
    a: {
      Id: 'a',
      UpdatedAt: iso(T0),
      Products: { Title: 'P', Description: 'old', Tags: ['x'] },
    },
  };
  const out = applyVariantPatchesToMap(rows, [
    { id: 'missing', fields: { Title: 'nope', UpdatedAt: iso(T0 + 1) }, at: Date.now() },
    { id: 'a', fields: { Products: { Description: 'new' }, UpdatedAt: iso(T0 + 1) }, at: Date.now() },
  ]);
  assert.equal(out.missing, undefined);
  assert.equal(out.a.Products.Description, 'new');
  assert.equal(out.a.Products.Title, 'P'); // not clobbered
  assert.deepEqual(out.a.Products.Tags, ['x']);
});

test('variant patches: array-form Products projection is normalized before merge', () => {
  const rows: Record<string, any> = {
    a: { Id: 'a', UpdatedAt: iso(T0), Products: [{ Title: 'P', Description: 'old', Tags: null }] },
  };
  const out = applyVariantPatchesToMap(rows, [
    { id: 'a', fields: { Products: { Description: 'new' }, UpdatedAt: iso(T0 + 1) }, at: Date.now() },
  ]);
  assert.equal(out.a.Products.Title, 'P');
  assert.equal(out.a.Products.Description, 'new');
});

// ---------------------------------------------------------------------------
// Level patch application
// ---------------------------------------------------------------------------

const level = (id: string, over: Record<string, unknown> = {}) => ({
  Id: id,
  ProductVariantId: 'v1',
  PlatformConnectionId: 'conn1',
  PlatformLocationId: 'loc1',
  Quantity: 5,
  UpdatedAt: iso(T0),
  ...over,
});

test('level patches: id patch hits its row directly', () => {
  const rows = { l1: level('l1'), l2: level('l2', { Quantity: 9 }) };
  const out = applyLevelPatchesToMap(rows, [
    { id: 'l1', fields: { Quantity: 42, UpdatedAt: iso(T0 + 1_000) }, at: Date.now() },
  ]);
  assert.equal(out.l1.Quantity, 42);
  assert.equal(out.l2.Quantity, 9);
});

test('level patches: match patch resolves by variant + connection + location', () => {
  const rows = {
    l1: level('l1'),
    l2: level('l2', { PlatformLocationId: 'loc2' }),
    l3: level('l3', { ProductVariantId: 'v2' }),
  };
  const out = applyLevelPatchesToMap(rows, [
    {
      id: null,
      match: { productVariantId: 'v1', platformConnectionId: 'conn1', platformLocationId: 'loc1' },
      fields: { Quantity: 77, UpdatedAt: iso(T0 + 1_000) },
      at: Date.now(),
    },
  ]);
  assert.equal(out.l1.Quantity, 77);
  assert.equal(out.l2.Quantity, 5);
  assert.equal(out.l3.Quantity, 5);
});

test('level patches: null location in match means the default/unset location', () => {
  const rows = {
    l1: level('l1', { PlatformLocationId: null }),
    l2: level('l2'), // loc1
  };
  const out = applyLevelPatchesToMap(rows, [
    {
      id: null,
      match: { productVariantId: 'v1', platformConnectionId: 'conn1', platformLocationId: null },
      fields: { Quantity: 3, UpdatedAt: iso(T0 + 1_000) },
      at: Date.now(),
    },
  ]);
  assert.equal(out.l1.Quantity, 3);
  assert.equal(out.l2.Quantity, 5);
});

test('level patches: stale patch loses to a fresher level row', () => {
  const rows = { l1: level('l1', { Quantity: 99, UpdatedAt: iso(T0 + 10_000) }) };
  const out = applyLevelPatchesToMap(rows, [
    { id: 'l1', fields: { Quantity: 1, UpdatedAt: iso(T0) }, at: Date.now() },
  ]);
  assert.equal(out.l1.Quantity, 99);
});

// ---------------------------------------------------------------------------
// Store: apply / subscribe / drain
// ---------------------------------------------------------------------------

test('store: applyVariantPatch coalesces per id, stamps UpdatedAt, notifies, drains', () => {
  let notified = 0;
  const unsubscribe = subscribeCatalogPatches(() => { notified += 1; });
  const versionBefore = getCatalogPatchVersion();

  applyVariantPatch('a', { Title: 'one' });
  applyVariantPatch('a', { Price: 2 });
  applyVariantPatch('b', { Title: 'two', UpdatedAt: iso(T0) });

  assert.equal(notified, 3);
  assert.ok(getCatalogPatchVersion() > versionBefore);

  const patches = getVariantPatches();
  assert.equal(patches.length, 2); // 'a' coalesced
  const a = patches.find((p) => p.id === 'a');
  assert.equal(a?.fields.Title, 'one'); // earlier fields survive coalescing
  assert.equal(a?.fields.Price, 2);
  assert.equal(typeof a?.fields.UpdatedAt, 'string'); // stamped when missing
  const b = patches.find((p) => p.id === 'b');
  assert.equal(b?.fields.UpdatedAt, iso(T0)); // explicit stamp preserved

  drainCatalogPatches(Date.now() + 1);
  assert.equal(getVariantPatches().length, 0);
  unsubscribe();
});

test('store: applyLevelPatch requires an id or a match, and drain clears levels', () => {
  applyLevelPatch(null, { Quantity: 1 }); // dropped: nothing to target
  assert.equal(getLevelPatches().length, 0);

  applyLevelPatch('l1', { Quantity: 2 });
  applyLevelPatch(null, { Quantity: 3 }, { productVariantId: 'v1' });
  assert.equal(getLevelPatches().length, 2);

  drainCatalogPatches(Date.now() + 1);
  assert.equal(getLevelPatches().length, 0);
});

test('store: drain only removes patches at or before the cutoff', () => {
  applyVariantPatch('old', { Title: 'old' });
  const cutoff = Date.now();
  // Force the next patch strictly after the cutoff.
  const realNow = Date.now;
  try {
    (Date as any).now = () => cutoff + 50;
    applyVariantPatch('new', { Title: 'new' });
  } finally {
    (Date as any).now = realNow;
  }
  drainCatalogPatches(cutoff);
  const remaining = getVariantPatches().map((p) => p.id);
  assert.deepEqual(remaining, ['new']);
});

test('store: unsubscribed listeners stop firing; stale marks carry their reason', () => {
  let patchCount = 0;
  const off = subscribeCatalogPatches(() => { patchCount += 1; });
  applyVariantPatch('a', { Title: 'x' });
  off();
  applyVariantPatch('a', { Title: 'y' });
  assert.equal(patchCount, 1);

  const reasons: string[] = [];
  const offStale = subscribeCatalogStale((reason) => reasons.push(reason));
  markCatalogStale('partnership');
  markCatalogStale('foreground');
  offStale();
  markCatalogStale('inventory');
  assert.deepEqual(reasons, ['partnership', 'foreground']);
});
