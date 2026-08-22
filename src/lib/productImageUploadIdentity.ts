const APP_USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function assertCanonicalAppUserId(userId: string): string {
  const normalized = userId.trim();
  if (!APP_USER_UUID.test(normalized)) {
    throw new Error('Authenticated session has no canonical app-user UUID');
  }
  return normalized;
}

export function buildProductImageObjectPath(
  appUserId: string,
  photoId: string,
  timestamp: number,
): string {
  return `${assertCanonicalAppUserId(appUserId)}/${safePathSegment(photoId)}-${timestamp}.jpg`;
}
