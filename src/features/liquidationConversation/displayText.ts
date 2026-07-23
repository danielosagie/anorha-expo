/**
 * Normalize agent-authored copy before it reaches the UI.
 *
 * Model output is intentionally treated as untrusted presentation text. The product
 * voice never uses long dashes, and compact surfaces should not inherit essay-length
 * prose from a tool response.
 */
export function sanitizeDisplayText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/[—–]/g, '-')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export const HERO_BODY_MAX_CHARS = 110;

/** Keep compact hero copy complete when stale servers exceed the body contract. */
export function compactHeroBodyText(value: string | null | undefined): string {
  const clean = sanitizeDisplayText(value).replace(/\s+/g, ' ');
  if (!clean || clean.length <= HERO_BODY_MAX_CHARS) return clean;

  const withinBudget = clean.slice(0, HERO_BODY_MAX_CHARS);
  let lastSentenceEnd = -1;
  for (const match of withinBudget.matchAll(/[.!?](?=\s|$)/g)) {
    const end = (match.index ?? -1) + match[0].length;
    const tokenStart = withinBudget.lastIndexOf(' ', end - 2) + 1;
    const token = withinBudget.slice(tokenStart, end);
    if (/^\d+[.)]$/.test(token)) continue;
    lastSentenceEnd = end;
  }
  for (const match of withinBudget.matchAll(/\s+(?=(?:[-*]|\d+[.)])\s)/g)) {
    lastSentenceEnd = Math.max(lastSentenceEnd, match.index ?? -1);
  }
  if (lastSentenceEnd > 0) return withinBudget.slice(0, lastSentenceEnd).trim();

  const clipped = clean.slice(0, HERO_BODY_MAX_CHARS - 1);
  const wordBoundary = clipped.lastIndexOf(' ');
  const result = (wordBoundary > HERO_BODY_MAX_CHARS * 0.65 ? clipped.slice(0, wordBoundary) : clipped).trim();
  return `${result.replace(/[,:;.!?]+$/, '')}…`;
}

export function compactDisplayText(
  value: string | null | undefined,
  options: { maxChars?: number; maxSentences?: number; preserveStructuredText?: boolean } = {},
): string {
  const maxChars = options.maxChars ?? 280;
  const maxSentences = options.maxSentences ?? 2;
  const clean = sanitizeDisplayText(value).replace(/[ \t]+/g, ' ');
  if (!clean) return '';

  // Keep authored Markdown lists intact. Truncating them mid-row is harder to read
  // than the original, so these only receive the punctuation cleanup above.
  if (options.preserveStructuredText !== false && (/^\s*[-*]\s+/m.test(clean) || /\|[^\n]+\|/m.test(clean))) {
    return clean;
  }

  const sentences = clean.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [clean];
  let result = sentences.slice(0, maxSentences).join(' ').replace(/\s+/g, ' ').trim();
  if (result.length <= maxChars) return result;

  const clipped = result.slice(0, Math.max(1, maxChars - 1));
  const wordBoundary = clipped.lastIndexOf(' ');
  result = (wordBoundary > maxChars * 0.65 ? clipped.slice(0, wordBoundary) : clipped).trim();
  return `${result.replace(/[,:;.!?]+$/, '')}…`;
}
