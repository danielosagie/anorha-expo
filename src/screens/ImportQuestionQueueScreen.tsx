import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppStackParamList } from '../navigation/AppNavigator';
import { useResolution } from '../hooks/useResolution';
import {
  fetchImportCandidateDetails,
  fetchImportIncomingItemDetails,
  incomingItemDetailsFromPayload,
} from '../lib/importCandidateDetails';
import { getPlatform, normalizeDisplayName } from '../config/platforms';
import { createLogger } from '../utils/logger';
import {
  IC,
  HeroNumeral,
  InboxHeader,
  PillButton,
  ProgressLine,
  QueueHeader,
  SuccessCheck,
} from '../components/importinbox/InboxKit';
import {
  bestGuessFooterLabel,
  buildQuestionCards,
  buildHandoffOffer,
  candidateForItem,
  advanceHandoffStreak,
  decisionLabelForCard,
  generatedTitleDecisions,
  groupDecisions,
  handoffKey,
  manualTitleDecision,
  pairDecision,
  retryCommitDecision,
  selectBestGuessCards,
  whichOneDecision,
  type CardAnswer,
  type HandoffStreak,
  type QuestionCardModel,
  type QueueDecision,
} from '../components/import/questionQueue';
import {
  BestGuessChecklist,
  GuessHandoffCard,
  type BestGuessRowModel,
} from '../components/import/BestGuesses';
import {
  CardLoading,
  CommitFailedCard,
  GroupQuestionCard,
  HandoffCard,
  PairQuestionCard,
  QuestionScroll,
  TitleEntryCard,
  TitleQualityCard,
  WhichOneQuestionCard,
} from '../components/import/QuestionQueueCards';
import type {
  BulkResolveResult,
  CanonicalRef,
  ResolveChoice,
  SyncItem,
} from '../types/syncItem';
import { bulkResolutionNotice } from '../lib/bulkResolution';

const log = createLogger('ImportQuestionQueue');
const SURFACE = '#F5F5F7';
const CARD = '#FFFFFF';
const AMBER = '#BA7517';
const GREY = '#9CA3AF';
const GREEN_TINT = 'rgba(147,200,34,0.13)';
const AMBER_TINT = 'rgba(186,117,23,0.08)';

type RouteType = RouteProp<AppStackParamList, 'ImportQuestionQueue'>;
type NavType = StackNavigationProp<AppStackParamList, 'ImportQuestionQueue'>;
type Stage = 'loading' | 'explainer' | 'front' | 'best_guesses' | 'guess_handoff' | 'queue' | 'handoff' | 'title_entry' | 'receipt' | 'list';
type LedgerOutcome = 'linked' | 'added' | 'skipped';

interface LedgerEntry {
  platformId: string;
  item: SyncItem;
  outcome: LedgerOutcome;
  catalogTitle?: string | null;
  decisionLabel?: string;
  updatedAt: number;
}

interface HandoffState {
  reason: QuestionCardModel['reason'];
  answer: Exclude<CardAnswer, 'unsure'>;
  items: SyncItem[];
  decisions: QueueDecision[];
  thumbnails: Array<string | null>;
  decisionLabel: string;
}

const seenKey = (connectionId: string) => `@anorha/question-queue/seen/${connectionId}`;
const activeKey = (connectionId: string) => `@anorha/question-queue/active/${connectionId}`;
const ledgerKey = (connectionId: string) => `@anorha/question-queue/ledger/${connectionId}`;

function safeLedger(value: string | null): LedgerEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry.platformId === 'string' && entry.item)
      : [];
  } catch {
    return [];
  }
}

function platformLabel(value: string): string {
  const raw = value.trim() || 'Platform';
  const definition = getPlatform(raw.toLowerCase());
  return definition?.label || normalizeDisplayName(raw) || raw;
}

function isSettled(result: BulkResolveResult): boolean {
  return result.status === 'ok' || result.status === 'alreadyResolved';
}

