const LEGACY_PACING_LABEL = /\b(?:conservative|balanced|aggressive)\b/i;

/** Rewrite cached copy authored before pacing moved to the campaign sell-by date. */
export function rewriteLegacyPacingCopy(value: string): string {
  if (!value || (!LEGACY_PACING_LABEL.test(value) && !/\baggressiveness\b|\bpacing mode\b/i.test(value))) {
    return value;
  }

  return value
    .replace(
      /\b(?:aggressiveness|pacing mode)\s*:\s*(?:conservative|balanced|aggressive)\b/gi,
      'Pacing: paced toward the sell-by date',
    )
    .replace(
      /\b(?:an?\s+)?(?:conservative|balanced|aggressive)\s+(?:sell-off|pacing|pace|pricing|strategy|approach|mode|tier)\b/gi,
      'sell-by-date pacing',
    )
    .replace(
      /\b(?:per-item\s+)?aggressiveness(?:\s+(?:setting|schedule|level|mode))?\b/gi,
      'sell-by-date pacing',
    )
    .replace(/\bpacing mode\b/gi, 'sell-by-date pacing')
    .replace(/\b(?:conservative|balanced|aggressive)\b/gi, 'deadline-based')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1');
}
