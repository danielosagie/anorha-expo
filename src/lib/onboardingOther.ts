// One rule for every "Other" answer in onboarding.
//
// Five steps offer an Other option. Three of them revealed a text field and two
// (What do you sell, Where'd you hear about us) silently swallowed the choice,
// so the seller picked Other and had nowhere to say what they meant. The reveal
// condition and the submitted value now live here, once, and every step reads
// them.

export const OTHER_ID = 'other';

/** True when the step should reveal its "please specify" field. */
export function showsOtherField(selection: string | string[]): boolean {
  return Array.isArray(selection)
    ? selection.includes(OTHER_ID)
    : selection === OTHER_ID;
}

/**
 * What actually gets stored for one answer. Typed text wins; blank text keeps
 * the literal 'other' so a skipped optional field still records that the seller
 * chose Other rather than dropping the answer entirely.
 */
export function resolveOtherValue(id: string, customText: string): string {
  if (id !== OTHER_ID) return id;
  return customText.trim() || OTHER_ID;
}

/** Multi-select form of resolveOtherValue. */
export function resolveOtherList(ids: string[], customText: string): string[] {
  return ids.map((id) => resolveOtherValue(id, customText)).filter(Boolean);
}
