export interface CollaborationUserIdentity {
  userId: string;
}

export function excludeSelfFromPresence<T extends CollaborationUserIdentity>(
  users: readonly T[],
  currentAppUserId: string | null | undefined,
): T[] {
  if (!currentAppUserId) return [...users];
  return users.filter((user) => user.userId !== currentAppUserId);
}

export function isOtherUserEditEvent(
  event: CollaborationUserIdentity,
  currentAppUserId: string | null | undefined,
): boolean {
  return !currentAppUserId || event.userId !== currentAppUserId;
}
