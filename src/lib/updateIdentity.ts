type ExpoUpdatesModule = {
  updateId?: string | null;
};

export function getUpdateId(
  loadUpdates: () => ExpoUpdatesModule = () => require('expo-updates') as ExpoUpdatesModule,
): string {
  try {
    const updateId = loadUpdates()?.updateId;
    return typeof updateId === 'string' && updateId.length > 0 ? updateId : 'embedded';
  } catch {
    return 'embedded';
  }
}

export function getUpdateIdFragment(
  loadUpdates: () => ExpoUpdatesModule = () => require('expo-updates') as ExpoUpdatesModule,
): string {
  const updateId = getUpdateId(loadUpdates);
  return updateId === 'embedded' ? updateId : updateId.slice(0, 8);
}

export const UPDATE_ID = getUpdateId();
export const UPDATE_ID_FRAGMENT = UPDATE_ID === 'embedded' ? UPDATE_ID : UPDATE_ID.slice(0, 8);
