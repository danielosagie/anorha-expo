/**
 * Mobile flow logger: sessionId + traceId for correlating scan→analysis and barcode lifecycle.
 * Events are sent to PostHog and can be filtered by sessionId/traceId for debugging.
 */

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { capture } from './analytics';

const SESSION_KEY = '@anorha_flow_session_id';

let sessionId: string | null = null;
let traceId: string | null = null;

function generateId(): string {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function ensureSessionId(): Promise<string> {
  if (sessionId) return sessionId;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const stored = await AsyncStorage.getItem(SESSION_KEY);
    if (stored) {
      sessionId = stored;
      return sessionId;
    }
  } catch {
    // ignore
  }
  const id = generateId();
  sessionId = id;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(SESSION_KEY, id);
  } catch {
    // ignore
  }
  return id;
}

/**
 * Call once at app startup to ensure sessionId is ready.
 */
export async function init(): Promise<void> {
  await ensureSessionId();
}

/**
 * Start a new trace for a flow (e.g. one scan→analysis attempt). Returns the traceId.
 */
export function startTrace(): string {
  traceId = generateId();
  return traceId;
}

export function getSessionId(): string | null {
  return sessionId;
}

export function getTraceId(): string | null {
  return traceId;
}

/**
 * Headers to attach to API requests for backend correlation.
 */
export async function getTraceHeaders(): Promise<Record<string, string>> {
  const sid = await ensureSessionId();
  const tid = traceId ?? generateId();
  if (!traceId) traceId = tid;
  return {
    'x-client-session-id': sid,
    'x-client-trace-id': tid,
  };
}

/** Flow event names */
export const FlowEvents = {
  SCAN_ANALYSIS_STARTED: 'mobile_flow_scan_analysis_started',
  SCAN_ANALYSIS_COMPLETED: 'mobile_flow_scan_analysis_completed',
  SCAN_ANALYSIS_FAILED: 'mobile_flow_scan_analysis_failed',
  BARCODE_SCANNER_OPENED: 'mobile_flow_barcode_scanner_opened',
  BARCODE_SCANNER_CLOSED: 'mobile_flow_barcode_scanner_closed',
  BARCODE_SCAN_COMPLETED: 'mobile_flow_barcode_scan_completed',
  BARCODE_SCAN_FAILED: 'mobile_flow_barcode_scan_failed',
} as const;

export type FlowEventName = (typeof FlowEvents)[keyof typeof FlowEvents];

/**
 * Log a flow event to PostHog. sessionId and traceId are added automatically.
 */
export function logFlowEvent(
  eventName: FlowEventName | string,
  props?: Record<string, unknown>
): void {
  const base = {
    ...(sessionId ? { sessionId } : {}),
    ...(traceId ? { traceId } : {}),
    platform: Platform.OS,
    ...props,
  };
  capture(eventName, base);
}
