import { groupItems, type GroupKey } from './attentionGroups';
import type {
  BulkResolveItem,
  CanonicalRef,
  ResolveChoice,
  ResolveValueOverride,
  SyncItem,
} from '../../types/syncItem';
import { buildLookAlikeGroupDecisions } from '../../lib/groupResolution';
import {
  advanceAnswerStreak,
  selectHandoffCards,
  type HandoffStreak as AnswerStreak,
} from '../../lib/handoffStreak';

export type QuestionCardKind =
  | 'pair'
  | 'which_one'
  | 'look_alike_group'
  | 'duplicate_target'
  | 'bundle'
  | 'title_quality'
  | 'commit_failed'
  | 'fallback';

export interface QuestionCardModel {
  id: string;
  reason: GroupKey;
  kind: QuestionCardKind;
  items: SyncItem[];
}

export type CardAnswer = 'primary' | 'secondary' | 'unsure';

export interface QueueDecision extends BulkResolveItem {
  outcome: 'linked' | 'added' | 'skipped';
}

export type HandoffStreak = AnswerStreak<QuestionCardModel['reason']>;

export interface QuestionHandoffOffer {
  reason: QuestionCardModel['reason'];
  answer: Exclude<CardAnswer, 'unsure'>;
  items: SyncItem[];
  decisions: QueueDecision[];
  thumbnails: Array<string | null>;
  decisionLabel: string;
}

export const HANDOFF_REASONS: ReadonlySet<GroupKey> = new Set([
  'multiple_candidates',
  'weak_match',
  'field_conflict',
  'stale_link',
  'look_alike_group',
  'duplicate_target',
  'bundle',
]);

const HANDOFF_CARD_KINDS: ReadonlySet<QuestionCardKind> = new Set([
  'pair',
  'which_one',
  'look_alike_group',
  'duplicate_target',
  'bundle',
]);

function canHandoff(card: QuestionCardModel, answer: CardAnswer): boolean {
  if (answer === 'unsure') return false;
  if (!HANDOFF_REASONS.has(card.reason) || !HANDOFF_CARD_KINDS.has(card.kind)) return false;
  // Candidate identities vary by card. "It's new" is reusable, but selecting
  // a candidate is not.
  if (card.kind === 'which_one') return answer === 'secondary';
  // A bundle row has one real CAS identity, but its detected parts do not.
  // Applying "Separate items" across cards would require inventing part ids.
  return card.kind !== 'bundle' || answer === 'primary';
}

function cardKindFor(reason: GroupKey): QuestionCardKind {
  switch (reason) {
    case 'weak_match':
    case 'field_conflict':
    case 'stale_link':
      return 'pair';
    case 'multiple_candidates':
      return 'which_one';
    case 'look_alike_group':
      return 'look_alike_group';
    case 'duplicate_target':
      return 'duplicate_target';
    case 'bundle':
      return 'bundle';
    case 'title_quality':
      return 'title_quality';
    case 'commit_failed':
      return 'commit_failed';
    default:
      return 'fallback';
  }
}

