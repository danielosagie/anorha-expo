export const CONDITION_GRADES = [
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like new' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'parts', label: 'Parts' },
] as const;

export type ConditionGrade = (typeof CONDITION_GRADES)[number]['value'];
export type TestedStatus = 'tested' | 'untested';

export const TESTED_STATUSES = [
  { value: 'tested', label: 'Tested' },
  { value: 'untested', label: 'Untested' },
] as const satisfies ReadonlyArray<{ value: TestedStatus; label: string }>;

// Receipt: Track 2 V1 owner-approved powered families, copied without widening scope.
export const POWERED_EQUIPMENT_FAMILY_KEYWORDS = [
  'medical',
  'electronic',
  'appliance',
  'tool',
  'audio',
  'computer',
  'phone',
  'camera',
] as const;

export interface ConditionSelection {
  conditionGrade?: ConditionGrade;
  testedStatus?: TestedStatus;
}

export interface ConditionDraftPatch extends ConditionSelection {
  /** Free-text canonical commerce.Condition persisted on the scan draft. */
  condition?: string;
}

const normalizeWords = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const tokenMatchesPoweredFamily = (
  token: string,
  keyword: (typeof POWERED_EQUIPMENT_FAMILY_KEYWORDS)[number],
): boolean => {
  if (keyword === 'phone') return token.includes('phone');
  if (keyword === 'tool') return token === 'tool' || token === 'tools';
  return token === keyword || token === `${keyword}s` || token.startsWith(keyword);
};

export function isPoweredEquipment(input: { productType?: string | null; title?: string | null }): boolean {
  const words = normalizeWords(`${input.productType ?? ''} ${input.title ?? ''}`);
  return POWERED_EQUIPMENT_FAMILY_KEYWORDS.some((keyword) =>
    words.some((word) => tokenMatchesPoweredFamily(word, keyword)),
  );
}

export function conditionGradeLabel(grade?: ConditionGrade): string | undefined {
  return CONDITION_GRADES.find((option) => option.value === grade)?.label;
}

export function conditionGradeFromCommerceCondition(condition?: string | null): ConditionGrade | undefined {
  const gradeText = String(condition ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (gradeText === 'for_parts') return 'parts';
  return CONDITION_GRADES.some((option) => option.value === gradeText)
    ? gradeText as ConditionGrade
    : undefined;
}

export function buildCommerceCondition(selection: ConditionSelection): string | undefined {
  const grade = conditionGradeLabel(selection.conditionGrade);
  const tested = selection.testedStatus;
  if (!grade && !tested) return undefined;
  if (!grade) return tested === 'tested' ? 'Tested' : 'Untested';
  return tested ? `${grade}, ${tested}` : grade;
}

export function buildConditionDraftPatch(selection: ConditionSelection): ConditionDraftPatch {
  return {
    conditionGrade: selection.conditionGrade,
    testedStatus: selection.testedStatus,
    condition: buildCommerceCondition(selection),
  };
}
