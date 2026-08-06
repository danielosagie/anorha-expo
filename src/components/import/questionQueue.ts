import { groupItems, type GroupKey } from './attentionGroups';
import type {
  BulkResolveItem,
  CanonicalRef,
  ResolveChoice,
  ResolveValueOverride,
  SyncItem,
} from '../../types/syncItem';

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

export const HANDOFF_REASONS: ReadonlySet<GroupKey> = new Set([
  'weak_match',
  'field_conflict',
  'stale_link',
]);

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
    // A missing token is intentionally sent as zero. That safely conflicts
    // instead of guessing at a newer row and is returned to the queue.
    version: Number.isInteger(item.version) ? (item.version as number) : 0,
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
    return card.items.map((item) => decision(item, 'create', undefined, {
      groupMode: answer === 'primary' ? 'combine' : 'separate',
      groupId: item.groupId || card.id,
    }));
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
