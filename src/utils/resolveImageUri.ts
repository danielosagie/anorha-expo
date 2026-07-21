/**
 * Return one renderable image URI from the wire shapes used by quick-scan,
 * inventory matches, eBay pricing research, and persisted drafts.
 */
const RENDERABLE_URI = /^(?:https?:\/\/|file:\/\/|content:\/\/|ph:\/\/|assets-library:\/\/|asset:\/|data:image\/|blob:)/i;

function resolveImageUriInternal(value: unknown, seen: Set<object>): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '[object Object]') return undefined;
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    // eBay's image CDN supports HTTPS. Upgrading its occasional legacy URL also
    // avoids iOS ATS rejecting an otherwise valid thumbnail.
    if (/^http:\/\/i\.ebayimg\.com\//i.test(trimmed)) {
      return trimmed.replace(/^http:/i, 'https:');
    }
    return RENDERABLE_URI.test(trimmed) ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    for (const candidate of value) {
      const uri = resolveImageUriInternal(candidate, seen);
      if (uri) return uri;
    }
    return undefined;
  }

  if (!value || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  const image: any = value;
  const candidates = [
    image.imageUrl,
    image.image_url,
    image.thumbnailUrl,
    image.thumbnail_url,
    image.thumbnail,
    image.image,
    image.imageUrls,
    image.image_urls,
    image.images,
    image.photos,
    image.uri,
    image.url,
    image.src,
  ];
  for (const candidate of candidates) {
    if (candidate === value) continue;
    const uri = resolveImageUriInternal(candidate, seen);
    if (uri) return uri;
  }
  return undefined;
}

export function resolveImageUri(value: unknown): string | undefined {
  return resolveImageUriInternal(value, new Set());
}

/** Preserve the provider payload while giving every consumer one stable field. */
export function withResolvedImageUrl<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  const imageUrl = resolveImageUri(value);
  return imageUrl ? { ...value, imageUrl } : value;
}
