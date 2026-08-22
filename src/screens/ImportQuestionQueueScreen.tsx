import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { useUser } from '@clerk/expo';

import type { AppStackParamList } from '../navigation/AppNavigator';
import { useResolution } from '../hooks/useResolution';
import { refreshInboxSummary } from '../hooks/useImportStatus';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../lib/supabase';
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
  QueueHeader,
  SuccessCheck,
} from '../components/importinbox/InboxKit';
import {
  buildV7QuestionCards,
  buildV7ReviewSections,
  buildHandoffOffer,
  candidateForItem,
  advanceHandoffStreak,
  fieldConflictDecision,
  fieldConflictDecisionLabel,
  fieldConflictItems,
  handoffKey,
  mergeCandidateDetails,
  pairDecision,
  remainingItemCount,
  retryCommitDecision,
  v7QuestionItemCount,
  V7_REVIEW_SECTION_ACTIONS,
  V7_REVIEW_SECTION_LABELS,
  whichOneDecision,
  type CardAnswer,
  type ConnectionSyncRules,
  type HandoffStreak,
  type QuestionCardModel,
  type QueueDecision,
  type V7ReviewLedgerEntry,
  type V7ReviewOutcome,
} from '../components/import/questionQueue';
import {
  CardLoading,
  HandoffCard,
  PairQuestionCard,
  QuestionScroll,
  WhichOneQuestionCard,
} from '../components/import/QuestionQueueCards';
import type {
  BulkResolveResult,
  CanonicalRef,
  ResolveChoice,
  SyncItem,
} from '../types/syncItem';
import { buildImportFrontDoorRows, importFrontDoorAction } from '../lib/importFrontDoor';
import { importActionErrorCopy } from '../lib/importErrorCopy';
import { decideReviewQueueCompletion } from '../lib/reviewQueueTruth';

const log = createLogger('ImportQuestionQueue');
const SURFACE = '#F5F5F7';
const CARD = '#FFFFFF';
const AMBER = '#BA7517';
const GREY = '#9CA3AF';

type RouteType = RouteProp<AppStackParamList, 'ImportQuestionQueue'>;
type NavType = StackNavigationProp<AppStackParamList, 'ImportQuestionQueue'>;
type Stage = 'loading' | 'front' | 'queue' | 'handoff' | 'updating' | 'receipt' | 'list';
type LedgerEntry = V7ReviewLedgerEntry;
type LedgerOutcome = V7ReviewOutcome;

interface HandoffState {
  reason: QuestionCardModel['reason'];
  answer: Exclude<CardAnswer, 'unsure'>;
  items: SyncItem[];
  decisions: QueueDecision[];
  thumbnails: Array<string | null>;
  decisionLabel: string;
}

