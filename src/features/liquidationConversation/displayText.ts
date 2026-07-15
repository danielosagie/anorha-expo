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

export function compactDisplayText(
  value: string | null | undefined,
  options: { maxChars?: number; maxSentences?: number } = {},
): string {
  const maxChars = options.maxChars ?? 280;
  const maxSentences = options.maxSentences ?? 2;
  const clean = sanitizeDisplayText(value).replace(/[ \t]+/g, ' ');
  if (!clean) return '';

  // Keep authored Markdown lists intact. Truncating them mid-row is harder to read
  // than the original, so these only receive the punctuation cleanup above.
  if (/^\s*[-*]\s+/m.test(clean) || /\|[^\n]+\|/m.test(clean)) return clean;

  const sentences = clean.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [clean];
  let result = sentences.slice(0, maxSentences).join(' ').replace(/\s+/g, ' ').trim();
  if (result.length <= maxChars) return result;

  const clipped = result.slice(0, Math.max(1, maxChars - 1));
  const wordBoundary = clipped.lastIndexOf(' ');
  result = (wordBoundary > maxChars * 0.65 ? clipped.slice(0, wordBoundary) : clipped).trim();
  return `${result.replace(/[,:;.!?]+$/, '')}…`;
}
