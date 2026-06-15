import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from './logger';
const log = createLogger('billingGatePersistence');


const BILLING_GATE_PENDING_KEY = 'sssync_billing_gate_pending_v1';

export interface PersistedCapturedPhoto {
  id: string;
  uri: string;
  width: number;
  height: number;
  timestamp: number;
  isCover: boolean;
}

export interface PendingBillingAction {
  type: 'quick_scan';
  featureKey: string;
  itemId: string;
  photo: PersistedCapturedPhoto;
  createdAt: number;
}

export async function loadPendingBillingAction(): Promise<PendingBillingAction | null> {
  try {
    const raw = await AsyncStorage.getItem(BILLING_GATE_PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    log.warn('[billingGatePersistence] Failed to load pending billing action:', error);
    return null;
  }
}

export async function savePendingBillingAction(action: PendingBillingAction): Promise<void> {
  try {
    await AsyncStorage.setItem(BILLING_GATE_PENDING_KEY, JSON.stringify(action));
  } catch (error) {
    log.warn('[billingGatePersistence] Failed to save pending billing action:', error);
  }
}

export async function clearPendingBillingAction(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BILLING_GATE_PENDING_KEY);
  } catch (error) {
    log.warn('[billingGatePersistence] Failed to clear pending billing action:', error);
  }
}