const activeKey = (connectionId: string) => `@anorha/question-queue/active/${connectionId}`;
const queueStartKey = (connectionId: string) => `@anorha/question-queue/start-count/${connectionId}`;
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

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function ImportQuestionQueueScreen() {
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavType>();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { currentOrg } = useOrg();
  const { refresh: refreshConnections } = usePlatformConnections();
  // Params can arrive undefined from a stale deep link or a mid-refactor
  // navigate call; destructuring undefined here crashed the whole screen.
  const { connectionId = '', platformName = '', importId, startAt } = route.params ?? {};
  const platform = platformLabel(platformName);
  const { result, loading, error, resolving, refresh, resolve, resolveBulk, unresolveBulk } = useResolution(connectionId, importId);

  const [stage, setStage] = useState<Stage>('loading');
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  // The last saved answer, as {platformId, version-after-save} rows, exactly
  // what POST /unresolve needs to take it back. Cleared once undone or stale.
  const [lastAnswer, setLastAnswer] = useState<Array<{ platformId: string; version: number }> | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [targetCardId, setTargetCardId] = useState<string | null>(null);
  const [queueStartCount, setQueueStartCount] = useState(0);
  const [handoff, setHandoff] = useState<HandoffState | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<Record<LedgerOutcome | 'needs', boolean>>({
    needs: false,
    linked: false,
    added: false,
    skipped: false,
  });
  const [listError, setListError] = useState<string | null>(null);
  const [syncRules, setSyncRules] = useState<ConnectionSyncRules | null>(null);
  const [syncRulesReady, setSyncRulesReady] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const finishRef = useRef(false);
  const returnToListRef = useRef(false);
  const streakRef = useRef<HandoffStreak | null>(null);
  const suppressedHandoffsRef = useRef<Set<string>>(new Set());
  const attemptedConflictIdsRef = useRef<Set<string>>(new Set());
  const autoResolvingConflictsRef = useRef(false);

  useEffect(() => {
    let alive = true;
    setSyncRulesReady(false);
    attemptedConflictIdsRef.current.clear();
    void (async () => {
      try {
        const { data, error: rulesError } = await supabase
          .from('PlatformConnections')
          .select('SyncRules')
          .eq('Id', connectionId)
          .single();
        if (rulesError) throw rulesError;
        if (alive) {
          setSyncRules(((data as { SyncRules?: ConnectionSyncRules } | null)?.SyncRules) ?? null);
        }
      } catch (rulesError) {
        log.warn('sync rules load failed', rulesError);
        if (alive) setSyncRules(null);
      } finally {
        if (alive) setSyncRulesReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [connectionId]);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      AsyncStorage.getItem(activeKey(connectionId)),
      AsyncStorage.getItem(ledgerKey(connectionId)),
      AsyncStorage.getItem(queueStartKey(connectionId)),
    ]).then(([active, savedLedger, savedQueueStart]) => {
      if (!alive) return;
      setLedger(safeLedger(savedLedger));
      const savedCount = Number(savedQueueStart);
      if (active === '1' && Number.isInteger(savedCount) && savedCount > 0) {
        setQueueStartCount(savedCount);
      }
      if (startAt === 'list') setStage('list');
      else if (startAt === 'front') setStage('front');
      else if (active === '1') setStage('queue');
      else setStage('front');
    }).catch(() => {
      if (!alive) return;
      setStage(startAt === 'list' ? 'list' : 'front');
    });
    return () => {
      alive = false;
    };
  }, [connectionId, startAt]);

  const cards = useMemo(() => buildV7QuestionCards(result?.needsAttention ?? []), [result?.needsAttention]);
  const mainCards = cards;
  const conflicts = useMemo(() => fieldConflictItems(result?.needsAttention ?? []), [result?.needsAttention]);
  const targetedCard = targetCardId ? cards.find((card) => card.id === targetCardId) ?? null : null;
  const currentCard = targetedCard ?? mainCards[0] ?? null;

  // A killed app resumes directly in the queue. Rebuild the progress baseline
  // from the authoritative remaining cards on that first resumed render.
  useEffect(() => {
    const questionCount = remainingItemCount(mainCards);
    if (stage === 'queue' && queueStartCount === 0 && questionCount > 0) {
      setQueueStartCount(questionCount);
    }
  }, [mainCards, queueStartCount, stage]);

  useEffect(() => {
    setSelectedCandidateId(null);
    setActionError(null);
  }, [currentCard?.id]);

  const [incomingDetails, setIncomingDetails] = useState<Record<string, ReturnType<typeof incomingItemDetailsFromPayload>>>({});
  const [candidateDetails, setCandidateDetails] = useState<Record<string, CanonicalRef>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  type CardHydration = {
    incoming: Record<string, ReturnType<typeof incomingItemDetailsFromPayload>>;
    candidates: Record<string, CanonicalRef>;
  };
  const hydrationCacheRef = useRef<Map<string, CardHydration>>(new Map());
  const hydrationInFlightRef = useRef<Map<string, Promise<CardHydration>>>(new Map());

  useEffect(() => {
    hydrationCacheRef.current.clear();
    hydrationInFlightRef.current.clear();
  }, [connectionId, platform]);

  const hydrateCard = useCallback((card: QuestionCardModel): Promise<CardHydration> => {
    const cached = hydrationCacheRef.current.get(card.id);
    if (cached) return Promise.resolve(cached);
    const inFlight = hydrationInFlightRef.current.get(card.id);
    if (inFlight) return inFlight;

    const initialIncoming = Object.fromEntries(
      card.items.map((item) => [item.platformId, incomingItemDetailsFromPayload(item, platform)]),
    );
    const candidateIds = Array.from(new Set(card.items.flatMap((item) => [
      ...(item.candidates ?? []).map((candidate) => candidate.id),
      item.resolution.kind === 'link' ? item.resolution.canonical.id : '',
    ]).filter(Boolean)));
    const incomingHydration = platform.toLowerCase() === 'csv'
      ? Promise.resolve(Object.entries(initialIncoming))
      : Promise.all(card.items.map(async (item) => {
          try {
            return [item.platformId, await fetchImportIncomingItemDetails(item, platform)] as const;
          } catch (hydrateError) {
            log.warn('incoming hydration failed', item.platformId, hydrateError);
            return [item.platformId, incomingItemDetailsFromPayload(item, platform)] as const;
          }
        }));
    const promise = Promise.all([
      incomingHydration,
      fetchImportCandidateDetails(candidateIds, platform).catch((hydrateError) => {
        log.warn('candidate hydration failed', hydrateError);
        return {};
      }),
    ]).then(([incoming, candidates]) => {
      const hydrated = { incoming: Object.fromEntries(incoming), candidates };
      hydrationCacheRef.current.set(card.id, hydrated);
      return hydrated;
    }).finally(() => {
      hydrationInFlightRef.current.delete(card.id);
    });
    hydrationInFlightRef.current.set(card.id, promise);
    return promise;
  }, [platform]);

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
    const cached = hydrationCacheRef.current.get(currentCard.id);
    setIncomingDetails(cached?.incoming ?? initialIncoming);
    setCandidateDetails(cached?.candidates ?? {});
    setDetailsLoading(!cached);
    void hydrateCard(currentCard).then(({ incoming, candidates }) => {
      if (!alive) return;
      setIncomingDetails(incoming);
      setCandidateDetails(candidates);
    }).finally(() => {
      if (alive) setDetailsLoading(false);
    });

    const currentIndex = mainCards.findIndex((card) => card.id === currentCard.id);
    const nextCard = currentIndex >= 0 ? mainCards[currentIndex + 1] : undefined;
    if (nextCard) void hydrateCard(nextCard);
    return () => {
      alive = false;
    };
  }, [currentCard?.id, hydrateCard, mainCards, platform]);

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
    }).map((candidate) => mergeCandidateDetails(candidate, candidateDetails[candidate.id]));
  }, [currentCard?.items, candidateDetails]);

  const hydratedCandidateForFirst = useMemo(() => {
    const item = hydratedItems[0];
    if (!item) return null;
    const candidate = candidateForItem(item);
    return candidate ? mergeCandidateDetails(candidate, candidateDetails[candidate.id]) : null;
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
          valueOverride: itemDecision.valueOverride,
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

  const ownerKey = user?.id
    ? `${user.id}:${currentOrg?.id || 'personal'}`
    : '';

  const finishQueue = useCallback(async () => {
    if (finishRef.current) return;
    finishRef.current = true;
    setStage('updating');
    setUpdateError(null);
    try {
      const resolution = await refresh();
      const remainingQuestionCount = resolution
        ? v7QuestionItemCount(resolution.needsAttention ?? [])
        : null;
      if (remainingQuestionCount !== 0) {
        const decision = decideReviewQueueCompletion({
          remainingQuestionCount,
          inboxSummaryRefreshed: false,
          connectionsRefreshed: false,
        });
        if (decision === 'questions_remain') {
          setQueueStartCount(Math.max(remainingQuestionCount || 0, 1));
          setStage('queue');
        } else {
          setUpdateError('Couldn’t verify the connection. Try again.');
        }
        return;
      }

      const [refreshedInboxSummary, refreshedConnections] = await Promise.all([
        refreshInboxSummary(ownerKey),
        refreshConnections(),
      ]);
      const refreshedInboxConnection = refreshedInboxSummary?.connections.find(
        (connection) => connection.connectionId === connectionId,
      );
      const decision = decideReviewQueueCompletion({
        remainingQuestionCount,
        inboxSummaryRefreshed: refreshedInboxConnection?.attentionVerified === true
          && refreshedInboxConnection.needsAttention === 0,
        connectionsRefreshed: refreshedConnections !== null,
      });
      if (decision !== 'receipt') {
        setUpdateError('Couldn’t verify the connection. Try again.');
        return;
      }
      await Promise.all([
        AsyncStorage.removeItem(activeKey(connectionId)),
        AsyncStorage.removeItem(queueStartKey(connectionId)),
      ]);
      setTargetCardId(null);
      setStage('receipt');
    } finally {
      finishRef.current = false;
    }
  }, [connectionId, ownerKey, refresh, refreshConnections]);

  const startQueue = useCallback(() => {
    if (mainCards.length === 0) {
      void finishQueue();
      return;
    }
    const startCount = remainingItemCount(mainCards);
    setQueueStartCount(startCount);
    setLastAnswer(null);
    void Promise.all([
      AsyncStorage.setItem(activeKey(connectionId), '1'),
      AsyncStorage.setItem(queueStartKey(connectionId), String(startCount)),
    ]).catch((storageError) => {
      log.warn('queue progress persistence failed', storageError);
    });
    setStage('queue');
  }, [connectionId, finishQueue, mainCards]);

  const beginQuestions = startQueue;

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

  useEffect(() => {
    if (!syncRulesReady || autoResolvingConflictsRef.current) return;
    const pending = conflicts.filter((item) => !attemptedConflictIdsRef.current.has(item.platformId));
    if (pending.length === 0) return;

    for (const item of pending) attemptedConflictIdsRef.current.add(item.platformId);
    autoResolvingConflictsRef.current = true;
    const decisions = pending.map((item) => fieldConflictDecision(item, syncRules));
    void resolveBulk(decisions, importId ?? undefined).then(async (response) => {
      for (const item of pending) {
        const itemDecision = decisions.find((entry) => entry.platformId === item.platformId);
        const itemResult = response.results.find((entry) => entry.platformId === item.platformId);
        if (!itemDecision || !itemResult) continue;
        recordDecisions(
          [itemDecision],
          [item],
          [itemResult],
          fieldConflictDecisionLabel(item, syncRules),
        );
      }
      await refresh();
    }).catch((conflictError) => {
      log.warn('field conflict auto resolve failed', conflictError);
    }).finally(() => {
      autoResolvingConflictsRef.current = false;
    });
  }, [conflicts, importId, recordDecisions, refresh, resolveBulk, syncRules, syncRulesReady]);

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
      // The cards visibly returning IS the confirmation; only a too-late
      // outcome needs words.
      if (tooLate > 0) {
        setActionError(`${countLabel(tooLate, 'item')} already imported and cannot be taken back.`);
      }
      setLastAnswer(null);
      streakRef.current = null;
      setStage('queue');
    } catch (undoError) {
      setActionError(importActionErrorCopy(undoError, 'That answer could not be taken back.'));
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
      setActionError(importActionErrorCopy(resolveError));
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
      setActionError(importActionErrorCopy(resolveError));
    }
  }, [currentCard, finishQueue, mainCards, offerHandoffAfter, resolveOne, returnAfterTarget, selectedCandidateId]);

  const finishHandoff = useCallback(async () => {
    if (!handoff) return;
    setHandoffError(null);
    try {
      const response = await resolveBulk(handoff.decisions, importId ?? undefined);
      recordDecisions(handoff.decisions, handoff.items, response.results, handoff.decisionLabel);
      undoableFromResults(response.results);
      const outcome = response.summary;
      const failed = outcome.conflicts + outcome.errors;
      const otherClasses = mainCards.filter((card) => card.reason !== handoff.reason);
      streakRef.current = null;
      setHandoff(null);
      if (failed === 0 && otherClasses.length === 0) await finishQueue();
      else setStage('queue');
    } catch (bulkError) {
      setHandoffError(importActionErrorCopy(bulkError, 'Those items are back in the queue.'));
    }
  }, [finishQueue, handoff, importId, mainCards, recordDecisions, resolveBulk, undoableFromResults]);

  const keepShowing = useCallback(() => {
    if (handoff) suppressedHandoffsRef.current.add(handoffKey(handoff.reason, handoff.answer));
    streakRef.current = null;
    setHandoff(null);
    setHandoffError(null);
    setStage('queue');
  }, [handoff]);

  const openNeedsItem = useCallback((item: SyncItem) => {
    const card = cards.find((entry) => entry.items.some((member) => member.platformId === item.platformId));
    if (!card) return;
    returnToListRef.current = true;
    setTargetCardId(card.id);
    setQueueStartCount(remainingItemCount(cards));
    setStage('queue');
  }, [cards]);

  const changeSettledEntry = useCallback(async (entry: LedgerEntry) => {
    setListError(null);
    if (entry.item.attention === 'field_conflict') {
      const itemDecision = pairDecision(entry.item, entry.valueOverride === true ? 'primary' : 'secondary');
      try {
        await resolve(entry.platformId, itemDecision.choice, itemDecision.canonicalId, {
          importId: entry.item.importId ?? importId ?? undefined,
          valueOverride: itemDecision.valueOverride,
        });
        recordDecisions(
          [itemDecision],
          [entry.item],
          undefined,
          itemDecision.valueOverride === true ? 'Kept your details' : 'Used store details',
        );
        await refresh();
      } catch (changeError) {
        setListError(importActionErrorCopy(changeError, 'That change could not be saved.'));
      }
      return;
    }
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
      setListError(importActionErrorCopy(changeError, 'That change could not be saved.'));
    }
  }, [importId, recordDecisions, refresh, resolve]);

  const revisitNeedsItem = useCallback(async (item: SyncItem) => {
    if (item.attention !== 'commit_failed' && item.attention !== 'field_conflict') {
      openNeedsItem(item);
      return;
    }
    setListError(null);
    const itemDecision = item.attention === 'field_conflict'
      ? fieldConflictDecision(item, syncRules)
      : retryCommitDecision(item);
    const decisionLabel = item.attention === 'field_conflict'
      ? fieldConflictDecisionLabel(item, syncRules)
      : 'Added from review';
    try {
      await resolve(item.platformId, itemDecision.choice, itemDecision.canonicalId, {
        importId: item.importId ?? importId ?? undefined,
        version: item.version,
        valueOverride: itemDecision.valueOverride,
      });
      recordDecisions([itemDecision], [item], undefined, decisionLabel);
      await refresh();
    } catch (retryError) {
      setListError(importActionErrorCopy(retryError, 'This item still needs a look.'));
    }
  }, [importId, openNeedsItem, recordDecisions, refresh, resolve, syncRules]);

  // Stall guard for the "Finishing your import" wait: if the pending-commit
  // count does not move across ~12s of polling, the worker is not coming
  // (dead connection, stranded row). Show the receipt with an honest note
  // instead of spinning forever with no exit (run 7 P1-2 trap).
  const [commitStalled, setCommitStalled] = useState(false);
  const stallRef = useRef<{ count: number; polls: number }>({ count: -1, polls: 0 });

  const summary = result?.summary;
  const questionItemCount = v7QuestionItemCount(result?.needsAttention ?? []);
  const frontDoorRows = buildImportFrontDoorRows(summary);
  const frontDoorCta = importFrontDoorAction(
    questionItemCount,
    (result?.needsAttention ?? []).length,
  );
  const remainingCount = questionItemCount;
  const progressTotal = Math.max(queueStartCount, remainingCount, 1);
  const progressPct = ((progressTotal - remainingCount) / progressTotal) * 100;
  const busy = resolving != null;
  const hasQuestions = cards.length > 0;
  const pendingCommitCount = summary?.pendingCommit ?? 0;
  const needsLookCount = result?.needsAttention?.length ?? 0;
  const goHome = () => navigation.navigate('TabNavigator' as any, { screen: 'Clearouts' });

  useEffect(() => {
    if (stage !== 'receipt' || pendingCommitCount === 0) {
      stallRef.current = { count: -1, polls: 0 };
      if (commitStalled) setCommitStalled(false);
      return;
    }
    if (commitStalled) return;
    stallRef.current = { count: pendingCommitCount, polls: 0 };
    const timer = setInterval(() => {
      void refresh();
      if (stallRef.current.count === pendingCommitCount) {
        stallRef.current.polls += 1;
        if (stallRef.current.polls >= 8) setCommitStalled(true);
      } else {
        stallRef.current = { count: pendingCommitCount, polls: 0 };
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [commitStalled, pendingCommitCount, refresh, stage]);

  const retryCommitPoll = useCallback(() => {
    stallRef.current = { count: pendingCommitCount, polls: 0 };
    setCommitStalled(false);
    void refresh();
  }, [pendingCommitCount, refresh]);

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
        <Text style={styles.errorText}>Try again.</Text>
        <PillButton label="Retry" onPress={refresh} style={styles.retryButton} />
      </View>
    );
  }

  if (stage === 'front') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <InboxHeader onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={styles.frontScroll} showsVerticalScrollIndicator={false}>
          <HeroNumeral value={summary?.total ?? 0} label={`items from ${platform}`} animate />
          <View style={styles.countCard}>
            {frontDoorRows.map((row, index) => (
              <React.Fragment key={row.kind}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <CountRow
                  label={row.label}
                  count={row.count}
                  color={row.kind === 'needsLook' ? AMBER : row.kind === 'skipped' ? GREY : IC.accent}
                />
              </React.Fragment>
            ))}
          </View>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
          <PillButton
            label={frontDoorCta.label}
            onPress={
              frontDoorCta.opensQuestions
                ? beginQuestions
                : frontDoorCta.opensList
                  ? () => setStage('list')
                  : () => void finishQueue()
            }
          />
          {frontDoorCta.showLater ? (
            <PillButton label="Later" variant="secondary" onPress={() => navigation.goBack()} />
          ) : null}
        </View>
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

  if (stage === 'updating') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <InboxHeader onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          {updateError ? (
            <MaterialCommunityIcons name="alert-circle-outline" size={38} color={AMBER} />
          ) : (
            <ActivityIndicator color={IC.accent} />
          )}
          <Text style={styles.doneTitle}>Updating connection</Text>
          <Text style={styles.errorText}>
            {updateError || 'Checking that review is clear.'}
          </Text>
          {updateError ? (
            <PillButton label="Retry" onPress={() => void finishQueue()} style={styles.retryButton} />
          ) : null}
        </View>
      </View>
    );
  }

  if (stage === 'queue') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
        <QueueHeader
          onBack={() => {
            void Promise.all([
              AsyncStorage.setItem(activeKey(connectionId), '1'),
              AsyncStorage.setItem(queueStartKey(connectionId), String(progressTotal)),
            ]).catch((storageError) => {
              log.warn('queue progress persistence failed', storageError);
            });
            navigation.goBack();
          }}
          pct={progressPct}
          label={`${remainingCount} left`}
        />
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
                onBack={() => void undoLastAnswer()}
                backDisabled={!lastAnswer?.length || undoBusy}
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
                onBack={() => void undoLastAnswer()}
                backDisabled={!lastAnswer?.length || undoBusy}
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
        <InboxHeader onBack={goHome} />
        <View style={styles.center}>
          <ActivityIndicator color={IC.accent} />
          <Text style={styles.doneTitle}>Finishing import</Text>
          <Text style={styles.catalogTotal}>{pendingCommitCount} remaining</Text>
        </View>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
          <PillButton label="Home" onPress={goHome} />
        </View>
      </View>
    );
  }

  if (stage === 'receipt') {
    const catalogTotal = (summary?.autoLinked ?? 0) + (summary?.autoCreated ?? 0);
    return (
      <View style={[styles.screen, styles.receiptScreen, { paddingTop: insets.top + 34 }]}>
        <ScrollView contentContainerStyle={styles.receiptScroll} showsVerticalScrollIndicator={false}>
          {commitStalled && pendingCommitCount > 0 ? (
            <MaterialCommunityIcons name="alert-circle-outline" size={72} color={AMBER} />
          ) : (
            <SuccessCheck size={72} />
          )}
          <Text style={styles.doneTitle}>
            {commitStalled && pendingCommitCount > 0 ? 'Import stuck' : 'Done'}
          </Text>
          <Text style={styles.catalogTotal}>{catalogTotal} in your catalog</Text>
          <View style={styles.receiptCard}>
            <ReceiptRow label="Linked" count={summary?.autoLinked ?? 0} />
            <View style={styles.divider} />
            <ReceiptRow label="Added" count={summary?.autoCreated ?? 0} />
            <View style={styles.divider} />
            <ReceiptRow label="Skipped" count={summary?.skipped ?? 0} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review our work"
            onPress={() => setStage('list')}
            style={({ pressed }) => [styles.reviewRow, pressed ? styles.pressed : null]}
          >
            <Text style={styles.reviewRowText}>Review our work</Text>
            {needsLookCount > 0 ? <Text style={styles.reviewRowCount}>{needsLookCount}</Text> : null}
            <MaterialCommunityIcons name="chevron-right" size={22} color={IC.muted} />
          </Pressable>
          {commitStalled && pendingCommitCount > 0 ? (
            <View style={styles.stallNotice}>
              <Text style={styles.stallText}>
                {pendingCommitCount === 1 ? '1 item is stuck.' : `${pendingCommitCount} items are stuck.`}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={retryCommitPoll}
                hitSlop={10}
                style={({ pressed }) => pressed ? styles.pressed : null}
              >
                <Text style={styles.stallRetry}>Retry</Text>
              </Pressable>
            </View>
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

  const {
    needs: needsRows,
    linked: linkedRows,
    added: addedRows,
    skipped: skippedRows,
  } = buildV7ReviewSections(result?.needsAttention ?? [], ledger);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <InboxHeader
        title="What we did"
        onBack={() => setStage(hasQuestions ? 'front' : 'receipt')}
        right={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit"
            onPress={() => setShowAll({ needs: true, linked: true, added: true, skipped: true })}
            hitSlop={10}
          >
            <Text style={styles.headerEdit}>Edit</Text>
          </Pressable>
        )}
      />
      <ScrollView style={styles.listScrollView} contentContainerStyle={styles.listScroll} showsVerticalScrollIndicator={false}>
        {listError ? <Text style={styles.inlineError}>{listError}</Text> : null}
        <ListSection
          label={V7_REVIEW_SECTION_LABELS.needs}
          color={AMBER}
          count={needsRows.length}
          expanded={showAll.needs}
          onToggle={() => setShowAll((current) => ({ ...current, needs: !current.needs }))}
        >
          {(showAll.needs ? needsRows : needsRows.slice(0, 3)).map((item) => {
            const retryable = item.attention === 'commit_failed' || item.attention === 'field_conflict';
            const reviewable = cards.some((card) => card.items.some((member) => member.platformId === item.platformId));
            return (
              <OutcomeRow
                key={item.platformId}
                title={item.title || 'Untitled item'}
                sub="Needs a look"
                imageUrl={item.imageUrl}
                action={retryable ? 'Try again' : reviewable ? 'Review' : undefined}
                busy={resolving === item.platformId}
                onAction={retryable || reviewable ? () => void revisitNeedsItem(item) : undefined}
              />
            );
          })}
        </ListSection>

        <ListSection
          label={V7_REVIEW_SECTION_LABELS.linked}
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
              imageUrl={entry.item.imageUrl}
              action={V7_REVIEW_SECTION_ACTIONS.linked}
              busy={resolving === entry.platformId}
              onAction={() => void changeSettledEntry(entry)}
            />
          ))}
        </ListSection>

        <ListSection
          label={V7_REVIEW_SECTION_LABELS.added}
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
              imageUrl={entry.item.imageUrl}
              action={V7_REVIEW_SECTION_ACTIONS.added}
              busy={resolving === entry.platformId}
              onAction={() => void changeSettledEntry(entry)}
            />
          ))}
        </ListSection>

        <ListSection
          label={V7_REVIEW_SECTION_LABELS.skipped}
          color={GREY}
          count={skippedRows.length}
          expanded={showAll.skipped}
          onToggle={() => setShowAll((current) => ({ ...current, skipped: !current.skipped }))}
        >
          {(showAll.skipped ? skippedRows : skippedRows.slice(0, 3)).map((entry) => (
            <OutcomeRow
              key={entry.platformId}
              title={entry.item.title || 'Untitled item'}
              imageUrl={entry.item.imageUrl}
              action={V7_REVIEW_SECTION_ACTIONS.skipped}
              busy={resolving === entry.platformId}
              onAction={() => void changeSettledEntry(entry)}
            />
          ))}
        </ListSection>

        <PillButton
          label="Done"
          onPress={() => navigation.navigate('Connections')}
          style={styles.listDone}
        />
      </ScrollView>
    </View>
  );
}

