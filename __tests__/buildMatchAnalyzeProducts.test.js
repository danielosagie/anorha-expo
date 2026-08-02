const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMatchAnalyzeProducts } = require('../src/utils/buildMatchAnalyzeProducts');

test('buildMatchAnalyzeProducts includes quickMatchHint only for items with stored quick-scan selections', () => {
  const products = buildMatchAnalyzeProducts(
    ['https://img/one.jpg', 'https://img/two.jpg'],
    [{ id: 'item-1' }, { id: 'item-2' }],
    {
      'item-1': {
        matchRows: [
          { title: 'Wrong one', link: 'https://listing/wrong' },
          { title: 'Correct one', link: 'https://listing/correct' },
        ],
        preSelectedIndices: [1],
        source: 'quick_scan_confirmed',
        confidence: 0.94,
        reasoning: 'User confirmed the exact listing.',
      },
    },
  );

  assert.equal(products.length, 2);
  assert.deepEqual(products[0].quickMatchHint, {
    source: 'quick_scan_confirmed',
    selectedIndex: 1,
    candidates: [
      { title: 'Wrong one', link: 'https://listing/wrong' },
      { title: 'Correct one', link: 'https://listing/correct' },
    ],
    confidence: 0.94,
    reasoning: 'User confirmed the exact listing.',
  });
  assert.equal(products[1].quickMatchHint, undefined);
});
