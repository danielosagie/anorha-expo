import test from 'node:test';
import assert from 'node:assert/strict';

import { billingCheckoutFeedback, decideBillingBrowserOutcome } from '../src/lib/billingCheckoutOutcome.ts';
import { decideDismissedImportOutcome } from '../src/lib/dismissedImportOutcome.ts';
import {
  connectionImportPresentationsById,
} from '../src/lib/connectionImportPresentation.ts';
import {
  countProvenPublishSuccesses,
  decidePublishStart,
  publishOutcomeClaim,
  reconcilePublishOutcomes,
} from '../src/lib/publishOutcomes.ts';
import { decideReconnectVerification } from '../src/lib/reconnectVerification.ts';
import {
  decideReviewQueueCompletion,
  reconcileVerifiedAttentionCount,
} from '../src/lib/reviewQueueTruth.ts';

test('verified zero clears aggregate review and presentation review while reauth still wins', () => {
  const reconciled = reconcileVerifiedAttentionCount({
    connectionId: 'square-1',
    state: 'needs-attention',
    needsAttention: 4,
  }, 0);
  assert.equal(reconciled.state, 'active', `expected aggregate state=active, got ${reconciled.state}`);
  assert.equal(reconciled.needsAttention, 0, `expected needsAttention=0, got ${reconciled.needsAttention}`);
  assert.equal(reconciled.attentionVerified, true, `expected attentionVerified=true, got ${reconciled.attentionVerified}`);

  const healthy = connectionImportPresentationsById({
    connections: [{ Id: 'square-1', IsEnabled: true, Status: 'review', SyncState: 'needs-attention' }],
    aggregateConnections: [reconciled],
  }).get('square-1');
  assert.equal(healthy?.kind, 'synced', `expected verified-zero presentation kind=synced, got ${healthy?.kind}`);
  assert.notEqual(healthy?.label, 'Needs review', `expected label not=Needs review, got ${healthy?.label}`);

  const needsReauth = connectionImportPresentationsById({
    connections: [{ Id: 'square-1', IsEnabled: true, Status: 'review', SyncState: 'needs-attention', NeedsReauth: true }],
    aggregateConnections: [reconciled],
  }).get('square-1');
  assert.equal(needsReauth?.requiresReconnect, true, `expected requiresReconnect=true, got ${needsReauth?.requiresReconnect}`);
  assert.equal(needsReauth?.label, 'Needs attention', `expected reauth label=Needs attention, got ${needsReauth?.label}`);
});

test('review receipt waits for zero plus both shared refreshes', () => {
  const verified = decideReviewQueueCompletion({
    remainingQuestionCount: 0,
    inboxSummaryRefreshed: true,
    connectionsRefreshed: true,
  });
  assert.equal(verified, 'receipt', `expected fully refreshed review verdict=receipt, got ${verified}`);

  const missingConnectionRefresh = decideReviewQueueCompletion({
    remainingQuestionCount: 0,
    inboxSummaryRefreshed: true,
    connectionsRefreshed: false,
  });
  assert.equal(missingConnectionRefresh, 'could_not_verify', `expected incomplete refresh verdict=could_not_verify, got ${missingConnectionRefresh}`);
});

test('publish response omission is unknown and never a proven success', () => {
  const outcomes = reconcilePublishOutcomes(['shopify', 'ebay'], [
    { platform: 'shopify', success: true },
  ]);
  assert.equal(outcomes.shopify?.status, 'success', `expected shopify status=success, got ${outcomes.shopify?.status}`);
  assert.equal(outcomes.ebay?.status, 'confirmation_unknown', `expected ebay status=confirmation_unknown, got ${outcomes.ebay?.status}`);
  assert.notEqual(outcomes.ebay?.status, 'success', `expected ebay status not=success, got ${outcomes.ebay?.status}`);
  const ebayClaim = publishOutcomeClaim(outcomes.ebay, 'eBay');
  assert.equal(ebayClaim.canClaimLive, false, `expected ebay canClaimLive=false, got ${ebayClaim.canClaimLive}`);
  assert.equal(ebayClaim.label, "Couldn't confirm - check eBay", `expected ebay label=Couldn't confirm - check eBay, got ${ebayClaim.label}`);
  assert.equal(countProvenPublishSuccesses(['shopify', 'ebay'], outcomes), 1, `expected proven success count=1, got ${countProvenPublishSuccesses(['shopify', 'ebay'], outcomes)}`);
});

