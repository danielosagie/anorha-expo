// deriveActivities — the single place that turns a message into the list of
// inline activity cards to render. It guarantees TOTAL back-compat: a message
// that only carries the legacy metadata.toolSteps + reasoning synthesizes one
// {kind:'tool-run'} payload that renders exactly like today's receipt. New
// structured richness (value-change / publish / routine / reminder) lights up
// kind-by-kind as the backend starts emitting metadata.activities.
import type { ActivityPayload, ConversationMessage, ConversationToolStep, Routine } from '../../types';
import { summarizeChangeTitle } from './humanizers';

const anyFailed = (steps: ConversationToolStep[]): boolean => steps.some((s) => s.status === 'failed');

const toolRunTitle = (steps: ConversationToolStep[]): string => {
  const count = steps.length;
  if (!count) return 'Thought it through';
  const totalMs = steps.reduce((sum, s) => sum + (typeof s.durationMs === 'number' ? s.durationMs : 0), 0);
  const secs = totalMs > 0 ? ` · ${(totalMs / 1000).toFixed(1)}s` : '';
  return `Done · ${count} step${count === 1 ? '' : 's'}${secs}`;
};

const hasText = (s?: string): boolean => !!(s && s.trim().length);

/**
 * Minimal runtime guard so a malformed backend payload can't crash the feed.
 * Clones each entry (never mutates the cache-owned message.metadata objects) and
 * fills a stable id/title if the backend omitted them.
 */
const coerceActivities = (raw: unknown[], messageId: string): ActivityPayload[] => {
  const out: ActivityPayload[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const a = item as Record<string, unknown>;
    if (typeof a.kind !== 'string') return;
    out.push({
      ...(a as object),
      id: (a.id as string) || `${messageId}-act-${i}`,
      title: typeof a.title === 'string' ? a.title : '',
    } as unknown as ActivityPayload);
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

  // 3) Tool steps / reasoning. Steps that carry structured `changes` are PROMOTED
  //    into their own value-change diff cards (open the tray with the red->green
  //    diff); the remaining plain steps (queries, research) collapse into one calm
  //    tool-run receipt. A turn with only plain steps is byte-identical to before.
  const steps = (Array.isArray(meta.toolSteps) ? meta.toolSteps : []) as ConversationToolStep[];
  const reasoning = typeof meta.reasoning === 'string' ? (meta.reasoning as string) : undefined;
  if (steps.length > 0 || hasText(reasoning)) {
    const out: ActivityPayload[] = [];
    const plain: ConversationToolStep[] = [];
    steps.forEach((step, i) => {
      if (step.document && Array.isArray(step.document.sections)) {
        // A report the agent authored — its own tappable card (opens the editable sheet).
        out.push({
          kind: 'document',
          id: `${message.id}-doc-${i}`,
          title: step.document.title || 'Report',
          status: step.status === 'failed' ? 'failed' : 'ok',
          document: step.document,
        });
      } else if (Array.isArray(step.changes) && step.changes.length) {
        out.push({
          kind: 'value-change',
          id: `${message.id}-step-${i}`,
          title: summarizeChangeTitle(step.tool, step.changes),
          status: step.status === 'failed' ? 'failed' : 'ok',
          changes: step.changes,
          reason: step.reason,
          evidence: step.evidence,
          itemRef: step.itemRef,
          undo: step.undo,
        });
      } else {
        plain.push(step);
      }
    });
    // The receipt for the remaining plain steps (+ reasoning) leads the turn.
    if (plain.length > 0 || hasText(reasoning)) {
      out.unshift({
        kind: 'tool-run',
        id: `${message.id}-toolrun`,
        title: toolRunTitle(plain),
        status: anyFailed(plain) ? 'failed' : 'ok',
        steps: plain,
        reasoning,
      });
    }
    if (out.length) return out;
  }

  // 4) Pure-thinking live pill, only before the first text token streams.
  if (isStreaming && !hasText(message.content)) {
    return [{ kind: 'tool-run', id: `${message.id}-live`, title: '', steps: [] }];
  }

  return [];
}
