import { supabase } from '../../lib/supabase';

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






