// deriveActivities — the single place that turns a message into the list of
// inline activity cards to render. It guarantees TOTAL back-compat: a message
// that only carries the legacy metadata.toolSteps + reasoning synthesizes one
// {kind:'tool-run'} payload that renders exactly like today's receipt. New
// structured richness (value-change / publish / routine / reminder) lights up
// kind-by-kind as the backend starts emitting metadata.activities.
import type { ActivityPayload, ConversationMessage, ConversationToolStep, Routine, ValueChange } from '../../types';
import { summarizeChangeTitle } from './humanizers';
import { compactDisplayText, sanitizeDisplayText } from '../../displayText';

const anyFailed = (steps: ConversationToolStep[]): boolean => steps.some((s) => s.status === 'failed');

const toolRunTitle = (steps: ConversationToolStep[]): string => {
  if (!steps.length) return 'Thought it through';
  const priceChanges = steps.reduce((count, step) => count + (step.changes?.filter(change =>
    change.kind === 'price' || change.field.toLowerCase().includes('price'),
  ).length ?? 0), 0);
  const preparedPlan = steps.some(step => !!step.plan);
  const preparedReport = steps.some(step => !!step.document);
  const tools = steps.map(step => `${step.tool} ${step.label || ''}`).join(' ').toLowerCase();
  const checkedPrices = /price|pricing|market|comp|valuation|research/.test(tools);
  const checkedInventory = /inventory|catalog|item|product|campaign/.test(tools);

  if (priceChanges) return `Applied and verified ${priceChanges} price change${priceChanges === 1 ? '' : 's'}`;
  if (preparedPlan && checkedPrices) return 'Checked market prices and prepared the plan';
  if (preparedPlan) return 'Reviewed the campaign and prepared the plan';
  if (preparedReport && checkedPrices) return 'Compared the options and prepared the report';
  if (preparedReport) return 'Reviewed the campaign and prepared the report';
  if (checkedPrices && checkedInventory) return 'Reviewed the inventory and checked market prices';
  if (checkedPrices) return 'Checked prices against the market';
  if (checkedInventory) return 'Reviewed the campaign inventory';

  const result = steps.find(step => step.resultSummary)?.resultSummary;
  if (result) return compactDisplayText(result, { maxChars: 90, maxSentences: 1 });
  return sanitizeDisplayText(steps[steps.length - 1]?.label || 'Finished the background checks');
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
  const textLen = typeof message.content === 'string' ? message.content.length : 0;
  if (steps.length > 0 || hasText(reasoning)) {
    const out: ActivityPayload[] = [];
    const plain: ConversationToolStep[] = [];
    const batchedChanges: ValueChange[] = [];
    let firstChangeStep: ConversationToolStep | undefined;
    let firstChangeIndex = -1;
    let changeAnchor = textLen;
    let changeFailed = false;
    steps.forEach((step, i) => {
      // Where this card sits. A report / plan / diff belongs BENEATH the reply (the
      // seller reads the answer, then the result to act on). This backend streams every
      // tool call BEFORE any reply text, so a real mid-text position is only used when
      // one genuinely exists (textAnchor > 0); otherwise the card falls to the end.
      const anchor = typeof step.textAnchor === 'number' && step.textAnchor > 0 ? step.textAnchor : textLen;
      if (step.selection && typeof step.selection.query === 'string') {
        out.push({
          kind: 'selection',
          id: `${message.id}-selection-${i}`,
          title: 'Select items',
          status: step.status === 'failed' ? 'failed' : 'pending',
          selection: step.selection,
          anchor,
        });
      } else if (step.plan && typeof step.plan.title === 'string') {
        // A plan the agent proposed — its own approvable card (opens the plan sheet).
        out.push({
          kind: 'plan',
          id: `${message.id}-plan-${i}`,
          title: step.plan.title,
          status: step.status === 'failed' ? 'failed' : 'ok',
          plan: step.plan,
          anchor,
        });
      } else if (step.document && Array.isArray(step.document.sections)) {
        // A report the agent authored — its own tappable card (opens the editable sheet).
        out.push({
          kind: 'document',
          id: `${message.id}-doc-${i}`,
          title: step.document.title || 'Report',
          status: step.status === 'failed' ? 'failed' : 'ok',
          document: step.document,
          anchor,
        });
      } else if (Array.isArray(step.changes) && step.changes.length) {
        if (!firstChangeStep) {
          firstChangeStep = step;
          firstChangeIndex = i;
        }
        batchedChanges.push(...step.changes);
        changeAnchor = Math.min(changeAnchor, anchor);
        changeFailed = changeFailed || step.status === 'failed';
      } else {
        plain.push(step);
      }
    });
    // A plan can touch many items. One card per tool call produced a long stack of
    // nearly-identical price cards; combine them into one reviewable batch with a
    // two-row preview and "+N more" disclosure.
    if (firstChangeStep && batchedChanges.length) {
      const allPrices = batchedChanges.every(
        (change) => change.kind === 'price' || change.field.toLowerCase().includes('price'),
      );
      out.push({
        kind: 'value-change',
        id: `${message.id}-changes-${firstChangeIndex}`,
        title: batchedChanges.length === 1
          ? summarizeChangeTitle(firstChangeStep.tool, batchedChanges)
          : allPrices
            ? `Updated ${batchedChanges.length} prices`
            : `Updated ${batchedChanges.length} values`,
        status: changeFailed ? 'failed' : 'ok',
        changes: batchedChanges,
        reason: firstChangeStep.reason,
        evidence: firstChangeStep.evidence,
        itemRef: batchedChanges.length === 1 ? firstChangeStep.itemRef : undefined,
        undo: batchedChanges.length === 1 ? firstChangeStep.undo : undefined,
        anchor: changeAnchor,
      });
    }
    // The receipt for the remaining plain steps (+ reasoning). It anchors to the FIRST
    // plain step's position (queries/research usually run before the reply text), so it
    // leads the turn like the Claude-app reasoning header.
    if (plain.length > 0 || hasText(reasoning)) {
      const receiptAnchor = plain.reduce<number | undefined>((min, s) => {
        const a = typeof s.textAnchor === 'number' ? s.textAnchor : undefined;
        return a === undefined ? min : min === undefined ? a : Math.min(min, a);
      }, undefined);
      out.unshift({
        kind: 'tool-run',
        id: `${message.id}-toolrun`,
        title: toolRunTitle(steps),
        status: anyFailed(plain) ? 'failed' : 'ok',
        steps: plain,
        reasoning,
        anchor: receiptAnchor ?? 0,
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
