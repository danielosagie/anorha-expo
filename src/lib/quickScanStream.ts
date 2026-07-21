import EventSource from 'react-native-sse';

export type QuickScanPhase =
  | 'inspecting_shelf'
  | 'separating_items'
  | 'reading_labels'
  | 'searching_matches'
  | 'finishing';

export type QuickScanEventType =
  | 'START_ANALYSIS'
  | 'MODE_RESOLVED'
  | 'HEARTBEAT'
  | 'EXTRACTED_ITEMS'
  | 'OPTIMIZING_QUERIES'
  | 'SEARCHING_ITEMS'
  | 'SEARCH_RESULT'
  | 'COMPLETE'
  | 'ERROR'
  | 'NO_ITEMS'
  | 'TIMEOUT';

export type QuickScanStreamEvent = {
  type: QuickScanEventType;
  phase?: QuickScanPhase;
  progress?: number;
  elapsedMs?: number;
  reasonCode?: string;
  message?: string;
  totalItems?: number;
  completedItems?: number;
  count?: number;
  detected?: 'single' | 'multi';
  itemKey?: string;
  items?: Array<string | { query: string; quantity?: number; itemKey?: string }>;
  box?: unknown;
  result?: any;
  data?: any;
};

type QuickScanStreamOptions = {
  url: string;
  token: string;
  body: Record<string, any>;
  onEvent: (event: QuickScanStreamEvent) => void;
  onStallChange?: (stalled: boolean) => void;
  onConnectionError?: (message: string) => void;
  stallAfterMs?: number;
  hardTimeoutMs?: number;
};

type QuickScanStreamController = {
  close: () => void;
};

const TERMINAL_EVENT_TYPES = new Set<QuickScanEventType>(['COMPLETE', 'ERROR', 'NO_ITEMS', 'TIMEOUT']);

export function openQuickScanStream(options: QuickScanStreamOptions): QuickScanStreamController {
  const {
    url,
    token,
    body,
    onEvent,
    onStallChange,
    onConnectionError,
    stallAfterMs = 12_000,
    hardTimeoutMs = 75_000,
  } = options;

  let closed = false;
  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let hardTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
    if (hardTimeoutTimer) {
      clearTimeout(hardTimeoutTimer);
      hardTimeoutTimer = null;
    }
  };

  const setStalled = (nextValue: boolean) => {
    if (stalled === nextValue) return;
    stalled = nextValue;
    onStallChange?.(nextValue);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimers();
    setStalled(false);
    source.close();
  };

  const scheduleWatchdogs = () => {
    if (closed) return;
    if (stallTimer) clearTimeout(stallTimer);
    if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);

    stallTimer = setTimeout(() => {
      if (closed) return;
      setStalled(true);
    }, stallAfterMs);

    hardTimeoutTimer = setTimeout(() => {
      if (closed) return;
      const timeoutEvent: QuickScanStreamEvent = {
        type: 'TIMEOUT',
        phase: 'finishing',
        progress: 1,
        elapsedMs: hardTimeoutMs,
        reasonCode: 'client_timeout',
        message: 'Shelf scan timed out before the stream finished.',
      };
      onEvent(timeoutEvent);
      close();
    }, hardTimeoutMs);
  };

  const markActivity = () => {
    if (closed) return;
    setStalled(false);
    scheduleWatchdogs();
  };

  const source = new EventSource(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    pollingInterval: 0,
  } as any);

  source.addEventListener('open', () => {
    markActivity();
  });

  source.addEventListener('message', (event: any) => {
    if (closed) return;
    if (!event?.data) return;

    markActivity();

    try {
      const parsed = JSON.parse(event.data) as QuickScanStreamEvent;
      onEvent(parsed);
      if (TERMINAL_EVENT_TYPES.has(parsed.type)) {
        close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse stream event.';
      onConnectionError?.(message);
    }
  });

  source.addEventListener('error', (event: any) => {
    if (closed) return;
    const message = event?.message || 'Quick scan stream connection failed.';
    onConnectionError?.(message);
    close();
  });

  scheduleWatchdogs();

  return { close };
}
