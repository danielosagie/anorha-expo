import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  rewriteLegacyPacingCopy,
} = require('../src/features/liquidationConversation/legacyPacingCopy.ts');

const LEGACY_PACING_WORDS = /\b(?:conservative|balanced|aggressive|aggressiveness)\b/i;

test('cached pacing labels are rewritten around the sell-by date', () => {
  const examples = [
    'Aggressiveness: balanced',
    'Use an aggressive pricing approach',
    'Per-item aggressiveness schedule',
    'Conservative sell-off pacing',
    'Pacing mode: aggressive',
  ];

  for (const example of examples) {
    const displayed = rewriteLegacyPacingCopy(example);
    assert.doesNotMatch(displayed, LEGACY_PACING_WORDS);
    assert.match(displayed, /sell-by|deadline/i);
  }
});

test('all cached plan fields are safe after presentation rewriting', () => {
  const cachedPlanText = [
    'Balanced campaign plan',
    'Use aggressive pacing near the deadline.',
    'Aggressive launch pricing',
    'Vintage lamp at $45 using conservative sell-off pacing',
  ];

  const displayed = cachedPlanText.map(rewriteLegacyPacingCopy);

  assert.doesNotMatch(JSON.stringify(displayed), LEGACY_PACING_WORDS);
  assert.ok(displayed.every((value: string) => /sell-by|deadline/i.test(value)));
});
