import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

// Durable store for a captured-but-not-yet-transcribed voice note. The recorder
// writes to the (volatile) cache dir; we copy the finished file into the
// document dir and drop a marker in AsyncStorage. If the app crashes between
// recording and transcription, the audio survives and we resume on next launch.

const KEY = 'sprout.pendingVoice.v1';
const DIR = `${FileSystem.documentDirectory}voice/`;

export type PendingVoice = { uri: string; createdAt: number };

const ensureDir = async () => {
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  } catch {
    /* ignore */
  }
};

/** Copy the recorder's file into persistent storage and record a marker. */
export const persistPendingVoice = async (sourceUri: string): Promise<PendingVoice | null> => {
  try {
    await ensureDir();
    // Only one pending note at a time — clear any stale prior file first.
    const prior = await readMarker();
    if (prior) await deleteFile(prior.uri);

    const dest = `${DIR}voice-${Date.now()}.m4a`;
    await FileSystem.copyAsync({ from: sourceUri, to: dest });
    const pending: PendingVoice = { uri: dest, createdAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(pending));
    return pending;
  } catch {
    return null;
  }
};

const readMarker = async (): Promise<PendingVoice | null> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingVoice) : null;
  } catch {
    return null;
  }
};

/** The pending note, but only if its audio file still exists on disk. */
export const getPendingVoice = async (): Promise<PendingVoice | null> => {
  const marker = await readMarker();
  if (!marker) return null;
  try {
    const info = await FileSystem.getInfoAsync(marker.uri);
    if (!info.exists) {
      await AsyncStorage.removeItem(KEY);
      return null;
    }
    return marker;
  } catch {
    return null;
  }
};

const deleteFile = async (uri: string) => {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* ignore */
  }
};

/** Remove the marker and (optionally) its audio file — call after a success. */
export const clearPendingVoice = async (uri?: string): Promise<void> => {
  if (uri) await deleteFile(uri);
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
