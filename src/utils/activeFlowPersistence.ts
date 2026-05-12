import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStackParamList } from '../navigation/AppNavigator';

const ACTIVE_FLOW_KEY_PREFIX = 'sssync_active_loading_flow';
const CHECKPOINT_VERSION = 1;
const STALE_FLOW_MS = 1000 * 60 * 60 * 24; // 24h

export type ActiveFlowStatus =
  | 'queued'
  | 'processing'
  | 'awaiting_user_input'
  | 'completed'
  | 'failed';

export interface ActiveFlowCheckpoint {
  version: number;
  updatedAt: number;
  jobId: string;
  processType: AppStackParamList['LoadingScreen']['processType'];
  status: ActiveFlowStatus;
  currentStage?: string;
  currentProductIndex?: number;
  payload: AppStackParamList['LoadingScreen']['payload'];
  onCompleteRoute: AppStackParamList['LoadingScreen']['onCompleteRoute'];
}

const keyForUser = (userId: string) => `${ACTIVE_FLOW_KEY_PREFIX}:${userId}`;

const isValidProcessType = (
  value: any,
): value is AppStackParamList['LoadingScreen']['processType'] => {
  return value === 'match' || value === 'generate' || value === 'match-and-generate';
};

const normalizeCheckpoint = (raw: any): ActiveFlowCheckpoint | null => {
  if (!raw || typeof raw !== 'object') return null;
  if (!isValidProcessType(raw.processType)) return null;
  if (typeof raw.jobId !== 'string' || raw.jobId.trim().length === 0) return null;
  if (typeof raw.payload !== 'object' || !raw.payload) return null;
  if (typeof raw.onCompleteRoute !== 'object' || !raw.onCompleteRoute) return null;
  if (typeof raw.updatedAt !== 'number') return null;

  const rawJobId = raw.jobId;

  return {
    version: Number(raw.version) || CHECKPOINT_VERSION,
    updatedAt: raw.updatedAt,
    jobId: rawJobId,
    processType: raw.processType,
    status: (raw.status || 'processing') as ActiveFlowStatus,
    currentStage: typeof raw.currentStage === 'string' ? raw.currentStage : undefined,
    currentProductIndex: Number.isFinite(raw.currentProductIndex) ? Number(raw.currentProductIndex) : undefined,
    payload: {
      ...raw.payload,
      jobId: typeof raw.payload.jobId === 'string' ? raw.payload.jobId : rawJobId,
    },
    onCompleteRoute: raw.onCompleteRoute,
  };
};

export async function loadActiveFlowCheckpoint(userId: string): Promise<ActiveFlowCheckpoint | null> {
  if (!userId) return null;
  try {
    const stored = await AsyncStorage.getItem(keyForUser(userId));
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    const checkpoint = normalizeCheckpoint(parsed);
    if (!checkpoint) return null;

    if (Date.now() - checkpoint.updatedAt > STALE_FLOW_MS) {
      await AsyncStorage.removeItem(keyForUser(userId));
      return null;
    }

    return checkpoint;
  } catch {
    return null;
  }
}

export async function saveActiveFlowCheckpoint(
  userId: string,
  checkpoint: Omit<ActiveFlowCheckpoint, 'version' | 'updatedAt'> & { updatedAt?: number },
): Promise<void> {
  if (!userId) return;

  const payload: ActiveFlowCheckpoint = {
    ...checkpoint,
    version: CHECKPOINT_VERSION,
    updatedAt: checkpoint.updatedAt || Date.now(),
  };

  try {
    await AsyncStorage.setItem(keyForUser(userId), JSON.stringify(payload));
  } catch {
    // no-op on storage failures
  }
}

export async function clearActiveFlowCheckpoint(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(keyForUser(userId));
  } catch {
    // no-op on storage failures
  }
}
