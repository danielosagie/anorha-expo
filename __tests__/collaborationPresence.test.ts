import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  excludeSelfFromPresence,
  isOtherUserEditEvent,
} from '../src/lib/collaborationPresence.ts';

test('presence and edit events exclude the current app user', () => {
  const users = [
    { userId: 'app-user-current', userName: 'Me', status: 'online' as const },
    { userId: 'app-user-teammate', userName: 'Teammate', status: 'online' as const },
  ];

  assert.deepEqual(
    excludeSelfFromPresence(users, 'app-user-current').map((user) => user.userId),
    ['app-user-teammate'],
  );
  assert.equal(isOtherUserEditEvent(users[0], 'app-user-current'), false);
  assert.equal(isOtherUserEditEvent(users[1], 'app-user-current'), true);
});

test('the read-only product overview does not announce an edit lock', () => {
  const source = readFileSync(
    '/Users/dosagie/Documents/CodeProjects/sssync_mobile_test/src/screens/ProductDetail.tsx',
    'utf8',
  );
  assert.match(source, /if \(mode === 'edit'\) \{\s*collaboration\.startEditing/);
});
