export type RequirementMap = Record<string, string[]>;

const DEFAULT_REQUIREMENTS: RequirementMap = {
  shopify: ['title', 'price', 'description', 'images'],
  amazon: ['title', 'price', 'description', 'images'],
  ebay: ['title', 'price', 'description', 'images'],
  clover: ['title', 'price'],
  square: ['title', 'price'],
  facebook: ['title', 'price', 'description', 'images'],
};

export function getPlatformRequirements(overrides?: RequirementMap): RequirementMap {
  if (!overrides) return DEFAULT_REQUIREMENTS;
  return { ...DEFAULT_REQUIREMENTS, ...overrides };
}

export { DEFAULT_REQUIREMENTS };



