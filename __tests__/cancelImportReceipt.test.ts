import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alreadyTerminalCancelCopy,
  parseCancelImportReceipt,
} from '../src/lib/cancelImportReceipt.ts';

test('cancel receipt parses the backend response', () => {
  assert.deepEqual(parseCancelImportReceipt({
    importId: 'import-1',
    status: 'canceled',
    itemsCommitted: 5,
    itemsSkipped: 3,
    alreadyTerminal: false,
  }), {
    importId: 'import-1',
    status: 'canceled',
    itemsCommitted: 5,
    itemsSkipped: 3,
    alreadyTerminal: false,
  });
});

test('already-terminal copy reports the receipt instead of a cancel failure', () => {
  const copy = alreadyTerminalCancelCopy(parseCancelImportReceipt({
    importId: 'import-1',
    status: 'canceled',
    itemsCommitted: 5,
    itemsSkipped: 0,
    alreadyTerminal: true,
  }));

  assert.deepEqual(copy, {
    title: 'Import already ended',
    message: 'No changes made. 5 imported. 0 skipped.',
  });
});