test('2xx response with no results confirms zero requested platforms', () => {
  const outcomes = reconcilePublishOutcomes(['shopify', 'ebay'], []);
  assert.equal(outcomes.shopify?.status, 'confirmation_unknown', `expected shopify status=confirmation_unknown, got ${outcomes.shopify?.status}`);
  assert.equal(outcomes.ebay?.status, 'confirmation_unknown', `expected ebay status=confirmation_unknown, got ${outcomes.ebay?.status}`);
  assert.equal(countProvenPublishSuccesses(['shopify', 'ebay'], outcomes), 0, `expected proven success count=0, got ${countProvenPublishSuccesses(['shopify', 'ebay'], outcomes)}`);
});

test('missing publish payload starts in error rather than done', () => {
  const actual = decidePublishStart(false);
  assert.equal(actual, 'error', `expected missing-payload phase=error, got ${actual}`);
  assert.notEqual(actual, 'done', `expected missing-payload phase not=done, got ${actual}`);
});

test('cancelled or dismissed checkout never enters fulfillment polling', () => {
  for (const type of ['cancel', 'dismiss']) {
    const actual = decideBillingBrowserOutcome({ type });
    assert.equal(actual.kind, 'cancelled', `expected ${type} outcome=cancelled, got ${actual.kind}`);
    assert.equal(actual.shouldPoll, false, `expected ${type} shouldPoll=false, got ${actual.shouldPoll}`);
  }
});

test('unrecognized checkout return is unverifiable, never payment confirmation', () => {
  const actual = decideBillingBrowserOutcome({ type: 'opened' });
  assert.equal(actual.kind, 'could_not_verify', `expected browser outcome=could_not_verify, got ${actual.kind}`);
  assert.equal(actual.shouldPoll, false, `expected unverifiable shouldPoll=false, got ${actual.shouldPoll}`);
  assert.notEqual(actual.kind, 'returned', `expected unverifiable outcome not=returned, got ${actual.kind}`);
  const feedback = billingCheckoutFeedback(actual.kind);
  assert.equal(feedback.message, 'Couldn’t verify payment.', `expected feedback=Couldn’t verify payment., got ${feedback.message}`);
  assert.notEqual(feedback.message, 'Payment received.', `expected feedback not=Payment received., got ${feedback.message}`);
  assert.equal(feedback.action, 'recheck', `expected feedback action=recheck, got ${feedback.action}`);
});

test('reconnect with uncleared NeedsReauth cannot show All set', () => {
  const actual = decideReconnectVerification({
    refreshSucceeded: true,
    connection: { IsEnabled: true, Status: 'active', SyncState: 'live', NeedsReauth: true },
  });
  assert.equal(actual, 'could_not_verify', `expected reconnect verdict=could_not_verify, got ${actual}`);
  assert.notEqual(actual, 'verified', `expected reconnect verdict not=verified, got ${actual}`);
});

test('failed dismissed import produces one named failure toast with Retry', () => {
  const actual = decideDismissedImportOutcome({
    platformLabel: 'Shopify',
    startedAt: 1_000,
    connectionStatus: 'error',
    connectionUpdatedAt: new Date(1_500).toISOString(),
    observedActive: true,
    now: 2_000,
  });
  assert.equal(actual.kind, 'failure', `expected dismissed-import outcome=failure, got ${actual.kind}`);
  assert.equal(actual.kind === 'failure' ? actual.toastTitle : '', 'Shopify import stopped', `expected toast title=Shopify import stopped, got ${actual.kind === 'failure' ? actual.toastTitle : ''}`);
  assert.equal(actual.kind === 'failure' ? actual.actionLabel : '', 'Retry', `expected toast action=Retry, got ${actual.kind === 'failure' ? actual.actionLabel : ''}`);
});
