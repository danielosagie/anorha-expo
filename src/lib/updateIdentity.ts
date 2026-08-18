type ExpoUpdatesModule = {
  updateId?: string | null;
};

export function getUpdateIdFragment(
  loadUpdates: () => ExpoUpdatesModule = () => require('expo-updates') as ExpoUpdatesModule,
): string {
  try {
    const updateId = loadUpdates()?.updateId;
    return typeof updateId === 'string' && updateId.length > 0
      ? updateId.slice(0, 8)
      : 'embedded';
  } catch {
    return 'embedded';
  }
}

export const UPDATE_ID_FRAGMENT = getUpdateIdFragment();
