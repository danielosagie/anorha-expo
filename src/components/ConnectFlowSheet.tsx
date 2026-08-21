/**
 * ConnectFlowSheet is the single platform setup flow. Consent and computer
 * setup remain bottom sheets; import lifecycle states use their own centered
 * modal so OAuth chrome never lingers over server-owned background work.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import BaseModal from './BaseModal';
import LinkComputerScanSheet from './LinkComputerScanSheet';
import { LinkComputerBody } from './LinkComputerSheet';
import PlatformLogo from './PlatformLogo';
import { PlatformConsentBody } from './PlatformConnectSheet';
import ShopifyStorePicker from './ShopifyStorePicker';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { getPlatform, connectStepsFor, type ConnectStepKind } from '../config/platforms';
import { BRAND_PRIMARY } from '../design/tokens';
import { useImportStatus, refreshInboxSummary } from '../hooks/useImportStatus';
import {
  IMPORT_SOCKET_QUIET_MS,
  useImportJobProgress,
} from '../hooks/useImportJobProgress';
import { usePlatformConnect, type ConnectablePlatform } from '../hooks/usePlatformConnect';
import { usePlatformConnectStatus } from '../hooks/usePlatformConnectStatus';
import { connectErrorCopy } from '../lib/connectErrorCopy';
import { decideConnectImportPhase } from '../lib/connectImportFlow';
import { trackDismissedConnectImport } from '../lib/connectImportDismissals';
import {
  connectionImportPresentationsById,
  connectionImportPhaseLabel,
  latestImportsByConnection,
} from '../lib/connectionImportPresentation';

type FlowPhase =
  | 'consent'
  | 'shopifyPicker'
  | 'connecting'
  | 'importing'
  | 'checking'
  | 'importFailed'
  | 'linkComputer'
  | 'done';

interface Props {
  visible: boolean;
  platform: string | null;
  orgId?: string | null;
  onCancel: () => void;
  onConnected: (connectionId?: string, attentionCount?: number) => void;
  retryConnectionId?: string | null;
}

const TEXT_SECONDARY = '#6B7280';
const RECONCILE_NUDGE_MS = 2500;
const IMPORT_EVIDENCE_GRACE_MS = 7000;
const DONE_DISMISS_MS = 1600;
const ATTEMPT_CLOCK_SKEW_MS = 30_000;
const TERMINAL_SUCCESS = new Set(['complete', 'completed', 'success', 'succeeded']);

function normalized(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function timestamp(value?: string | null): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function platformKey(value?: string | null): string {
  return normalized(value).replace(/[\s_-]+/g, '');
}

export default function ConnectFlowSheet({
  visible,
  platform,
  orgId,
  onCancel,
  onConnected,
  retryConnectionId = null,
}: Props) {
  const navigation = useNavigation<any>();
  const { connect, startScan } = usePlatformConnect({ orgId });
  const { connections, progressByConnectionId, refresh } = usePlatformConnections();
  const importStatus = useImportStatus();

  const presentationByConnectionId = useMemo(
    () => connectionImportPresentationsById({
      connections,
      aggregateConnections: importStatus.connections,
      recentImports: importStatus.recentImports,
      progressByConnectionId,
    }),
    [connections, importStatus.connections, importStatus.recentImports, progressByConnectionId],
  );
  const statusOptions = useMemo(
    () => ({ presentationByConnectionId }),
    [presentationByConnectionId],
  );

  const activePlatformRef = useRef<string | null>(null);
  const platformLabelRef = useRef('Platform');
  const statusPlatform = platform || activePlatformRef.current || '';
  const status = usePlatformConnectStatus(statusPlatform, statusOptions);
  const statusRef = useRef(status);
  statusRef.current = status;

  const importStatusRef = useRef(importStatus);
  importStatusRef.current = importStatus;

  const [phase, setPhase] = useState<FlowPhase>('consent');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [failedConnectionId, setFailedConnectionId] = useState<string | null>(null);
  const [activeConnectionId, setActiveConnectionId] = useState<string | undefined>(undefined);
  const [activeJobId, setActiveJobId] = useState<string | undefined>(undefined);
  const [scanOpen, setScanOpen] = useState(false);
  const [, setReconcileVersion] = useState(0);

  const importStartedAtRef = useRef<number | null>(null);
  const importObservedRef = useRef(false);
  const startScanResultRef = useRef<boolean | undefined>(undefined);
  const graceExpiredRef = useRef(false);
  const importAttemptIdRef = useRef(0);
  const oauthAttemptIdRef = useRef(0);
  const dismissedDuringImportRef = useRef(false);
  const doneCallbackSentRef = useRef(false);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePlatform = platform || activePlatformRef.current;
  const def = activePlatform ? getPlatform(activePlatform) : undefined;
  const steps = activePlatform ? connectStepsFor(activePlatform) : [];

  const clearReconcileTimers = useCallback(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    nudgeTimerRef.current = null;
    graceTimerRef.current = null;
  }, []);

  useEffect(() => clearReconcileTimers, [clearReconcileTimers]);

  const refreshSharedStores = useCallback(() => {
    void Promise.allSettled([refresh(), refreshInboxSummary()]);
  }, [refresh]);

  const beginImportReconciliation = useCallback((connectionId?: string) => {
    const attemptId = ++importAttemptIdRef.current;
    clearReconcileTimers();
    importObservedRef.current = false;
    startScanResultRef.current = undefined;
    graceExpiredRef.current = false;
    dismissedDuringImportRef.current = false;
    doneCallbackSentRef.current = false;

    refreshSharedStores();
    if (connectionId) {
      void startScan(connectionId).then((started) => {
        if (importAttemptIdRef.current !== attemptId) return;
        startScanResultRef.current = started;
        setReconcileVersion((version) => version + 1);
      });
    }

    nudgeTimerRef.current = setTimeout(() => {
      if (importAttemptIdRef.current !== attemptId) return;
      refreshSharedStores();
    }, RECONCILE_NUDGE_MS);

    graceTimerRef.current = setTimeout(() => {
      if (importAttemptIdRef.current !== attemptId) return;
      graceExpiredRef.current = true;
      setReconcileVersion((version) => version + 1);
    }, IMPORT_EVIDENCE_GRACE_MS);
  }, [clearReconcileTimers, refreshSharedStores, startScan]);

  // Start each visible flow from live shared status. Mid-flow updates do not
  // reset the phase because status is intentionally read through a ref.
  useEffect(() => {
    if (!visible || !platform) return;

    oauthAttemptIdRef.current += 1;
    importAttemptIdRef.current += 1;
    clearReconcileTimers();
    activePlatformRef.current = platform;
    platformLabelRef.current = getPlatform(platform)?.label || platform;
    setConnectError(null);
    setFailedConnectionId(null);
    setActiveConnectionId(retryConnectionId || undefined);
    setActiveJobId(undefined);
    setScanOpen(false);
    importStartedAtRef.current = null;
    importObservedRef.current = false;
    startScanResultRef.current = undefined;
    graceExpiredRef.current = false;
    dismissedDuringImportRef.current = false;
    doneCallbackSentRef.current = false;

    const currentStatus = statusRef.current;
    if (retryConnectionId) {
      setFailedConnectionId(retryConnectionId);
      setPhase('importFailed');
    } else if (!currentStatus.oauthConnected && currentStatus.steps.includes('oauth')) {
      setPhase('consent');
    } else if (currentStatus.requiresComputer && !currentStatus.computerOnline) {
      setPhase('linkComputer');
    } else {
      const activeConnection = connections
        .filter((connection) => platformKey(connection.PlatformType) === platformKey(platform))
        .find((connection) => {
          const presentation = presentationByConnectionId.get(connection.Id);
          return presentation?.importInProgress || presentation?.kind === 'checking';
        });
      const activePresentation = activeConnection
        ? presentationByConnectionId.get(activeConnection.Id)
        : undefined;
      if (activeConnection) setActiveConnectionId(activeConnection.Id);
      if (currentStatus.importing) {
        importStartedAtRef.current = Math.max(
          0,
          timestamp(activePresentation?.occurredAt) === Number.NEGATIVE_INFINITY
            ? Date.now()
            : timestamp(activePresentation?.occurredAt),
        );
        importObservedRef.current = true;
        setActiveJobId(activePresentation?.jobId || undefined);
        setPhase('importing');
      } else if (activePresentation?.kind === 'checking') {
        importStartedAtRef.current = Date.now();
        importObservedRef.current = true;
        setActiveJobId(activePresentation.jobId || undefined);
        setPhase('checking');
      } else {
        setPhase('done');
      }
    }
  // Live stores intentionally do not belong in this open-boundary effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, platform, retryConnectionId]);

  // Resolve callbacks that omit connectionId from the shared connection/run
  // stores. Prefer an attempt-scoped run, then an actively importing row.
  const candidateConnectionId = useMemo(() => {
    if (activeConnectionId || !activePlatformRef.current) return activeConnectionId;
    const expectedPlatform = platformKey(activePlatformRef.current);
    const cutoff = (importStartedAtRef.current || Date.now()) - ATTEMPT_CLOCK_SKEW_MS;
    const matchingIds = new Set(
      connections
        .filter((connection) => platformKey(connection.PlatformType) === expectedPlatform)
        .map((connection) => connection.Id),
    );

    const attemptRun = [...importStatus.recentImports]
      .filter((run) => (
        timestamp(run.createdAt) >= cutoff
        && (matchingIds.has(run.connectionId) || platformKey(run.source) === expectedPlatform)
      ))
      .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt))[0];
    if (attemptRun?.connectionId) return attemptRun.connectionId;

    return connections
      .filter((connection) => (
        matchingIds.has(connection.Id)
        && presentationByConnectionId.get(connection.Id)?.importInProgress
      ))
      .sort((left, right) => timestamp(right.UpdatedAt) - timestamp(left.UpdatedAt))[0]?.Id;
  }, [activeConnectionId, connections, importStatus.recentImports, presentationByConnectionId]);

  useEffect(() => {
    if (!activeConnectionId && candidateConnectionId) {
      setActiveConnectionId(candidateConnectionId);
    }
  }, [activeConnectionId, candidateConnectionId]);

  const resolvedConnectionId = activeConnectionId || candidateConnectionId;
  const latestAttemptRun = useMemo(() => {
    if (!resolvedConnectionId) return undefined;
    const run = latestImportsByConnection(importStatus.recentImports).get(resolvedConnectionId);
    if (!run) return undefined;
    const cutoff = (importStartedAtRef.current || Date.now()) - ATTEMPT_CLOCK_SKEW_MS;
    const belongsToAttempt = timestamp(run.createdAt) >= cutoff
      || timestamp(run.completedAt) >= cutoff;
    return belongsToAttempt ? run : undefined;
  }, [importStatus.recentImports, resolvedConnectionId]);

  const importPresentation = resolvedConnectionId
    ? presentationByConnectionId.get(resolvedConnectionId)
    : undefined;
  const socketProgress = resolvedConnectionId
    ? progressByConnectionId[resolvedConnectionId]
    : undefined;
  const observedJobId = socketProgress?.jobId
    || importPresentation?.jobId
    || latestAttemptRun?.jobId
    || undefined;
  useEffect(() => {
    if (observedJobId && observedJobId !== activeJobId) setActiveJobId(observedJobId);
  }, [activeJobId, observedJobId]);

  const { progress: jobProgress } = useImportJobProgress({
    jobId: activeJobId || observedJobId,
    enabled: visible && (phase === 'importing' || phase === 'checking'),
    lastSocketAt: socketProgress?.receivedAt,
  });
  const presentationBelongsToAttempt = !!importPresentation?.occurredAt
    && timestamp(importPresentation.occurredAt)
      >= (importStartedAtRef.current || Date.now()) - ATTEMPT_CLOCK_SKEW_MS;
  const importIsActive = status.importing
    || importPresentation?.importInProgress === true
    || jobProgress?.state === 'active';
  const hasImportEvidence = importIsActive
    || jobProgress?.state === 'active'
    || (presentationBelongsToAttempt && importPresentation?.kind !== 'checking');
  const runStatus = normalized(latestAttemptRun?.status);
  const runFailed = runStatus === 'error' || runStatus.includes('fail');
  const runSucceeded = TERMINAL_SUCCESS.has(runStatus);
  const terminalRunStatus = jobProgress?.state === 'failed'
    ? 'failed'
    : jobProgress?.state === 'completed'
      ? 'completed'
      : runFailed || runSucceeded || latestAttemptRun?.completedAt
    ? (runFailed ? runStatus : 'completed')
    : presentationBelongsToAttempt && importPresentation?.kind === 'failed'
      ? 'failed'
      : importObservedRef.current && !importIsActive
        ? 'checking'
        : undefined;

  const receiptItemCount = useMemo(() => {
    const count = jobProgress?.state === 'completed'
      ? jobProgress.processed ?? jobProgress.total ?? 0
      : latestAttemptRun?.itemsCommitted ?? 0;
    return count > 0 ? count : null;
  }, [jobProgress, latestAttemptRun]);

  const attentionCountFor = useCallback((connectionId?: string): number => {
    if (!connectionId) return 0;
    const current = importStatusRef.current;
    const summaryCount = current.connections.find(
      (connection) => connection.connectionId === connectionId,
    )?.needsAttention;
    const laneCount = current.lanes.matches.byConnection.find(
      (connection) => connection.connectionId === connectionId,
    )?.count;
    return Math.max(summaryCount || 0, laneCount || 0);
  }, []);

  const enterDone = useCallback(() => {
    clearReconcileTimers();
    refreshSharedStores();
    doneCallbackSentRef.current = false;
    setPhase('done');
  }, [clearReconcileTimers, refreshSharedStores]);

  const completeImport = useCallback(() => {
    clearReconcileTimers();
    refreshSharedStores();

    if (dismissedDuringImportRef.current) {
      setPhase('done');
      return;
    }

    const currentStatus = statusRef.current;
    if (currentStatus.requiresComputer && !currentStatus.computerOnline) {
      setPhase('linkComputer');
      return;
    }
    enterDone();
  }, [clearReconcileTimers, enterDone, refreshSharedStores]);

  useEffect(() => {
    if (phase !== 'importing' && phase !== 'checking') return;
    if (importIsActive || hasImportEvidence) importObservedRef.current = true;

    const decision = decideConnectImportPhase({
      oauthSucceeded: true,
      connectionId: resolvedConnectionId,
      startScanResult: startScanResultRef.current,
      hasImportEvidence,
      graceExpired: graceExpiredRef.current,
      terminalRunStatus,
    });

    if (decision === 'importFailed') {
      clearReconcileTimers();
      setFailedConnectionId(resolvedConnectionId || null);
      setPhase('importFailed');
    } else if (decision === 'done') {
      completeImport();
    } else if (decision !== phase) {
      setPhase(decision);
    }
  }, [
    clearReconcileTimers,
    completeImport,
    hasImportEvidence,
    importIsActive,
    phase,
    resolvedConnectionId,
    terminalRunStatus,
  ]);

  // Completion remains visible long enough to register, then the parent gets
  // the exact connection attention count from the shared summary.
  useEffect(() => {
    if (!visible || phase !== 'done' || doneCallbackSentRef.current) return;
    const timer = setTimeout(() => {
      if (dismissedDuringImportRef.current || doneCallbackSentRef.current) return;
      doneCallbackSentRef.current = true;
      onConnected(resolvedConnectionId, attentionCountFor(resolvedConnectionId));
    }, DONE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [attentionCountFor, onConnected, phase, resolvedConnectionId, visible]);

  const advanceAfterSetup = useCallback(() => {
    const currentStatus = statusRef.current;
    if (currentStatus.requiresComputer && !currentStatus.computerOnline) {
      setPhase('linkComputer');
    } else {
      enterDone();
    }
  }, [enterDone]);

  useEffect(() => {
    if (phase === 'linkComputer' && status.computerOnline) {
      enterDone();
    }
  }, [enterDone, phase, status.computerOnline]);

  const completeOAuth = useCallback(async (shopifyShop?: string) => {
    if (!platform) return;
    const oauthAttemptId = ++oauthAttemptIdRef.current;
    setPhase('connecting');
    setConnectError(null);

    try {
      const result = await connect(platform as ConnectablePlatform, { shopifyShop });
      if (oauthAttemptIdRef.current !== oauthAttemptId) return;

      if (result.success) {
        // The callback already queued the import server-side. This is the first
        // callback-success action: no scan or refresh await may precede it.
        importStartedAtRef.current = Date.now();
        setActiveConnectionId(result.connectionId);
        setActiveJobId(result.jobId);
        setFailedConnectionId(null);
        setConnectError(null);
        setPhase(decideConnectImportPhase({
          oauthSucceeded: true,
          connectionId: result.connectionId,
        }));
        beginImportReconciliation(result.connectionId);
        return;
      }

      if (result.cancelled) {
        setConnectError(null);
        setPhase('consent');
        return;
      }

      const safeError = connectErrorCopy({
        code: result.errorCode,
        message: result.errorMessage,
      });
      if (safeError.kind === 'success_already') {
        importStartedAtRef.current = Date.now();
        setActiveJobId(result.jobId);
        setPhase('importing');
        beginImportReconciliation(result.connectionId);
      } else if (safeError.kind === 'cancelled') {
        setConnectError(null);
        setPhase('consent');
      } else {
        setConnectError(safeError.message);
        setPhase('consent');
      }
    } catch {
      if (oauthAttemptIdRef.current !== oauthAttemptId) return;
      const safeError = connectErrorCopy();
      setConnectError(safeError.kind === 'error' ? safeError.message : null);
      setPhase('consent');
    }
  }, [beginImportReconciliation, connect, platform]);

  const runOAuth = useCallback(() => {
    if (platform === 'shopify') {
      setConnectError(null);
      setPhase('shopifyPicker');
      return;
    }
    void completeOAuth();
  }, [completeOAuth, platform]);

  const retryImport = useCallback(() => {
    if (!failedConnectionId) return;
    importStartedAtRef.current = Date.now();
    setActiveConnectionId(failedConnectionId);
    setActiveJobId(undefined);
    setConnectError(null);
    setPhase('importing');
    beginImportReconciliation(failedConnectionId);
  }, [beginImportReconciliation, failedConnectionId]);

  const closeFlow = useCallback(() => {
    if (phase === 'importing' || phase === 'checking') {
      dismissedDuringImportRef.current = true;
      trackDismissedConnectImport({
        connectionId: resolvedConnectionId,
        platform: activePlatformRef.current || platform || 'platform',
        platformLabel: platformLabelRef.current,
        startedAt: importStartedAtRef.current || Date.now(),
      });
      onCancel();
      return;
    }
    oauthAttemptIdRef.current += 1;
    importAttemptIdRef.current += 1;
    clearReconcileTimers();
    onCancel();
  }, [clearReconcileTimers, onCancel, phase, platform, resolvedConnectionId]);

  const viewStatus = useCallback(() => {
    importAttemptIdRef.current += 1;
    clearReconcileTimers();
    onCancel();
    navigation.navigate('Connections');
  }, [clearReconcileTimers, navigation, onCancel]);

  if (!activePlatform || !def) return null;

  const currentKind: ConnectStepKind | null =
    phase === 'consent' || phase === 'shopifyPicker' || phase === 'connecting'
      ? 'oauth'
      : phase === 'linkComputer'
        ? 'linkComputer'
        : null;
  const stepIndex = currentKind ? steps.indexOf(currentKind) : -1;
  const showStepCount = steps.length > 1 && stepIndex >= 0;
  const bottomPhase = phase === 'consent' || phase === 'connecting' || phase === 'linkComputer';
  const importPhase = phase === 'importing'
    || phase === 'checking'
    || phase === 'importFailed'
    || phase === 'done';
  const socketIsRecent = typeof socketProgress?.receivedAt === 'number'
    && Date.now() - socketProgress.receivedAt <= IMPORT_SOCKET_QUIET_MS;
  const primaryProgress = socketIsRecent ? socketProgress : jobProgress;
  const fallbackProgress = socketIsRecent ? jobProgress : socketProgress;
  const liveProcessed = primaryProgress?.processed ?? fallbackProgress?.processed ?? null;
  const liveTotal = primaryProgress?.total
    ?? fallbackProgress?.total
    ?? (latestAttemptRun && latestAttemptRun.itemsTotal > 0 ? latestAttemptRun.itemsTotal : null);
  const liveItems = primaryProgress?.itemsSoFar
    ?? primaryProgress?.processed
    ?? fallbackProgress?.itemsSoFar
    ?? fallbackProgress?.processed
    ?? latestAttemptRun?.itemsSoFar
    ?? (latestAttemptRun && latestAttemptRun.itemsCommitted > 0
      ? latestAttemptRun.itemsCommitted
      : null);
  const livePhase = primaryProgress?.phase
    || fallbackProgress?.phase
    || importPresentation?.phase;
  const itemLine = liveTotal != null && liveProcessed != null
    ? `${liveProcessed} of ${liveTotal}`
    : liveItems != null && liveItems > 0
      ? `${liveItems} item${liveItems === 1 ? '' : 's'}`
      : liveTotal != null && liveTotal > 0
        ? `${liveTotal} item${liveTotal === 1 ? '' : 's'} found`
        : connectionImportPhaseLabel(livePhase, primaryProgress === socketProgress
          ? socketProgress?.status
          : importPresentation?.phase);

  return (
    <>
      <BaseModal
        visible={visible && !scanOpen && bottomPhase}
        onClose={closeFlow}
        position="bottom"
        showCloseButton={false}
        containerStyle={styles.sheet}
      >
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.headerLogo}>
            <PlatformLogo type={activePlatform} size={22} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Connect {def.label}</Text>
            {showStepCount ? (
              <Text style={styles.headerStep}>Step {stepIndex + 1} of {steps.length}</Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.closeCircle}
            onPress={closeFlow}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Close connect flow"
          >
            <Icon name="close" size={18} color={TEXT_SECONDARY} />
          </TouchableOpacity>
        </View>

        {phase === 'consent' || phase === 'connecting' ? (
          <PlatformConsentBody
            platform={activePlatform}
            busy={phase === 'connecting'}
            error={connectError}
            onContinue={runOAuth}
          />
        ) : null}

        {phase === 'linkComputer' ? (
          <View>
            <LinkComputerBody platform={platform ?? undefined} orgId={orgId || undefined} hideSkip onDone={advanceAfterSetup} />
            <TouchableOpacity
              style={styles.scanBtn}
              onPress={() => setScanOpen(true)}
              activeOpacity={0.85}
            >
              <Icon name="qrcode-scan" size={18} color={BRAND_PRIMARY} />
              <Text style={styles.scanBtnText}>Scan the code on your computer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkLaterBtn} onPress={closeFlow} activeOpacity={0.7}>
              <Text style={styles.linkLaterText}>Do this later</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </BaseModal>

      <BaseModal
        visible={visible && importPhase}
        onClose={closeFlow}
        position="center"
        showCloseButton={false}
        containerStyle={styles.importModal}
      >
        {phase === 'importing' ? (
          <View style={styles.importBody}>
            <View style={styles.platformLogoTile}>
              <PlatformLogo type={activePlatform} size={42} />
            </View>
            <Text style={styles.importTitle}>Importing items</Text>
            <Text style={styles.liveLine}>{itemLine}</Text>
            <Text style={styles.importSubline}>Safe to close.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={closeFlow}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>
        ) : null}

        {phase === 'checking' ? (
          <View style={styles.importBody}>
            <ActivityIndicator color={BRAND_PRIMARY} />
            <Text style={styles.importTitle}>Checking</Text>
            <Pressable
              accessibilityRole="button"
              onPress={viewStatus}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryButtonText}>View status</Text>
            </Pressable>
          </View>
        ) : null}

        {phase === 'importFailed' ? (
          <View style={styles.importBody}>
            <Icon name="alert-circle-outline" size={42} color="#BA7517" />
            <Text style={styles.importTitle}>Import stopped</Text>
            <Pressable
              accessibilityRole="button"
              onPress={retryImport}
              style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={closeFlow}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>
        ) : null}

        {phase === 'done' ? (
          <View style={styles.doneBody}>
            <Icon name="check-circle" size={48} color={BRAND_PRIMARY} />
            <Text style={styles.importTitle}>All set</Text>
            {receiptItemCount ? (
              <Text style={styles.liveLine}>
                {receiptItemCount} item{receiptItemCount === 1 ? '' : 's'} imported
              </Text>
            ) : null}
          </View>
        ) : null}
      </BaseModal>

      <ShopifyStorePicker
        visible={visible && phase === 'shopifyPicker'}
        onCancel={() => setPhase('consent')}
        onStore={(handle) => void completeOAuth(handle)}
      />

      <LinkComputerScanSheet
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onLinked={() => {
          setScanOpen(false);
          advanceAfterSetup();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingTop: 12,
    paddingBottom: 28,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  headerCopy: { flex: 1 },
  headerLogo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F6F7F4',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
    letterSpacing: -0.2,
  },
  headerStep: {
    fontSize: 12.5,
    color: TEXT_SECONDARY,
    marginTop: 1,
    fontFamily: 'Inter_600SemiBold',
  },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F4F4F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: 12,
  },
  scanBtnText: { color: '#18181B', fontSize: 15, fontFamily: 'Inter_700Bold' },
  linkLaterBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 2 },
  linkLaterText: { color: TEXT_SECONDARY, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  importModal: {
    width: '100%',
    maxWidth: 380,
    paddingHorizontal: 24,
    paddingVertical: 28,
    backgroundColor: '#FFFFFF',
  },
  importBody: { width: '100%', alignItems: 'center' },
  doneBody: { width: '100%', alignItems: 'center', paddingVertical: 10 },
  platformLogoTile: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#F6F7F4',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importTitle: {
    color: '#18181B',
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    textAlign: 'center',
    marginTop: 16,
  },
  liveLine: {
    color: '#3F3F46',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  importSubline: {
    color: '#71717A',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 4,
  },
  secondaryButton: {
    width: '100%',
    height: 50,
    borderRadius: 14,
    backgroundColor: '#F4F4F1',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  secondaryButtonText: {
    color: '#3F3F46',
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  retryButton: {
    width: '100%',
    height: 50,
    borderRadius: 14,
    backgroundColor: BRAND_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  retryButtonText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
  buttonPressed: { opacity: 0.78 },
});