function CountRow({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={styles.countRow}>
      <View style={styles.countLabelWrap}>
        <View style={[styles.greenDot, { backgroundColor: color }]} />
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
  imageUrl,
  action,
  busy,
  onAction,
}: {
  title: string;
  sub?: string | null;
  imageUrl?: string | null;
  action?: string;
  busy?: boolean;
  onAction?: () => void;
}) {
  return (
    <View style={styles.listRow}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} resizeMode="cover" style={styles.listThumb} />
      ) : (
        <View style={[styles.listThumb, styles.listThumbEmpty]}>
          <MaterialCommunityIcons name="image-outline" size={18} color={IC.muted} />
        </View>
      )}
      <View style={styles.listCopy}>
        <Text style={styles.listTitle} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={styles.listSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {action && onAction ? (
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
      ) : null}
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
  frontScroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 0, paddingBottom: 30 },
  countCard: { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: '#E7E7EA', paddingHorizontal: 16 },
  countRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  countLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  greenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: IC.accent },
  countLabel: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  countValue: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E8E8EA' },
  inlineError: { color: '#B42318', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 14 },

  receiptScreen: { alignItems: 'stretch' },
  receiptScroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingBottom: 26 },
  doneTitle: { color: IC.ink, fontFamily: 'Inter_800ExtraBold', fontSize: 30, letterSpacing: -0.7, marginTop: 18 },
  catalogTotal: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 17, marginTop: 6 },
  receiptCard: { alignSelf: 'stretch', backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: '#E7E7EA', paddingHorizontal: 16, marginTop: 30 },
  stallNotice: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  stallText: { color: AMBER, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  stallRetry: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 14 },
  receiptRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  receiptLabel: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  receiptValue: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  headerTotal: { color: IC.muted, fontFamily: 'Inter_700Bold', fontSize: 15, paddingRight: 2 },
  reviewRow: { alignSelf: 'stretch', minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: '#E7E7EA', paddingHorizontal: 16, marginTop: 14 },
  reviewRowText: { flex: 1, color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  reviewRowCount: { color: IC.muted, fontFamily: 'Inter_700Bold', fontSize: 13 },
  headerEdit: { color: '#93C822', fontFamily: 'Inter_700Bold', fontSize: 14, paddingRight: 2 },
  listScrollView: { flex: 1 },
  listScroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 },
  listSection: { marginBottom: 24 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9, paddingHorizontal: 3 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { color: IC.muted, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.7 },
  sectionCount: { color: IC.muted, fontFamily: 'Inter_700Bold', fontSize: 12, marginLeft: 'auto' },
  sectionCard: { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: '#E7E7EA', paddingHorizontal: 14, overflow: 'hidden' },
  listRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ECECEF', paddingVertical: 10 },
  listThumb: { width: 44, height: 44, borderRadius: 11, backgroundColor: '#EEEFF1' },
  listThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  listCopy: { flex: 1, minWidth: 0 },
  listTitle: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19 },
  listSub: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  rowAction: { minWidth: 48, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  rowActionText: { color: '#93C822', fontFamily: 'Inter_700Bold', fontSize: 13 },
  seeAllRow: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  seeAllText: { color: IC.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  listDone: { marginTop: 2 },
});
