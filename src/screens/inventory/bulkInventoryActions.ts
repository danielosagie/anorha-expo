export const normalizeTagList = (tags: unknown): string[] => {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
};

export const mergeTagIntoList = (tags: unknown, rawTag: string): string[] => {
  const tag = rawTag.trim();
  const currentTags = normalizeTagList(tags);
  if (!tag) return currentTags;
  return Array.from(new Set([...currentTags, tag]));
};