function groupedCards(reason: GroupKey, items: SyncItem[]): QuestionCardModel[] {
  const buckets = new Map<string, SyncItem[]>();
  for (const item of items) {
    // A missing group stamp must never accidentally combine unrelated rows.
    const key = item.groupId || `item:${item.platformId}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return Array.from(buckets, ([key, members]) => ({
    id: `${reason}:${key}`,
    reason,
    kind: cardKindFor(reason),
    items: members,
  }));
}

/**
 * Converts attention rows into question cards without sorting the rows. The
 * server already ranks each reason class by confidence DESC, so Map insertion
 * order is deliberate: the first three cards in a class remain the server's
 * most representative three for handoff training.
 */
export function buildQuestionCards(items: SyncItem[]): QuestionCardModel[] {
  const cards: QuestionCardModel[] = [];
  for (const group of groupItems(items)) {
    if (group.key === 'title_quality') {
      cards.push({
        id: 'title_quality:batch',
        reason: group.key,
        kind: 'title_quality',
        items: group.items,
      });
      continue;
    }
    // Failed commits are ONE decision ("try them again?"), not N cards. A
    // failed import can strand hundreds of these — run 7 found a connection
    // that was 440 commit_failed rows showing "0 questions"; as a batch card
    // the whole pile is one tap, and the retry job's drain also sweeps any
    // stuck pending rows on the connection.
    if (group.key === 'commit_failed') {
      cards.push({
        id: 'commit_failed:batch',
        reason: group.key,
        kind: 'commit_failed',
        items: group.items,
      });
      continue;
    }
    if (
      group.key === 'look_alike_group' ||
      group.key === 'duplicate_target' ||
      group.key === 'bundle'
    ) {
      cards.push(...groupedCards(group.key, group.items));
      continue;
    }
    for (const item of group.items) {
      cards.push({
        id: `${group.key}:${item.platformId}`,
        reason: group.key,
        kind: cardKindFor(group.key),
        items: [item],
      });
    }
  }
  return cards;
}

export function candidateForItem(item: SyncItem): CanonicalRef | null {
  if (item.resolution.kind === 'link') return item.resolution.canonical;
  const candidates = item.candidates ?? [];
  if (item.recommended === 'secondary') return candidates[1] ?? candidates[0] ?? null;
  return candidates[0] ?? null;
}

function decision(
  item: SyncItem,
  choice: ResolveChoice,
  canonicalId?: string,
  valueOverride?: ResolveValueOverride,
): QueueDecision {
  return {
    platformId: item.platformId,
    choice,
    canonicalId,
    valueOverride,
    // SyncItems.Version starts at 1, so a fabricated 0 can NEVER match the
    // server's CAS — every such item is a guaranteed conflict that reads to the
    // seller as a silent no-op. Send undefined instead: the caller drops these
    // and says so, rather than shipping an answer we know cannot save.
    version: Number.isInteger(item.version) ? (item.version as number) : undefined,
    outcome: choice === 'link' ? 'linked' : choice === 'create' ? 'added' : 'skipped',
  };
}

export function pairDecision(item: SyncItem, answer: CardAnswer): QueueDecision {
  if (answer === 'unsure') return decision(item, 'ignore');
  const candidate = candidateForItem(item);
  if (item.attention === 'field_conflict') {
    return candidate
      ? decision(item, 'link', candidate.id, answer === 'secondary')
      : decision(item, 'create');
  }
  if (answer === 'primary' && candidate) return decision(item, 'link', candidate.id);
  return decision(item, 'create');
}

export function whichOneDecision(
  item: SyncItem,
  answer: CardAnswer,
  selectedCanonicalId?: string | null,
): QueueDecision {
  if (answer === 'primary' && selectedCanonicalId) {
    return decision(item, 'link', selectedCanonicalId);
  }
  return decision(item, answer === 'secondary' ? 'create' : 'ignore');
}

export function groupDecisions(card: QuestionCardModel, answer: CardAnswer): QueueDecision[] {
  if (answer === 'unsure') return card.items.map((item) => decision(item, 'ignore'));

  if (card.kind === 'look_alike_group') {
    return buildLookAlikeGroupDecisions(card.items, card.id, answer);
  }

  if (card.kind === 'duplicate_target') {
    if (answer === 'primary') {
      return card.items.map((item) => {
        const candidate = candidateForItem(item);
        return candidate ? decision(item, 'link', candidate.id) : decision(item, 'create');
      });
    }
    return card.items.map((item) => decision(item, 'create'));
  }

  if (card.kind === 'bundle') {
    return card.items.map((item) => decision(item, 'create', undefined, {
      bundleMode: answer === 'primary' ? 'set' : 'separate',
    }));
  }

  return card.items.map((item) => decision(item, answer === 'primary' ? 'create' : 'ignore'));
}

export function decisionsForCard(card: QuestionCardModel, answer: CardAnswer): QueueDecision[] {
  if (card.kind === 'pair' && card.items[0]) return [pairDecision(card.items[0], answer)];
  if (card.kind === 'which_one' && card.items[0]) return [whichOneDecision(card.items[0], answer)];
  if (HANDOFF_CARD_KINDS.has(card.kind)) return groupDecisions(card, answer);
  return [];
}

export type BestGuessAction = 'link' | 'add';

export interface BestGuessCard {
  card: QuestionCardModel;
  action: BestGuessAction;
  decisions: QueueDecision[];
}

// Kinds whose primary answer needs no extra human input. which_one needs a
// candidate selection, bundle invents part identities, title_quality needs
// text, commit_failed is a retry, so none of those can be pre-checked.
const BEST_GUESS_KINDS: ReadonlySet<QuestionCardKind> = new Set([
  'pair',
  'look_alike_group',
  'duplicate_target',
]);

/**
 * The cards confident enough to pre-check on the "First, our best guesses"
 * screen. A best guess sends EXACTLY what tapping the primary answer in the
 * deck would send (same decisions, same versions), so a confirmed checklist
 * row and an answered card are indistinguishable server-side. The screen
 * groups rows by what the tap does, so a card whose primary decisions mix
 * outcomes (some link, some add) cannot sit truthfully in either section and
 * stays in the one-card deck instead.
 */
export function selectBestGuessCards(cards: QuestionCardModel[]): BestGuessCard[] {
  const guesses: BestGuessCard[] = [];
  for (const card of cards) {
    if (!BEST_GUESS_KINDS.has(card.kind)) continue;
    if (card.items[0]?.recommended !== 'primary') continue;
    const decisions = decisionsForCard(card, 'primary');
    if (decisions.length === 0 || decisions.length !== card.items.length) continue;
    const action: BestGuessAction | null = decisions.every((entry) => entry.outcome === 'linked')
      ? 'link'
      : decisions.every((entry) => entry.outcome === 'added')
        ? 'add'
        : null;
    if (!action) continue;
    guesses.push({ card, action, decisions });
  }
  return guesses;
}

export function bestGuessFooterLabel(linkCount: number, addCount: number): string {
  const parts: string[] = [];
  if (linkCount > 0) parts.push(`${linkCount} link`);
  if (addCount > 0) parts.push(`${addCount} add as new`);
  return parts.join(' · ');
}

export function handoffKey(
  reason: QuestionCardModel['reason'],
  answer: Exclude<CardAnswer, 'unsure'>,
): string {
  return `${reason}:${answer}`;
}

export function advanceHandoffStreak(
  previous: HandoffStreak | null,
  card: QuestionCardModel,
  answer: CardAnswer,
  thumbnail: string | null,
): HandoffStreak | null {
  return advanceAnswerStreak(
    previous,
    card,
    answer,
    thumbnail,
    canHandoff(card, answer),
  );
}

export function decisionLabelForCard(
  card: QuestionCardModel,
  answer: Exclude<CardAnswer, 'unsure'>,
): string {
  if (card.kind === 'look_alike_group') return answer === 'primary' ? 'Combined' : 'Kept separate';
  if (card.kind === 'duplicate_target') return answer === 'primary' ? 'Merged' : 'Kept separate';
  if (card.kind === 'bundle') return answer === 'primary' ? 'Kept as one set' : 'Split into separate items';
  return answer === 'primary' ? 'Accepted the suggested match' : 'Added as a new item';
}

export function buildHandoffOffer(
  streak: HandoffStreak | null,
  remainingCards: QuestionCardModel[],
): QuestionHandoffOffer | null {
  // Keep the reason-class boundary explicit at the queue layer as well as in
  // the generic streak helper. A handoff earned on one question class must
  // never receive another class's cards, even when both classes share the same
  // card kind, group stamp, or reusable answer.
  const sameReasonCards = streak
    ? remainingCards.filter((card) => card.reason === streak.reason)
    : [];
  const selection = selectHandoffCards(
    streak,
    sameReasonCards,
    (card) => canHandoff(card, streak?.answer ?? 'unsure'),
  );
  if (!selection) return null;

  const items = selection.cards.flatMap((card) => card.items);
  const decisions = selection.cards.flatMap((card) => decisionsForCard(card, selection.answer));
  if (decisions.length !== items.length) return null;

  return {
    reason: selection.reason,
    answer: selection.answer,
    items,
    decisions,
    thumbnails: selection.thumbnails,
    decisionLabel: decisionLabelForCard(selection.cards[0], selection.answer),
  };
}

export function generatedTitleDecisions(items: SyncItem[]): QueueDecision[] {
  return items.map((item) => decision(item, 'create', undefined, { generateTitleFromPhoto: true }));
}

export function manualTitleDecision(item: SyncItem, title: string): QueueDecision {
  return decision(item, 'create', undefined, { title: title.trim() });
}

export function retryCommitDecision(item: SyncItem): QueueDecision {
  if (item.resolution.kind === 'link') {
    return decision(item, 'link', item.resolution.canonical.id);
  }
  return decision(item, item.resolution.kind);
}
