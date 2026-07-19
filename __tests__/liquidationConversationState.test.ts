import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { ConversationMessage } from '../src/features/liquidationConversation/types';

const require = createRequire(import.meta.url);
const {
  acknowledgeMessage,
  createEmptyThreadState,
  createTextMessage,
  enqueueTurn,
  failTurn,
  mergeRemoteMessages,
  retryFailedTurn,
  toQueueItem,
} = require('../src/features/liquidationConversation/conversationState.ts');

const campaignId = 'campaign-1';
const threadId = 'thread-1';

const createQueuedTextState = (clientMessageId: string, content: string) => {
  const state = createEmptyThreadState(campaignId, threadId);
  const message = createTextMessage({
    campaignId,
    threadId,
    clientMessageId,
    role: 'user',
    content,
    deliveryState: 'queued',
  });
  const queueItem = toQueueItem({
    campaignId,
    threadId,
    clientMessageId,
    kind: 'message',
    content,
  });
  return enqueueTurn(state, queueItem, message);
};

test('first send from home creates queued user message and pending turn', () => {
  const state = createQueuedTextState('msg-1', 'Start liquidation chat');
  assert.equal(state.messages.length, 1);
  assert.equal(state.pendingQueue.length, 1);
  assert.equal(state.messages[0].content, 'Start liquidation chat');
  assert.equal(state.messages[0].deliveryState, 'queued');
});

test('queued sends during streaming keep both pending turns in order', () => {
  const first = createQueuedTextState('msg-1', 'First');
  const secondMessage = createTextMessage({
    campaignId,
    threadId,
    clientMessageId: 'msg-2',
    role: 'user',
    content: 'Second',
    deliveryState: 'queued',
  });
  const secondQueue = toQueueItem({
    campaignId,
    threadId,
    clientMessageId: 'msg-2',
    kind: 'message',
    content: 'Second',
  });

  const next = enqueueTurn(first, secondQueue, secondMessage);
  assert.deepEqual(next.pendingQueue.map((item: any) => item.clientMessageId), ['msg-1', 'msg-2']);
  assert.deepEqual(next.messages.map((item: any) => item.content), ['First', 'Second']);
});

test('retryFailedTurn re-queues a failed message', () => {
  const state = createQueuedTextState('msg-1', 'Need retry');
  const failed = failTurn(state, 'msg-1', 'Network failed');
  const retried = retryFailedTurn(failed, 'msg-1');

  assert.equal(retried.messages[0].deliveryState, 'queued');
  assert.equal(retried.pendingQueue.length, 1);
  assert.equal(retried.pendingQueue[0].clientMessageId, 'msg-1');
});

test('retryFailedTurn keeps uploaded photos on the retried turn', () => {
  const state = createEmptyThreadState(campaignId, threadId);
  const imageUrls = ['https://cdn.example/item-1.jpg', 'https://cdn.example/item-2.jpg'];
  const message = createTextMessage({
    campaignId,
    threadId,
    clientMessageId: 'msg-photo',
    role: 'user',
    content: 'List these',
    deliveryState: 'queued',
    imageUrls,
  });
  const queued = enqueueTurn(
    state,
    toQueueItem({
      campaignId,
      threadId,
      clientMessageId: 'msg-photo',
      kind: 'message',
      content: 'List these',
      imageUrls,
    }),
    message,
  );

  const retried = retryFailedTurn(failTurn(queued, 'msg-photo', 'Network failed'), 'msg-photo');

  assert.deepEqual(retried.pendingQueue[0].imageUrls, imageUrls);
});

test('mergeRemoteMessages keeps unsent local messages while hydrating remote history', () => {
  const localState = createQueuedTextState('msg-local', 'Local only');
  const remoteMessage: ConversationMessage = {
    id: 'server-1',
    serverMessageId: 'server-1',
    campaignId,
    threadId,
    role: 'assistant',
    content: 'Remote response',
    createdAt: new Date().toISOString(),
    deliveryState: 'sent',
    kind: 'text',
  };

  const merged = mergeRemoteMessages(localState.messages, [remoteMessage]);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((message: any) => message.id === 'msg-local'));
  assert.ok(merged.some((message: any) => message.id === 'server-1'));
});

test('acknowledgeMessage reconciles optimistic user bubble with server id', () => {
  const state = createQueuedTextState('msg-1', 'Ack me');
  const acked = acknowledgeMessage(state, 'msg-1', 'server-123');

  assert.equal(acked.messages[0].deliveryState, 'sent');
  assert.equal(acked.messages[0].serverMessageId, 'server-123');
});
