/**
 * Mobile flow logger: sessionId + traceId for correlating scan→analysis and barcode lifecycle.
 * Events are sent to PostHog and can be filtered by sessionId/traceId for debugging.
 */

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { capture } from './analytics';
import { UPDATE_ID } from './updateIdentity';

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
    const stored = await AsyncStorage.getItem(SESSION_KEY);
    if (stored) {
      sessionId = stored;
      return stored;
    }
  } catch {
    // ignore
  }
  const id = generateId();
  sessionId = id;
  try {
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

export const SessionDiagnosticEvents = {
  EXCHANGE_FAILED: 'session_exchange_failed',
  TOKEN_UNAVAILABLE: 'session_token_unavailable',
  INVALID_ESCAPE: 'session_invalid_escape',
  WATCHDOG: 'session_watchdog',
  RECONNECT_SHOWN: 'session_reconnect_shown',
  RECOVERED: 'session_recovered',
} as const;

export type SessionDiagnosticEventName =
  (typeof SessionDiagnosticEvents)[keyof typeof SessionDiagnosticEvents];

const SESSION_DIAGNOSTIC_TEXT_LIMIT = 160;

export function safeSessionDiagnosticText(value: unknown): string {
  return String(value ?? 'unknown')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_.-]+\b/g, '[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{80,}\b/g, '[redacted]')
    .slice(0, SESSION_DIAGNOSTIC_TEXT_LIMIT);
}

export function sessionErrorProperties(error: unknown): {
  status: number | string;
  errorCode: string;
  errorMessage: string;
} {
  const record = error !== null && typeof error === 'object'
    ? error as Record<string, unknown>
    : null;
  const response = record?.response !== null && typeof record?.response === 'object'
    ? record.response as Record<string, unknown>
    : null;
  const rawStatus = record?.status ?? response?.status;
  const status = typeof rawStatus === 'number'
    ? rawStatus
    : typeof rawStatus === 'string'
      ? safeSessionDiagnosticText(rawStatus)
      : 'unknown';
  const rawCode = record?.code ?? (error instanceof Error ? error.name : 'unknown');
  const rawMessage = error instanceof Error ? error.message : error;

  return {
    status,
    errorCode: safeSessionDiagnosticText(rawCode),
    errorMessage: safeSessionDiagnosticText(rawMessage),
  };
}

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

export function logSessionDiagnostic(
  eventName: SessionDiagnosticEventName,
  props?: Record<string, unknown>,
): void {
  try {
    capture(eventName, {
      platform: Platform.OS,
      updateId: UPDATE_ID,
      ...props,
    });
  } catch {
    // Session telemetry must never affect recovery.
  }
}