function displayError(error: unknown, fallback = 'That answer did not save. Try again.'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function ImportQuestionQueueScreen() {
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavType>();
  const insets = useSafeAreaInsets();
  const { connectionId, platformName, importId } = route.params;
  const platform = platformLabel(platformName);
  const { result, loading, error, resolving, refresh, resolve, resolveBulk, generateTitlesBulk, unresolveBulk } = useResolution(connectionId, importId);

  const [stage, setStage] = useState<Stage>('loading');
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  // The last saved answer, as {platformId, version-after-save} rows — exactly
  // what POST /unresolve needs to take it back. Cleared once undone or stale.
  const [lastAnswer, setLastAnswer] = useState<Array<{ platformId: string; version: number }> | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [targetCardId, setTargetCardId] = useState<string | null>(null);
  const [queueStartCount, setQueueStartCount] = useState(0);
  const [handoff, setHandoff] = useState<HandoffState | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [uncheckedGuessIds, setUncheckedGuessIds] = useState<ReadonlySet<string>>(new Set());
  const [guessSummary, setGuessSummary] = useState<{ confirmed: number; remaining: number } | null>(null);
  const [guessCandidateDetails, setGuessCandidateDetails] = useState<Record<string, CanonicalRef>>({});
  const [manualItems, setManualItems] = useState<SyncItem[]>([]);
  const [manualIndex, setManualIndex] = useState(0);
  const [manualTitle, setManualTitle] = useState('');
  const [showAll, setShowAll] = useState<Record<LedgerOutcome | 'needs', boolean>>({
    needs: false,
    linked: false,
    added: false,
    skipped: false,
  });
  const [listError, setListError] = useState<string | null>(null);

  const finishRef = useRef(false);
  const returnToListRef = useRef(false);
  // Once the seller has confirmed (or declined) the best guesses in this
  // session, re-entering from the front goes straight to the deck.
  const guessesHandledRef = useRef(false);
  const streakRef = useRef<HandoffStreak | null>(null);
  const suppressedHandoffsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void Promise.all([
      AsyncStorage.getItem(seenKey(connectionId)),
      AsyncStorage.getItem(activeKey(connectionId)),
      AsyncStorage.getItem(ledgerKey(connectionId)),
    ]).then(([seen, active, savedLedger]) => {
      if (!alive) return;
      setLedger(safeLedger(savedLedger));
      if (route.params.startAt === 'list') setStage('list');
      else if (route.params.startAt === 'front') setStage('front');
      else if (active === '1') setStage('queue');
      else setStage(seen === '1' ? 'front' : 'explainer');
    }).catch(() => {
      if (!alive) return;
      setStage(route.params.startAt === 'front' ? 'front' : 'explainer');
    });
    return () => {
      alive = false;
    };
  }, [connectionId, route.params.startAt]);

  const cards = useMemo(() => buildQuestionCards(result?.needsAttention ?? []), [result?.needsAttention]);
  // commit_failed rides the deck as ONE batch card, after the real questions.
  // Excluding it entirely made an all-failed import read "0 questions" with
  // 440 workable rows behind it (run 7 P1-2).
  const mainCards = useMemo(() => [
    ...cards.filter((card) => card.kind !== 'commit_failed'),
    ...cards.filter((card) => card.kind === 'commit_failed'),
  ], [cards]);
  // Best guesses are pre-checked ANSWERS, never retries: commit_failed now
  // rides mainCards (batched last, above), so selectBestGuessCards must — and
  // does — exclude it by kind rather than relying on it being pre-filtered.
  const bestGuesses = useMemo(() => selectBestGuessCards(mainCards), [mainCards]);
  const targetedCard = targetCardId ? cards.find((card) => card.id === targetCardId) ?? null : null;
  const currentCard = targetedCard ?? mainCards[0] ?? null;

  // A killed app resumes directly in the queue. Rebuild the progress baseline
  // from the authoritative remaining cards on that first resumed render.
  useEffect(() => {
    const attentionCount = result?.needsAttention.length ?? 0;
    if (stage === 'queue' && queueStartCount === 0 && attentionCount > 0) {
      setQueueStartCount(attentionCount);
    }
  }, [queueStartCount, result?.needsAttention.length, stage]);

  useEffect(() => {
    setSelectedCandidateId(null);
    setActionError(null);
  }, [currentCard?.id]);

  const [incomingDetails, setIncomingDetails] = useState<Record<string, ReturnType<typeof incomingItemDetailsFromPayload>>>({});
  const [candidateDetails, setCandidateDetails] = useState<Record<string, CanonicalRef>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!currentCard) {
      setIncomingDetails({});
      setCandidateDetails({});
      setDetailsLoading(false);
      return;
    }
    const items = currentCard.items;
    const initialIncoming = Object.fromEntries(
      items.map((item) => [item.platformId, incomingItemDetailsFromPayload(item, platform)]),
    );
    setIncomingDetails(initialIncoming);
    const candidateIds = Array.from(new Set(items.flatMap((item) => [
      ...(item.candidates ?? []).map((candidate) => candidate.id),
      item.resolution.kind === 'link' ? item.resolution.canonical.id : '',
    ]).filter(Boolean)));
    setDetailsLoading(true);
    const incomingHydration = platform.toLowerCase() === 'csv'
      ? Promise.resolve(Object.entries(initialIncoming))
      : Promise.all(items.map(async (item) => {
        try {
          return [item.platformId, await fetchImportIncomingItemDetails(item, platform)] as const;
        } catch (hydrateError) {
          log.warn('incoming hydration failed', item.platformId, hydrateError);
          return [item.platformId, incomingItemDetailsFromPayload(item, platform)] as const;
        }
      }));
    void Promise.all([
      incomingHydration,
      fetchImportCandidateDetails(candidateIds, platform).catch((hydrateError) => {
        log.warn('candidate hydration failed', hydrateError);
        return {};
      }),
    ]).then(([incoming, candidates]) => {
      if (!alive) return;
      setIncomingDetails(Object.fromEntries(incoming));
      setCandidateDetails(candidates);
    }).finally(() => {
      if (alive) setDetailsLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [currentCard?.id, platform]);

  const hydratedItems = useMemo(() => (currentCard?.items ?? []).map((item) => {
    const details = incomingDetails[item.platformId] ?? incomingItemDetailsFromPayload(item, platform);
    return { ...item, title: details.title, imageUrl: details.imageUrl };
  }), [currentCard?.items, incomingDetails, platform]);

  const hydratedCandidates = useMemo(() => {
    const seen = new Set<string>();
    const all = (currentCard?.items ?? []).flatMap((item) => [
      ...(item.candidates ?? []),
      ...(item.resolution.kind === 'link' ? [item.resolution.canonical] : []),
    ]);
    return all.filter((candidate) => {
      if (!candidate.id || seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    }).map((candidate) => ({ ...candidate, ...candidateDetails[candidate.id] }));
  }, [currentCard?.items, candidateDetails]);

  const hydratedCandidateForFirst = useMemo(() => {
    const item = hydratedItems[0];
    if (!item) return null;
    const candidate = candidateForItem(item);
    return candidate ? { ...candidate, ...candidateDetails[candidate.id] } : null;
  }, [hydratedItems, candidateDetails]);

  const recordDecisions = useCallback((
    decisions: QueueDecision[],
    sourceItems: SyncItem[],
    bulkResults?: BulkResolveResult[],
    decisionLabel?: string,
  ) => {
    const settledIds = bulkResults
      ? new Set(bulkResults.filter(isSettled).map((entry) => entry.platformId))
      : new Set(decisions.map((entry) => entry.platformId));
    const itemById = new Map(sourceItems.map((item) => [item.platformId, item]));
    const decisionById = new Map(decisions.map((entry) => [entry.platformId, entry]));
    const resultById = new Map((bulkResults ?? []).map((entry) => [entry.platformId, entry]));

    setLedger((previous) => {
      const nextById = new Map(previous.map((entry) => [entry.platformId, entry]));
      for (const platformId of settledIds) {
        const item = itemById.get(platformId);
        const itemDecision = decisionById.get(platformId);
        if (!item || !itemDecision) continue;
        const candidate = itemDecision.canonicalId
          ? (item.candidates ?? []).find((entry) => entry.id === itemDecision.canonicalId)
            ?? (item.resolution.kind === 'link' && item.resolution.canonical.id === itemDecision.canonicalId
              ? item.resolution.canonical
              : null)
          : null;
        const resultEntry = resultById.get(platformId);
        nextById.set(platformId, {
          platformId,
          item: {
            ...item,
            version: resultEntry?.version ?? (Number.isInteger(item.version) ? (item.version as number) + 1 : item.version),
          },
          outcome: itemDecision.outcome,
          catalogTitle: candidate?.title ?? null,
          decisionLabel,
          updatedAt: Date.now(),
        });
      }
      const next = Array.from(nextById.values()).sort((left, right) => right.updatedAt - left.updatedAt);
      void AsyncStorage.setItem(ledgerKey(connectionId), JSON.stringify(next)).catch((storageError) => {
        log.warn('ledger persistence failed', storageError);
      });
      return next;
    });
  }, [connectionId]);

  const markSeen = useCallback(() => {
    void AsyncStorage.setItem(seenKey(connectionId), '1');
    setStage('front');
  }, [connectionId]);

  const finishQueue = useCallback(async () => {
    if (finishRef.current) return;
    finishRef.current = true;
    try {
      await refresh();
      await AsyncStorage.removeItem(activeKey(connectionId));
      setTargetCardId(null);
      setStage('receipt');
    } finally {
      finishRef.current = false;
    }
  }, [connectionId, refresh]);

  const startQueue = useCallback(() => {
    if (mainCards.length === 0) {
      void finishQueue();
      return;
    }
    setQueueStartCount(
      result?.needsAttention.length ?? mainCards.reduce((total, card) => total + card.items.length, 0),
    );
    setQueueNotice(null);
    setLastAnswer(null);
    void AsyncStorage.setItem(activeKey(connectionId), '1');
    setStage('queue');
  }, [connectionId, finishQueue, mainCards, result?.needsAttention.length]);

  // Front → best guesses when the server has any, otherwise straight to the
  // deck exactly as before. Zero best guesses means this stage never exists.
  const beginQuestions = useCallback(() => {
    if (bestGuesses.length === 0 || guessesHandledRef.current) {
      startQueue();
      return;
    }
    setUncheckedGuessIds(new Set());
    setActionError(null);
    setStage('best_guesses');
  }, [bestGuesses.length, startQueue]);

  const toggleGuess = useCallback((cardId: string) => {
    setUncheckedGuessIds((previous) => {
      const next = new Set(previous);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }, []);

  // Batch-hydrate catalog titles for the "to <catalog title>" sub-lines. One
  // request for the whole checklist; payload identities cover the rest.
  useEffect(() => {
    if (stage !== 'best_guesses') return;
    let alive = true;
    const candidateIds = Array.from(new Set(bestGuesses.flatMap(({ card }) =>
      card.items.flatMap((item) => {
        const candidate = candidateForItem(item);
        return candidate ? [candidate.id] : [];
      }),
    )));
    if (candidateIds.length === 0) return;
    fetchImportCandidateDetails(candidateIds, platform).then((details) => {
      if (alive) setGuessCandidateDetails(details);
    }).catch((hydrateError) => {
      log.warn('best-guess candidate hydration failed', hydrateError);
    });
    return () => {
      alive = false;
    };
  }, [bestGuesses, platform, stage]);

  const guessRows = useMemo<BestGuessRowModel[]>(() => bestGuesses.map(({ card, action }) => {
    const item = card.items[0];
    const details = incomingItemDetailsFromPayload(item, platform);
    const candidate = action === 'link' ? candidateForItem(item) : null;
    const hydrated = candidate ? guessCandidateDetails[candidate.id] : null;
    const catalogTitle = hydrated?.title ?? candidate?.title ?? candidate?.sku ?? null;
    return {
      id: card.id,
      action,
      title: details.title || item.title || 'Untitled item',
      sub: action === 'link'
        ? `to ${catalogTitle || 'your catalog item'}`
        : card.items.length > 1 ? countLabel(card.items.length, 'item') : null,
      imageUrl: details.imageUrl ?? item.imageUrl ?? null,
      checked: !uncheckedGuessIds.has(card.id),
    };
  }), [bestGuesses, guessCandidateDetails, platform, uncheckedGuessIds]);

  useEffect(() => {
    if (stage !== 'queue' || !result || loading || currentCard || finishRef.current) return;
    if (targetCardId) {
      setTargetCardId(null);
      setStage('list');
      return;
    }
    void finishQueue();
  }, [stage, result, loading, currentCard, targetCardId, finishQueue]);

  const resolveOne = useCallback(async (item: SyncItem, itemDecision: QueueDecision) => {
    await resolve(item.platformId, itemDecision.choice, itemDecision.canonicalId, {
      importId: item.importId ?? importId ?? undefined,
      version: item.version,
      valueOverride: itemDecision.valueOverride,
    });
    recordDecisions([itemDecision], [item]);
    // The CAS save bumped Version by exactly one; that fresh token is what an
    // undo must present.
    if (Number.isInteger(item.version)) {
      setLastAnswer([{ platformId: item.platformId, version: (item.version as number) + 1 }]);
      setQueueNotice('Saved');
    } else {
      setLastAnswer(null);
    }
  }, [importId, recordDecisions, resolve]);

  const undoableFromResults = useCallback((results: BulkResolveResult[]) => {
    const undoable = results
      .filter((entry) => (entry.status === 'ok' || entry.status === 'alreadyResolved') && Number.isInteger(entry.version))
      .map((entry) => ({ platformId: entry.platformId, version: entry.version as number }));
    setLastAnswer(undoable.length > 0 ? undoable : null);
  }, []);

  const confirmBestGuesses = useCallback(async () => {
    const checked = bestGuesses.filter((guess) => !uncheckedGuessIds.has(guess.card.id));
    if (checked.length === 0) return;
    setActionError(null);
    try {
      const decisions = checked.flatMap((guess) => guess.decisions);
      const response = await resolveBulk(decisions, importId ?? undefined);
      for (const guess of checked) {
        const memberIds = new Set(guess.decisions.map((entry) => entry.platformId));
        recordDecisions(
          guess.decisions,
          guess.card.items,
          response.results.filter((entry) => memberIds.has(entry.platformId)),
          decisionLabelForCard(guess.card, 'primary'),
        );
      }
      undoableFromResults(response.results);
      setQueueNotice(bulkResolutionNotice(response.summary));
      guessesHandledRef.current = true;
      const settled = new Set(
        response.results.filter(isSettled).map((entry) => entry.platformId),
      );
      const remainingCards = mainCards.filter((card) =>
        card.items.some((item) => !settled.has(item.platformId)));
      const failed = response.summary.conflicts + response.summary.errors;
      if (remainingCards.length === 0 && failed === 0) {
        await finishQueue();
        return;
      }
      if (response.summary.saved === 0) {
        // Nothing stuck (all conflicts or errors): the notice explains, the deck
        // still holds every card. No point celebrating zero.
        void AsyncStorage.setItem(activeKey(connectionId), '1');
        setQueueStartCount(remainingCards.reduce((total, card) => total + card.items.length, 0));
        setStage('queue');
        return;
      }
      setGuessSummary({ confirmed: response.summary.saved, remaining: remainingCards.length });
      setStage('guess_handoff');
    } catch (bulkError) {
      setActionError(displayError(bulkError, 'Those answers did not save. They are still here.'));
    }
  }, [bestGuesses, connectionId, finishQueue, importId, mainCards, recordDecisions, resolveBulk, uncheckedGuessIds, undoableFromResults]);

  // "Show me" keeps the saved notice + Undo visible in the deck, so it must
  // NOT go through startQueue (which clears both).
  const showRemainingQuestions = useCallback(() => {
    void AsyncStorage.setItem(activeKey(connectionId), '1');
    setQueueStartCount(result?.needsAttention.length ?? 0);
    setGuessSummary(null);
    setStage('queue');
  }, [connectionId, result?.needsAttention.length]);

  const skipBestGuesses = useCallback(() => {
    guessesHandledRef.current = true;
    startQueue();
  }, [startQueue]);

  const removeLedgerEntries = useCallback((platformIds: string[]) => {
    const removed = new Set(platformIds);
    setLedger((previous) => {
      const next = previous.filter((entry) => !removed.has(entry.platformId));
      void AsyncStorage.setItem(ledgerKey(connectionId), JSON.stringify(next)).catch((storageError) => {
        log.warn('ledger persistence failed', storageError);
      });
      return next;
    });
  }, [connectionId]);

  const undoLastAnswer = useCallback(async () => {
    if (!lastAnswer || lastAnswer.length === 0 || undoBusy) return;
    setUndoBusy(true);
    setActionError(null);
    try {
      const response = await unresolveBulk(lastAnswer, importId ?? undefined);
      const undone = response.results
        .filter((entry) => entry.status === 'ok' || entry.status === 'alreadyResolved')
        .map((entry) => entry.platformId);
      if (undone.length > 0) removeLedgerEntries(undone);
      const tooLate = response.results.length - undone.length;
      setQueueNotice(
        tooLate > 0
          ? `${undone.length} back in the queue · ${tooLate} already imported`
          : undone.length === 1
            ? 'Back in the queue'
            : `${undone.length} back in the queue`,
      );
      setLastAnswer(null);
      streakRef.current = null;
      setStage('queue');
    } catch (undoError) {
      setActionError(displayError(undoError, 'That answer could not be taken back.'));
    } finally {
      setUndoBusy(false);
    }
  }, [importId, lastAnswer, removeLedgerEntries, undoBusy, unresolveBulk]);

  const returnAfterTarget = useCallback(async () => {
    if (!returnToListRef.current) return false;
    returnToListRef.current = false;
    setTargetCardId(null);
    await refresh();
    setStage('list');
    return true;
  }, [refresh]);

  const offerHandoffAfter = useCallback((
    card: QuestionCardModel,
    answer: CardAnswer,
    remainingCards: QuestionCardModel[],
  ): boolean => {
    const firstItem = card.items[0];
    const thumbnail = firstItem
      ? incomingDetails[firstItem.platformId]?.imageUrl ?? firstItem.imageUrl ?? null
      : null;
    const next = advanceHandoffStreak(streakRef.current, card, answer, thumbnail);
    streakRef.current = next;
    const offer = buildHandoffOffer(next, remainingCards);
    if (!offer || suppressedHandoffsRef.current.has(handoffKey(offer.reason, offer.answer))) {
      return false;
    }
    setHandoff(offer);
    setHandoffError(null);
    setStage('handoff');
    return true;
  }, [incomingDetails]);

  const answerPair = useCallback(async (answer: CardAnswer) => {
    const card = currentCard;
    const item = card?.items[0];
    if (!card || !item || card.kind !== 'pair') return;
    setActionError(null);
    try {
      const itemDecision = pairDecision(item, answer);
      await resolveOne(item, itemDecision);
      if (await returnAfterTarget()) return;

      const otherCards = mainCards.filter((entry) => entry.id !== card.id);
      if (offerHandoffAfter(card, answer, otherCards)) return;

      if (otherCards.length === 0) await finishQueue();
    } catch (resolveError) {
      setActionError(displayError(resolveError));
    }
  }, [currentCard, finishQueue, mainCards, offerHandoffAfter, resolveOne, returnAfterTarget]);

  const answerWhichOne = useCallback(async (answer: CardAnswer) => {
    const card = currentCard;
    const item = card?.items[0];
    if (!card || !item || card.kind !== 'which_one') return;
    setActionError(null);
    try {
      const itemDecision = whichOneDecision(item, answer, selectedCandidateId);
      await resolveOne(item, itemDecision);
      setSelectedCandidateId(null);
      if (await returnAfterTarget()) return;
      const otherCards = mainCards.filter((entry) => entry.id !== card.id);
      if (offerHandoffAfter(card, answer, otherCards)) return;
      if (otherCards.length === 0) await finishQueue();
    } catch (resolveError) {
      setActionError(displayError(resolveError));
    }
  }, [currentCard, finishQueue, mainCards, offerHandoffAfter, resolveOne, returnAfterTarget, selectedCandidateId]);

  const runBulkCardAnswer = useCallback(async (
    card: QuestionCardModel,
    decisions: QueueDecision[],
    answer?: CardAnswer,
  ) => {
    setActionError(null);
    try {
      const response = await resolveBulk(decisions, importId ?? undefined);
      const decisionLabel = answer && answer !== 'unsure'
        ? decisionLabelForCard(card, answer)
        : undefined;
      recordDecisions(decisions, card.items, response.results, decisionLabel);
      undoableFromResults(response.results);
      const outcome = response.summary;
      const failed = outcome.conflicts + outcome.errors;
      setQueueNotice(bulkResolutionNotice(outcome));
      if (await returnAfterTarget()) return;
      const otherCards = mainCards.filter((entry) => entry.id !== card.id);
      if (failed === 0 && answer && offerHandoffAfter(card, answer, otherCards)) return;
      if (failed > 0) streakRef.current = null;
      if (failed === 0 && otherCards.length === 0) await finishQueue();
      else setStage('queue');
    } catch (bulkError) {
      setActionError(displayError(bulkError, 'Those answers did not save. They are back in the queue.'));
    }
  }, [finishQueue, importId, mainCards, offerHandoffAfter, recordDecisions, resolveBulk, returnAfterTarget, undoableFromResults]);

  const answerGroup = useCallback((answer: CardAnswer) => {
    if (!currentCard) return;
    void runBulkCardAnswer(currentCard, groupDecisions(currentCard, answer), answer);
  }, [currentCard, runBulkCardAnswer]);

  const generateTitles = useCallback(async () => {
    if (!currentCard || currentCard.kind !== 'title_quality') return;
    setActionError(null);
    const decisions = generatedTitleDecisions(currentCard.items);
    try {
      const response = await generateTitlesBulk(decisions, importId ?? undefined);
      const titleById = new Map(response.results.map((entry) => [entry.platformId, entry.generatedTitle]));
      const titledItems = currentCard.items.map((item) => ({
        ...item,
        title: titleById.get(item.platformId) || item.title,
      }));
      recordDecisions(decisions, titledItems, response.results, 'Title generated');
      undoableFromResults(response.results);
      const failed = response.summary.conflicts + response.summary.errors;
      setQueueNotice(bulkResolutionNotice(response.summary));
      if (failed === 0 && mainCards.length === 1) await finishQueue();
      else setStage('queue');
    } catch (generationError) {
      setActionError(displayError(generationError, 'Those titles were not generated. The rows are still in the queue.'));
    }
  }, [currentCard, finishQueue, generateTitlesBulk, importId, mainCards.length, recordDecisions, undoableFromResults]);

  const enterManualTitles = useCallback(() => {
    if (!currentCard || currentCard.kind !== 'title_quality') return;
    setManualItems(currentCard.items);
    setManualIndex(0);
    setManualTitle('');
    setStage('title_entry');
  }, [currentCard]);

  const answerManualTitle = useCallback(async (unsure: boolean) => {
    const item = manualItems[manualIndex];
    if (!item) return;
    setActionError(null);
    try {
      const itemDecision = unsure
        ? { ...manualTitleDecision(item, item.title || 'Untitled item'), choice: 'ignore' as const, outcome: 'skipped' as const, valueOverride: undefined }
        : manualTitleDecision(item, manualTitle);
      await resolveOne(item, itemDecision);
      if (manualIndex + 1 < manualItems.length) {
        setManualIndex((index) => index + 1);
        setManualTitle('');
        return;
      }
      setManualItems([]);
      setManualIndex(0);
      setManualTitle('');
      const otherCards = mainCards.filter((entry) => entry.kind !== 'title_quality');
      if (otherCards.length === 0) await finishQueue();
      else setStage('queue');
    } catch (resolveError) {
      setActionError(displayError(resolveError));
    }
  }, [finishQueue, mainCards, manualIndex, manualItems, manualTitle, resolveOne]);

  const finishHandoff = useCallback(async () => {
    if (!handoff) return;
    setHandoffError(null);
    try {
      const response = await resolveBulk(handoff.decisions, importId ?? undefined);
      recordDecisions(handoff.decisions, handoff.items, response.results, handoff.decisionLabel);
      undoableFromResults(response.results);
      const outcome = response.summary;
      const failed = outcome.conflicts + outcome.errors;
      setQueueNotice(bulkResolutionNotice(outcome));
      const otherClasses = mainCards.filter((card) => card.reason !== handoff.reason);
      streakRef.current = null;
      setHandoff(null);
      if (failed === 0 && otherClasses.length === 0) await finishQueue();
      else setStage('queue');
    } catch (bulkError) {
      setHandoffError(displayError(bulkError, 'Those items are back in the queue.'));
    }
  }, [finishQueue, handoff, importId, mainCards, recordDecisions, resolveBulk, undoableFromResults]);

  const keepShowing = useCallback(() => {
    if (handoff) suppressedHandoffsRef.current.add(handoffKey(handoff.reason, handoff.answer));
    streakRef.current = null;
    setHandoff(null);
    setHandoffError(null);
    setStage('queue');
  }, [handoff]);

  const retryCommit = useCallback(async () => {
    const card = currentCard;
    if (!card || card.items.length === 0 || card.kind !== 'commit_failed') return;
    setActionError(null);
    try {
      // One tap retries the whole failed pile. The retry job's end-of-run
      // drain also sweeps any stranded pending rows on this connection.
      if (card.items.length === 1) {
        await resolveOne(card.items[0], retryCommitDecision(card.items[0]));
        if (await returnAfterTarget()) return;
        if (mainCards.filter((entry) => entry.id !== card.id).length === 0) await finishQueue();
        return;
      }
      const decisions = card.items.map((item) => retryCommitDecision(item));
      const response = await resolveBulk(decisions, importId ?? undefined);
      recordDecisions(decisions, card.items, response.results, 'Tried again');
      undoableFromResults(response.results);
      setQueueNotice(bulkResolutionNotice(response.summary));
      if (await returnAfterTarget()) return;
      const failed = response.summary.conflicts + response.summary.errors;
      const otherCards = mainCards.filter((entry) => entry.id !== card.id);
      if (failed === 0 && otherCards.length === 0) await finishQueue();
      else setStage('queue');
    } catch (resolveError) {
      setActionError(displayError(resolveError, 'Those items still did not finish. Try again later.'));
    }
  }, [currentCard, finishQueue, importId, mainCards, recordDecisions, resolveBulk, resolveOne, returnAfterTarget, undoableFromResults]);

  const openNeedsItem = useCallback((item: SyncItem) => {
    const card = cards.find((entry) => entry.items.some((member) => member.platformId === item.platformId));
    if (!card) return;
    returnToListRef.current = true;
    setTargetCardId(card.id);
    setQueueStartCount(result?.needsAttention.length ?? card.items.length);
    setStage('queue');
  }, [cards, result?.needsAttention.length]);

  const changeSettledEntry = useCallback(async (entry: LedgerEntry) => {
    setListError(null);
    const choice: ResolveChoice = entry.outcome === 'linked' ? 'create' : entry.outcome === 'added' ? 'ignore' : 'create';
    const outcome: LedgerOutcome = choice === 'create' ? 'added' : 'skipped';
    const itemDecision: QueueDecision = {
      platformId: entry.platformId,
      choice,
      version: Number.isInteger(entry.item.version) ? (entry.item.version as number) : undefined,
      outcome,
    };
    try {
      // Omit the old ledger version here. The single endpoint reads the current
      // row token server-side, which is safer after an asynchronous commit bump.
      await resolve(entry.platformId, choice, undefined, { importId: entry.item.importId ?? importId ?? undefined });
      recordDecisions([itemDecision], [entry.item]);
      await refresh();
    } catch (changeError) {
      setListError(displayError(changeError, 'That change could not be saved.'));
    }
  }, [importId, recordDecisions, refresh, resolve]);

  // Stall guard for the "Finishing your import" wait: if the pending-commit
  // count does not move across ~12s of polling, the worker is not coming
  // (dead connection, stranded row) — show the receipt with an honest note
  // instead of spinning forever with no exit (run 7 P1-2 trap).
  const [commitStalled, setCommitStalled] = useState(false);
  const stallRef = useRef<{ count: number; polls: number }>({ count: -1, polls: 0 });

  const summary = result?.summary;
  const questionItemCount = mainCards.reduce((total, card) => total + card.items.length, 0);
  const remainingCount = result?.needsAttention.length ?? questionItemCount;
  const progressTotal = Math.max(queueStartCount, remainingCount, 1);
  const progressPct = ((progressTotal - remainingCount) / progressTotal) * 100;
  const busy = resolving != null;
  const hasUnresolved = cards.length > 0 || (summary?.needsAttention ?? 0) > 0;
  const pendingCommitCount = summary?.pendingCommit ?? 0;

  useEffect(() => {
    if (stage !== 'receipt' || pendingCommitCount === 0) {
      stallRef.current = { count: -1, polls: 0 };
      if (commitStalled) setCommitStalled(false);
      return;
    }
    if (commitStalled) return; // deadline hit — stop paying for polls
    if (stallRef.current.count === pendingCommitCount) {
      stallRef.current.polls += 1;
      if (stallRef.current.polls >= 8) {
        setCommitStalled(true);
        return;
      }
    } else {
      stallRef.current = { count: pendingCommitCount, polls: 0 };
    }
    const timer = setTimeout(() => void refresh(), 1500);
    return () => clearTimeout(timer);
  }, [commitStalled, pendingCommitCount, refresh, stage]);

  if ((stage === 'loading' || (loading && !result)) && !error) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={IC.accent} />
      </View>
    );
  }

  if (error && !result) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorTitle}>Couldn’t load this import</Text>
        <Text style={styles.errorText}>{error}</Text>
        <PillButton label="Retry" onPress={refresh} style={styles.retryButton} />
      </View>
    );
  }

  if (stage === 'explainer') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <InboxHeader onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={styles.explainerScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.explainerTitleBlock}>
            <Text style={styles.screenTitle}>Let’s bring in your {platform} items.</Text>
            <Text style={styles.screenSubtitle}>Here’s how it works.</Text>
          </View>
          <View style={styles.steps}>
            {[
              ['1', 'We bring everything in', null],
              ['2', 'We match what we’re sure of', null],
              ['3', 'We ask you about the rest', 'usually just a few questions'],
            ].map(([number, title, caption]) => (
              <View key={number} style={styles.stepRow}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View>
                <View style={styles.stepCopy}>
                  <Text style={styles.stepTitle}>{title}</Text>
                  {caption ? <Text style={styles.stepCaption}>{caption}</Text> : null}
                </View>
              </View>
            ))}
          </View>
          <View style={styles.reassurance}>
            <MaterialCommunityIcons name="lock-outline" size={21} color={IC.ink} />
            <Text style={styles.reassuranceText}>Nothing changes on {platform}.</Text>
          </View>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
          <Text style={styles.footerCaption}>takes a few minutes · you can leave anytime</Text>
          <PillButton label="Start" onPress={markSeen} />
        </View>
      </View>
    );
  }

  if (stage === 'front') {
    const questionCount = mainCards.length;
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <InboxHeader onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={styles.frontScroll} showsVerticalScrollIndicator={false}>
          <HeroNumeral value={summary?.total ?? 0} label={`items from ${platform}`} animate />
          <View style={styles.countCard}>
            <CountRow label="Linked to your catalog" count={summary?.autoLinked ?? 0} />
            <View style={styles.divider} />
            <CountRow label="Added as new" count={summary?.autoCreated ?? 0} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${countLabel(questionCount, 'question')}, covers ${countLabel(questionItemCount, 'item')}`}
            onPress={beginQuestions}
            style={({ pressed }) => [styles.questionFrontCard, pressed ? styles.pressed : null]}
          >
            <View style={styles.questionFrontCopy}>
              <Text style={styles.questionFrontTitle}>{countLabel(questionCount, 'question')}</Text>
              <Text style={styles.questionFrontSub}>covers the last {questionItemCount} items</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={IC.ink} />
          </Pressable>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
          <PillButton label="Start" onPress={beginQuestions} />
          <PillButton label="Later" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </View>
    );
  }

  if (stage === 'best_guesses') {
    const checkedRows = guessRows.filter((row) => row.checked);
    const linkCount = checkedRows.filter((row) => row.action === 'link').length;
    const footerLabel = bestGuessFooterLabel(linkCount, checkedRows.length - linkCount);
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <InboxHeader onBack={() => setStage('front')} />
        <ScrollView contentContainerStyle={styles.guessScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.guessTitleBlock}>
            <Text style={styles.screenTitle}>First, our best guesses</Text>
            <Text style={styles.screenSubtitle}>
              Step 1 of 2 · one tap says yes to everything checked
            </Text>
          </View>
          <BestGuessChecklist rows={guessRows} onToggle={toggleGuess} disabled={busy} />
          {actionError ? <Text style={styles.inlineError}>{actionError}</Text> : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
          {footerLabel ? <Text style={styles.footerCaption}>{footerLabel}</Text> : null}
          <PillButton
            label={`Confirm ${checkedRows.length}`}
            onPress={() => void confirmBestGuesses()}
            loading={busy}
            disabled={busy || checkedRows.length === 0}
          />
          <PillButton label="Ask me instead" variant="secondary" onPress={skipBestGuesses} disabled={busy} />
        </View>
      </View>
    );
  }

  if (stage === 'guess_handoff' && guessSummary) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <InboxHeader onBack={() => setStage('front')} />
        <QuestionScroll>
          <GuessHandoffCard
            confirmed={guessSummary.confirmed}
            remaining={guessSummary.remaining}
            busy={busy}
            onShow={showRemainingQuestions}
            onLater={() => navigation.goBack()}
          />
        </QuestionScroll>
      </View>
    );
  }

  if (stage === 'handoff' && handoff) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <InboxHeader onBack={keepShowing} />
        <QuestionScroll>
          <HandoffCard
            count={handoff.items.length}
            thumbnails={handoff.thumbnails}
            busy={busy}
            error={handoffError}
            onFinish={() => void finishHandoff()}
            onKeepShowing={keepShowing}
          />
        </QuestionScroll>
      </View>
    );
  }

  if (stage === 'title_entry') {
    const item = manualItems[manualIndex];
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <InboxHeader onBack={() => setStage('queue')} />
        {item ? (
          <QuestionScroll>
            <TitleEntryCard
              item={item}
              index={manualIndex}
              total={manualItems.length}
              value={manualTitle}
              onChange={setManualTitle}
              onSave={() => void answerManualTitle(false)}
              onUnsure={() => void answerManualTitle(true)}
              busy={busy}
            />
            {actionError ? <Text style={styles.inlineError}>{actionError}</Text> : null}
          </QuestionScroll>
        ) : <CardLoading />}
      </View>
    );
  }

  if (stage === 'queue') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <QueueHeader
          onBack={() => {
            void AsyncStorage.setItem(activeKey(connectionId), '1');
            navigation.goBack();
          }}
          pct={progressPct}
          label={`${remainingCount} left`}
        />
        {queueNotice ? (
          <View style={styles.noticeRow}>
            <Text style={styles.queueNotice}>{queueNotice}</Text>
            {lastAnswer && lastAnswer.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Undo"
                disabled={undoBusy}
                onPress={() => void undoLastAnswer()}
                style={({ pressed }) => [styles.undoButton, (pressed || undoBusy) ? styles.undoPressed : null]}
              >
                <Text style={styles.undoText}>{undoBusy ? 'Undoing' : 'Undo'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {currentCard ? (
          <QuestionScroll>
            {detailsLoading && hydratedItems.length === 0 ? <CardLoading /> : null}
            {currentCard.kind === 'pair' && hydratedItems[0] ? (
              <PairQuestionCard
                item={hydratedItems[0]}
                candidate={hydratedCandidateForFirst}
                platformName={platform}
                busy={busy}
                onAnswer={(answer) => void answerPair(answer)}
              />
            ) : null}
            {currentCard.kind === 'which_one' && hydratedItems[0] ? (
              <WhichOneQuestionCard
                item={hydratedItems[0]}
                candidates={hydratedCandidates}
                platformName={platform}
                selectedId={selectedCandidateId}
                onSelect={setSelectedCandidateId}
                busy={busy}
                onAnswer={(answer) => void answerWhichOne(answer)}
              />
            ) : null}
            {(currentCard.kind === 'look_alike_group' || currentCard.kind === 'duplicate_target' || currentCard.kind === 'bundle') ? (
              <GroupQuestionCard
                card={{ ...currentCard, items: hydratedItems }}
                busy={busy}
                onAnswer={answerGroup}
              />
            ) : null}
            {currentCard.kind === 'title_quality' ? (
              <TitleQualityCard
                items={hydratedItems}
                busy={busy}
                onGenerate={generateTitles}
                onManual={enterManualTitles}
                onUnsure={() => answerGroup('unsure')}
              />
            ) : null}
            {currentCard.kind === 'commit_failed' && hydratedItems[0] ? (
              <CommitFailedCard
                items={hydratedItems}
                busy={busy}
                onRetry={() => void retryCommit()}
                onLater={() => {
                  returnToListRef.current = false;
                  setTargetCardId(null);
                  setStage('list');
                }}
              />
            ) : null}
            {currentCard.kind === 'fallback' && hydratedItems[0] ? (
              <CommitFailedCard
                items={[hydratedItems[0]]}
                busy={busy}
                onRetry={() => void resolveOne(hydratedItems[0], retryCommitDecision(hydratedItems[0]))}
                onLater={() => void finishQueue()}
              />
            ) : null}
            {actionError ? <Text style={styles.inlineError}>{actionError}</Text> : null}
          </QuestionScroll>
        ) : <CardLoading />}
      </View>
    );
  }

  if (stage === 'receipt' && pendingCommitCount > 0 && !commitStalled) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <InboxHeader onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={IC.accent} />
          <Text style={styles.doneTitle}>Finishing your import</Text>
          <Text style={styles.screenSubtitle}>
            {countLabel(pendingCommitCount, 'item')} still being added to your catalog.
          </Text>
        </View>
      </View>
    );
  }

  if (stage === 'receipt' && !hasUnresolved) {
    const catalogTotal = (summary?.autoLinked ?? 0) + (summary?.autoCreated ?? 0);
    return (
      <View style={[styles.screen, styles.receiptScreen, { paddingTop: insets.top + 34 }]}>
        <ScrollView contentContainerStyle={styles.receiptScroll} showsVerticalScrollIndicator={false}>
          <SuccessCheck size={72} />
          <Text style={styles.doneTitle}>Done</Text>
          <Text style={styles.catalogTotal}>{catalogTotal} in your catalog</Text>
          <View style={styles.receiptCard}>
            <ReceiptRow label="Linked" count={summary?.autoLinked ?? 0} />
            <View style={styles.divider} />
            <ReceiptRow label="Added" count={summary?.autoCreated ?? 0} />
            <View style={styles.divider} />
            <ReceiptRow label="Skipped" count={summary?.skipped ?? 0} />
          </View>
          {commitStalled && pendingCommitCount > 0 ? (
            <Text style={styles.screenSubtitle}>
              {countLabel(pendingCommitCount, 'item')} will finish in the background.
            </Text>
          ) : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
          <PillButton
            label="See your catalog"
            onPress={() => navigation.navigate('TabNavigator' as any, { screen: 'Inventory' })}
          />
          <PillButton label="See the list" variant="secondary" onPress={() => setStage('list')} />
        </View>
      </View>
    );
  }

  const needsRows = result?.needsAttention ?? [];
  const needsIds = new Set(needsRows.map((item) => item.platformId));
  const linkedRows = ledger.filter((entry) => entry.outcome === 'linked' && !needsIds.has(entry.platformId));
  const addedRows = ledger.filter((entry) => entry.outcome === 'added' && !needsIds.has(entry.platformId));
  const skippedRows = ledger.filter((entry) => entry.outcome === 'skipped' && !needsIds.has(entry.platformId));
  const ledgerById = new Map(ledger.map((entry) => [entry.platformId, entry]));
  // Rows the machine settled without asking. The ledger only ever holds what
  // the SELLER answered, so a section header must never claim the server's
  // total ("See all 460" over 10 rows reads as a broken list). The automatic
  // remainder gets its own count lane, exactly like the V2A receipt.
  const autoHandledCount = Math.max(
    0,
    (summary?.total ?? 0) - (summary?.pushSide ?? 0) - ledger.length - needsRows.length,
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <InboxHeader
        title="What we did"
        onBack={() => setStage(hasUnresolved ? 'front' : 'receipt')}
        right={<Text style={styles.headerTotal}>{summary?.total ?? 0}</Text>}
      />
      <ScrollView style={styles.listScrollView} contentContainerStyle={styles.listScroll} showsVerticalScrollIndicator={false}>
        {listError ? <Text style={styles.inlineError}>{listError}</Text> : null}
        <ListSection
          label="NEEDS A LOOK"
          color={AMBER}
          count={summary?.needsAttention ?? needsRows.length}
          expanded={showAll.needs}
          onToggle={() => setShowAll((current) => ({ ...current, needs: !current.needs }))}
        >
          {(showAll.needs ? needsRows : needsRows.slice(0, 3)).map((item) => (
            <Pressable
              key={item.platformId}
              accessibilityRole="button"
              onPress={() => openNeedsItem(item)}
              style={({ pressed }) => [styles.listRow, pressed ? styles.pressed : null]}
            >
              <View style={styles.listCopy}>
                <Text style={styles.listTitle} numberOfLines={1}>{item.title || 'Untitled item'}</Text>
                <Text style={styles.listSub} numberOfLines={2}>
                  {ledgerById.get(item.platformId)?.decisionLabel
                    ? `${ledgerById.get(item.platformId)?.decisionLabel}. ${item.reason || 'It did not finish importing.'}`
                    : item.reason || 'Choose what to do'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={21} color={IC.muted} />
            </Pressable>
          ))}
        </ListSection>

        <ListSection
          label="LINKED"
          color={IC.accent}
          count={linkedRows.length}
          expanded={showAll.linked}
          onToggle={() => setShowAll((current) => ({ ...current, linked: !current.linked }))}
        >
          {(showAll.linked ? linkedRows : linkedRows.slice(0, 3)).map((entry) => (
            <OutcomeRow
              key={entry.platformId}
              title={entry.item.title || 'Untitled item'}
              sub={entry.decisionLabel || entry.catalogTitle || 'Your catalog item'}
              action="Undo"
              busy={resolving === entry.platformId}
              onAction={() => void changeSettledEntry(entry)}
            />
          ))}
        </ListSection>

        <ListSection
          label="ADDED"
          color={IC.accent}
          count={addedRows.length}
          expanded={showAll.added}
          onToggle={() => setShowAll((current) => ({ ...current, added: !current.added }))}
        >
          {(showAll.added ? addedRows : addedRows.slice(0, 3)).map((entry) => (
            <OutcomeRow
              key={entry.platformId}
              title={entry.item.title || 'Untitled item'}
              sub={entry.decisionLabel}
              action="Undo"
              busy={resolving === entry.platformId}
              onAction={() => void changeSettledEntry(entry)}
            />
          ))}
        </ListSection>

        <ListSection
          label="SKIPPED"
          color={GREY}
          count={skippedRows.length}
          expanded={showAll.skipped}
          onToggle={() => setShowAll((current) => ({ ...current, skipped: !current.skipped }))}
        >
          {(showAll.skipped ? skippedRows : skippedRows.slice(0, 3)).map((entry) => (
            <OutcomeRow
              key={entry.platformId}
              title={entry.item.title || 'Untitled item'}
              action="Add"
              busy={resolving === entry.platformId}
              onAction={() => void changeSettledEntry(entry)}
            />
          ))}
        </ListSection>

        {autoHandledCount > 0 ? (
          <View style={styles.autoHandledRow}>
            <Text style={styles.autoHandledLabel}>Imported on their own</Text>
            <Text style={styles.autoHandledCount}>{autoHandledCount}</Text>
          </View>
        ) : null}

        <PillButton
          label="Close"
          onPress={() => navigation.navigate('Connections')}
          style={styles.listDone}
        />
      </ScrollView>
    </View>
  );
}

function CountRow({ label, count }: { label: string; count: number }) {
  return (
    <View style={styles.countRow}>
      <View style={styles.countLabelWrap}>
        <View style={styles.greenDot} />
        <Text style={styles.countLabel}>{label}</Text>
      </View>
      <Text style={styles.countValue}>{count}</Text>
    </View>
  );
}

function ReceiptRow({ label, count }: { label: string; count: number }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={styles.receiptValue}>{count}</Text>
    </View>
  );
}

function ListSection({
  label,
  color,
  count,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  color: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <View style={styles.listSection}>
      <View style={styles.sectionHeading}>
        <View style={[styles.sectionDot, { backgroundColor: color }]} />
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      <View style={styles.sectionCard}>
        {children}
        {count > 3 ? (
          <Pressable accessibilityRole="button" onPress={onToggle} style={styles.seeAllRow}>
            <Text style={styles.seeAllText}>{expanded ? 'Show less' : `See all ${count}`}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function OutcomeRow({
  title,
  sub,
  action,
  busy,
  onAction,
}: {
  title: string;
  sub?: string | null;
  action: string;
  busy?: boolean;
  onAction: () => void;
}) {
  return (
    <View style={styles.listRow}>
      <View style={styles.listCopy}>
        <Text style={styles.listTitle} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={styles.listSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${action} ${title}`}
        disabled={busy}
        onPress={onAction}
        hitSlop={10}
        style={({ pressed }) => [styles.rowAction, (pressed || busy) ? styles.pressed : null]}
      >
        {busy ? <ActivityIndicator size="small" color={IC.muted} /> : <Text style={styles.rowActionText}>{action}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  center: { flex: 1, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', padding: 28 },
  errorTitle: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' },
  errorText: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  retryButton: { alignSelf: 'stretch', marginTop: 22 },
  pressed: { opacity: 0.58 },
  footer: { paddingHorizontal: 20, paddingTop: 10, gap: 10, backgroundColor: SURFACE },
  footerCaption: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', marginBottom: 2 },

  explainerScroll: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 26, paddingBottom: 28 },
  explainerTitleBlock: { gap: 8, marginBottom: 34 },
  screenTitle: { color: IC.ink, fontFamily: 'Inter_800ExtraBold', fontSize: 30, lineHeight: 37, letterSpacing: -0.8 },
  screenSubtitle: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 17, lineHeight: 23 },
  steps: { gap: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepNumber: { width: 38, height: 38, borderRadius: 19, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E4E4E7' },
  stepNumberText: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  stepCopy: { flex: 1, minWidth: 0 },
  stepTitle: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 22 },
  stepCaption: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 2 },
  reassurance: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: CARD, borderRadius: 18, padding: 17, marginTop: 34, borderWidth: 1, borderColor: '#E7E7EA' },
  reassuranceText: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15, flex: 1 },

  frontScroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 0, paddingBottom: 30 },
  guessScroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28 },
  guessTitleBlock: { gap: 6, marginBottom: 22 },
  countCard: { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: '#E7E7EA', paddingHorizontal: 16 },
  countRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  countLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  greenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: IC.accent },
  countLabel: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  countValue: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E8E8EA' },
  questionFrontCard: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: GREEN_TINT, borderRadius: 18, paddingHorizontal: 18, marginTop: 16 },
  questionFrontCopy: { flex: 1, gap: 3 },
  questionFrontTitle: { color: '#4A6812', fontFamily: 'Inter_700Bold', fontSize: 19 },
  questionFrontSub: { color: '#61713D', fontFamily: 'Inter_500Medium', fontSize: 14 },

  progressWrap: { paddingHorizontal: 20, paddingBottom: 6 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20, paddingBottom: 4 },
  queueNotice: { color: '#567615', fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'center' },
  undoButton: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: '#ECECEF' },
  undoPressed: { opacity: 0.55 },
  undoText: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 13 },
  inlineError: { color: '#B42318', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 14 },

  receiptScreen: { alignItems: 'stretch' },
  receiptScroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingBottom: 26 },
  doneTitle: { color: IC.ink, fontFamily: 'Inter_800ExtraBold', fontSize: 30, letterSpacing: -0.7, marginTop: 18 },
  catalogTotal: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 17, marginTop: 6 },
  receiptCard: { alignSelf: 'stretch', backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: '#E7E7EA', paddingHorizontal: 16, marginTop: 30 },
  receiptRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  receiptLabel: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  receiptValue: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  needsCard: { alignSelf: 'stretch', minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: AMBER_TINT, borderRadius: 16, borderWidth: 1, borderColor: AMBER, paddingHorizontal: 16, marginTop: 14 },
  needsCardText: { color: AMBER, fontFamily: 'Inter_700Bold', fontSize: 15 },

  headerTotal: { color: IC.muted, fontFamily: 'Inter_700Bold', fontSize: 15, paddingRight: 2 },
  listScrollView: { flex: 1 },
  listScroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 },
  autoHandledRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 14 },
  autoHandledLabel: { color: IC.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  autoHandledCount: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 14, fontVariant: ['tabular-nums'] },
  listSection: { marginBottom: 24 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9, paddingHorizontal: 3 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { color: IC.muted, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.7 },
  sectionCount: { color: IC.muted, fontFamily: 'Inter_700Bold', fontSize: 12, marginLeft: 'auto' },
  sectionCard: { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: '#E7E7EA', paddingHorizontal: 14, overflow: 'hidden' },
  listRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ECECEF', paddingVertical: 10 },
  listCopy: { flex: 1, minWidth: 0 },
  listTitle: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19 },
  listSub: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  rowAction: { minWidth: 48, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  rowActionText: { color: '#5D7E16', fontFamily: 'Inter_700Bold', fontSize: 13 },
  seeAllRow: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  seeAllText: { color: IC.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  listDone: { marginTop: 2 },
});
