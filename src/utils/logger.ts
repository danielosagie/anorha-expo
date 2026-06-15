import { supabase } from '../../lib/supabase';
import { ENV } from '../config/env';

type LogLevel = 'info' | 'error' | 'warning' | 'success';

async function writeLog(level: LogLevel, eventType: string, message: string, details?: any, entity?: { type?: string; id?: string }, platformConnectionId?: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('ActivityLogs').insert({
      UserId: user?.id ?? null,
      PlatformConnectionId: platformConnectionId ?? null,
      EntityType: entity?.type ?? null,
      EntityId: entity?.id ?? null,
      EventType: eventType,
      Status: level,
      Message: message,
      Details: details ?? null,
    });
  } catch (e) {
    // Last-resort fallback
    console.warn('[logger] Failed to write ActivityLogs:', e, { level, eventType, message });
  }
}

export async function logError(eventType: string, message: string, details?: any, entity?: { type?: string; id?: string }, platformConnectionId?: string) {
  return writeLog('error', eventType, message, details, entity, platformConnectionId);
}

export async function logInfo(eventType: string, message: string, details?: any, entity?: { type?: string; id?: string }, platformConnectionId?: string) {
  return writeLog('info', eventType, message, details, entity, platformConnectionId);
}

// ───────────────────────── Console facade ─────────────────────────
// Levelled replacement for bare `console.*` (the `no-console` lint rule points
// here). In development everything prints; in release `debug`/`info` are dropped
// so the ~1,000 diagnostic lines — and any tokens/PII in them — don't ship.
// Scope per module: `const log = createLogger('PlatformConnections')`.

type ConsoleLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<ConsoleLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_CONSOLE_LEVEL = ENV.isDev ? LEVEL_ORDER.debug : LEVEL_ORDER.warn;

function emitConsole(level: ConsoleLevel, scope: string | undefined, args: unknown[]): void {
  if (LEVEL_ORDER[level] < MIN_CONSOLE_LEVEL) return;
  const sink = (console[level] as ((...a: unknown[]) => void) | undefined) ?? console.log;
  if (scope) sink(`[${scope}]`, ...args);
  else sink(...args);
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(scope?: string): Logger {
  return {
    debug: (...args) => emitConsole('debug', scope, args),
    info: (...args) => emitConsole('info', scope, args),
    warn: (...args) => emitConsole('warn', scope, args),
    error: (...args) => emitConsole('error', scope, args),
  };
}

/** Unscoped default console-facade logger. */
export const logger = createLogger();






