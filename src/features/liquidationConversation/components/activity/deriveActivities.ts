// deriveActivities — the single place that turns a message into the list of
// inline activity cards to render. It guarantees TOTAL back-compat: a message
// that only carries the legacy metadata.toolSteps + reasoning synthesizes one
// {kind:'tool-run'} payload that renders exactly like today's receipt. New
// structured richness (value-change / publish / routine / reminder) lights up
// kind-by-kind as the backend starts emitting metadata.activities.
import type { ActivityPayload, ConversationMessage, ConversationToolStep, Routine } from '../../types';

const anyFailed = (steps: ConversationToolStep[]): boolean => steps.some((s) => s.status === 'failed');

const toolRunTitle = (steps: ConversationToolStep[]): string => {
  const count = steps.length;
  if (!count) return 'Thought it through';
  const totalMs = steps.reduce((sum, s) => sum + (typeof s.durationMs === 'number' ? s.durationMs : 0), 0);
  const secs = totalMs > 0 ? ` · ${(totalMs / 1000).toFixed(1)}s` : '';
  return `Done · ${count} step${count === 1 ? '' : 's'}${secs}`;
};

const hasText = (s?: string): boolean => !!(s && s.trim().length);

/** Minimal runtime guard so a malformed backend payload can't crash the feed. */
const coerceActivities = (raw: unknown[], messageId: string): ActivityPayload[] => {
  const out: ActivityPayload[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const a = item as Record<string, unknown>;
    if (typeof a.kind !== 'string') return;
    if (!a.id) a.id = `${messageId}-act-${i}`;
    if (typeof a.title !== 'string') a.title = '';
    out.push(a as unknown as ActivityPayload);
  });
  return out;
};

export function deriveActivities(message: ConversationMessage, isStreaming: boolean): ActivityPayload[] {
  if (message.role === 'user') return [];
  const meta = (message.metadata ?? {}) as Record<string, unknown>;

  // 1) Explicit structured activities — the rich path.
  if (Array.isArray(meta.activities) && meta.activities.length) {
    const coerced = coerceActivities(meta.activities as unknown[], message.id);
    if (coerced.length) return coerced;
  }

  // 2) Single-routine convenience field.
  const routine = meta.routine as Routine | undefined;
  if (routine && typeof routine === 'object' && routine.id) {
    return [{ kind: 'routine', id: `${message.id}-routine`, title: routine.title || 'Routine', routine }];
  }

  // 3) Legacy tool steps / reasoning -> one tool-run receipt (byte-identical to today).
  const steps = (Array.isArray(meta.toolSteps) ? meta.toolSteps : []) as ConversationToolStep[];
  const reasoning = typeof meta.reasoning === 'string' ? (meta.reasoning as string) : undefined;
  if (steps.length > 0 || hasText(reasoning)) {
    return [
      {
        kind: 'tool-run',
        id: `${message.id}-toolrun`,
        title: toolRunTitle(steps),
        status: anyFailed(steps) ? 'failed' : 'ok',
        steps,
        reasoning,
      },
    ];
  }

  // 4) Pure-thinking live pill, only before the first text token streams.
  if (isStreaming && !hasText(message.content)) {
    return [{ kind: 'tool-run', id: `${message.id}-live`, title: '', steps: [] }];
  }

  return [];
}
